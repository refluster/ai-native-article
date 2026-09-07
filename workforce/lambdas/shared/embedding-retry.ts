// Retry sweep for EXEC rows stranded at `embedding_status='pending'`
// (Epic-010 Story 4 follow-up, #573). exec-embedding.ts's own header comment
// named this as future work: "a future retry sweep (out of scope for this
// PR; named in the follow-up list) will re-embed pending rows and update
// them in place." Without it, a transient Voyage failure (rate limit,
// timeout, momentary outage) permanently strands a row outside semantic
// recall, with no operator signal beyond the `WfExecEmbeddingFailed` metric
// firing once at write time.
//
// ─── Bounded, not exhaustive (C-3 + Epic-010's own ~USD 5/mo cost line) ──
//
// EMBEDDING_RETRY_MAX_ROWS_PER_RUN caps how many pending rows ONE sweep
// call re-attempts, across ALL projects combined — a runaway backlog must
// not turn one daily sweep into an unbounded Voyage-API bill or a slow
// reducer run. EMBEDDING_RETRY_MAX_ATTEMPTS caps how many times any ONE row
// is retried before it moves to the TERMINAL `embedding_status='failed'` —
// a permanently-bad row (missing credential, persistently oversized text)
// must stop consuming a slice of every future sweep's budget, per the
// issue's own ask ("capped to avoid an infinite retry on a permanently-bad
// row").
//
// ─── No new schedule ──────────────────────────────────────────────────
//
// This module exports a pure-orchestration entry point
// (`sweepPendingEmbeddings`) with no cron of its own. It is called from
// `performance-reducer/handler.ts`'s existing daily walk — adding a new
// EventBridge rule is B-authority (workforce governance §5), and Epic-021's
// idle-talent sweep already established the "ride the existing daily walk,
// don't add a second cron" precedent in that same file.
//
// ─── The EXEC row's "immutable" contract, and this sweep's narrow carve-out
//
// Epic-010 §1 calls Execution "an immutable record... append-only under the
// project's ledger." This sweep does NOT touch any of the execution's own
// facts (status / started_at / ended_at / artifact_ref / summary / error /
// used_credential_types / ...) — it only ever writes the embedding sidecar
// (`embedding_bytes` / `embedding_model_id` / `embedding_dim` /
// `embedding_status` / `embedding_attempts`), a derived, best-effort
// enrichment the row's own doc comments already describe as backfillable
// ("the row was written WITHOUT the three embedding attributes so a retry
// sweep can backfill later" — project.ts `EmbeddingStatus` doc). The
// execution record itself never changes.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { queryBySkPrefixPaged } from "./ddb.js";
import { projectPk, type ExecutionRow, type ProjectId } from "./project.js";
import { encodeEmbeddingBytes } from "./embedding.js";
import { embedText } from "./voyage.js";

const TABLE_NAME = process.env.TABLE_NAME;
if (!TABLE_NAME) throw new Error("TABLE_NAME env var is required");
const tableName: string = TABLE_NAME;

const raw = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(raw, {
  marshallOptions: { removeUndefinedValues: true },
});

/** Pending rows EVALUATED (attempted) per sweep call, across every project
 *  combined. Raising this is a cost decision (Voyage API spend + DDB write
 *  units), not an in-handler tweak. */
export const EMBEDDING_RETRY_MAX_ROWS_PER_RUN = 50;

/** After this many failed retry attempts, a row moves to the terminal
 *  `embedding_status='failed'` and is never retried again. */
export const EMBEDDING_RETRY_MAX_ATTEMPTS = 5;

const EXEC_PAGE_SIZE = 100;

/**
 * Reconstruct the best-effort embedding input from what the row actually
 * persisted. NOT byte-identical to the original write-time attempt:
 * `inputs_summary` — part of the concatenation convention documented on
 * `appendExecutionWithEmbedding` — is never stored on the row (only its
 * hash is, via `inputs_hash`), so a retry can only re-derive text from the
 * fields that ARE on the row: `skill_name`, `summary`, `artifact_ref.summary`,
 * `error`. Same convention (join with `\n`, omit absent fields) minus the
 * one field the row never kept — an honest degradation, not a silent one.
 */
export function deriveRetryEmbeddingText(row: ExecutionRow): string {
  const lines = [`skill: ${row.skill_name}`];
  if (row.summary) lines.push(`summary: ${row.summary}`);
  if (row.artifact_ref?.summary) lines.push(`output: ${row.artifact_ref.summary}`);
  if (row.error) lines.push(`error: ${row.error}`);
  return lines.join("\n");
}

export interface EmbeddingRetrySweepResult {
  /** Pending rows this call actually attempted (bounded by
   *  EMBEDDING_RETRY_MAX_ROWS_PER_RUN). */
  attempted: number;
  /** Attempts that succeeded — row flipped to `embedding_status='ok'`. */
  recovered: number;
  /** Attempts that failed again AND hit EMBEDDING_RETRY_MAX_ATTEMPTS — row
   *  moved to the terminal `embedding_status='failed'`. */
  failedTerminal: number;
  /** Attempts that failed but stay `pending` (attempts below the cap) —
   *  eligible for another try on a future sweep. */
  stillPending: number;
}

/**
 * Sweep the given projects' EXEC partitions for rows still
 * `embedding_status='pending'` and re-attempt their embedding, bounded by
 * EMBEDDING_RETRY_MAX_ROWS_PER_RUN across the whole call. Mirrors
 * exec-embedding.ts's own AC4 failure-isolation discipline: an individual
 * row's embed failure is caught, logged, and turned into an attempt-count
 * update — it never throws out of this function. The sweep itself always
 * completes and reports what happened.
 */
export async function sweepPendingEmbeddings(
  projectIds: readonly ProjectId[],
): Promise<EmbeddingRetrySweepResult> {
  let attempted = 0;
  let recovered = 0;
  let failedTerminal = 0;
  let stillPending = 0;

  for (const projectId of projectIds) {
    if (attempted >= EMBEDDING_RETRY_MAX_ROWS_PER_RUN) break;

    let cursor: string | undefined;
    do {
      const page = await queryBySkPrefixPaged<ExecutionRow>(
        projectPk(projectId),
        "EXEC#",
        EXEC_PAGE_SIZE,
        cursor,
      );
      cursor = page.cursor;

      for (const row of page.items) {
        if (row.embedding_status !== "pending") continue;
        if (attempted >= EMBEDDING_RETRY_MAX_ROWS_PER_RUN) break;
        attempted += 1;

        const outcome = await retryOne(row);
        if (outcome === "recovered") recovered += 1;
        else if (outcome === "failed_terminal") failedTerminal += 1;
        else stillPending += 1;
      }
    } while (cursor && attempted < EMBEDDING_RETRY_MAX_ROWS_PER_RUN);
  }

  return { attempted, recovered, failedTerminal, stillPending };
}

type RetryOutcome = "recovered" | "failed_terminal" | "still_pending";

async function retryOne(row: ExecutionRow): Promise<RetryOutcome> {
  const text = deriveRetryEmbeddingText(row);

  try {
    const result = await embedText({ projectId: row.project_id, text, inputType: "document" });
    await updateEmbeddingOk(row, {
      embedding_bytes: encodeEmbeddingBytes(result.embedding),
      embedding_model_id: result.modelId,
      embedding_dim: result.dim,
    });
    return "recovered";
  } catch (err) {
    const attempts = (row.embedding_attempts ?? 0) + 1;
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      JSON.stringify({
        event: "exec_embedding_retry_failed",
        project_id: row.project_id,
        exec_ulid: row.sk.slice("EXEC#".length),
        attempts,
        max_attempts: EMBEDDING_RETRY_MAX_ATTEMPTS,
        error: message,
      }),
    );
    if (attempts >= EMBEDDING_RETRY_MAX_ATTEMPTS) {
      await updateEmbeddingTerminal(row, attempts);
      return "failed_terminal";
    }
    await updateEmbeddingAttempt(row, attempts);
    return "still_pending";
  }
}

async function updateEmbeddingOk(
  row: ExecutionRow,
  attrs: { embedding_bytes: Uint8Array; embedding_model_id: string; embedding_dim: number },
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { pk: row.pk, sk: row.sk },
      // Only the embedding sidecar; the execution's own facts are never
      // touched (see the module header's "immutable record" note).
      // embedding_attempts is REMOVEd (not zeroed) — a recovered row has no
      // retry history worth carrying forward.
      UpdateExpression:
        "SET embedding_bytes = :bytes, embedding_model_id = :model, embedding_dim = :dim, embedding_status = :status REMOVE embedding_attempts",
      ExpressionAttributeValues: {
        ":bytes": attrs.embedding_bytes,
        ":model": attrs.embedding_model_id,
        ":dim": attrs.embedding_dim,
        ":status": "ok",
      },
    }),
  );
}

async function updateEmbeddingAttempt(row: ExecutionRow, attempts: number): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { pk: row.pk, sk: row.sk },
      UpdateExpression: "SET embedding_attempts = :attempts",
      ExpressionAttributeValues: { ":attempts": attempts },
    }),
  );
}

async function updateEmbeddingTerminal(row: ExecutionRow, attempts: number): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { pk: row.pk, sk: row.sk },
      UpdateExpression: "SET embedding_attempts = :attempts, embedding_status = :status",
      ExpressionAttributeValues: { ":attempts": attempts, ":status": "failed" },
    }),
  );
}
