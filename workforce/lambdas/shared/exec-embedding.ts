// High-level "compute embedding then append EXEC row" wrapper.
//
// Epic-010 Story 4 (#93) — the embedding-write path on EXEC insert.
// Composes:
//   1. shared/voyage.ts:embedText   (compute the vector)
//   2. shared/embedding.ts          (L2-normalise + serialise)
//   3. shared/project.ts:appendExecution (write the row)
//
// ─── Failure isolation (AC4) ──────────────────────────────────────────
//
// When the embedding API throws (network / 5xx / `voyage.api_key` not
// provisioned / dim drift), THE EXECUTION ITSELF STILL SUCCEEDS. The
// EXEC row lands with `embedding_status='pending'` and zero embedding
// attributes — a future retry sweep (out of scope for this PR; named
// in the follow-up list) will re-embed pending rows and update them in
// place. The execution-write call site does NOT see the embedding
// failure as an error; it sees a successful (degraded) write.
//
// This is enforced by wrapping the embed step in try/catch and emitting
// a structured log + (best-effort) CloudWatch metric on the swallow
// path. The metric (`WfExecEmbeddingFailed`) is the operator's signal
// that the retry queue has work pending; if it climbs and the retry
// path is still TBD, structured recall keeps working and semantic
// recall just sees fewer candidates.
//
// ─── Skip path ────────────────────────────────────────────────────────
//
// If `summaryText` after concatenation is empty (or whitespace-only),
// we skip the Voyage call entirely and land the row with
// `embedding_status='skipped'`. Embedding the empty string costs ~10
// tokens for zero recall signal.

import {
  CloudWatchClient,
  PutMetricDataCommand,
} from "@aws-sdk/client-cloudwatch";
import {
  appendExecution,
  type AppendExecutionInput,
  type ExecutionRow,
} from "./project.js";
import { encodeEmbeddingBytes } from "./embedding.js";
import { embedText } from "./voyage.js";

const STAGE = process.env.STAGE ?? "dev";
const cw = new CloudWatchClient({});

/**
 * Input for the embedding-aware append. `embedding_text` is the
 * pre-concatenated `{skill_name, inputs_summary?, artifact.summary?,
 * error?}` blob (Epic-010 §9); the caller decides the concatenation
 * order and any tokenisation, this wrapper is text-in only.
 *
 * Conventional concatenation (recommended): join with `\n` and a
 * leading label, e.g.
 *   `skill: ${skill_name}\ninputs: ${inputs_summary}\noutput: ${artifact.summary}\nerror: ${error}`
 * — leaving the absent fields out entirely. The exact form is a
 * recall-quality knob, not a correctness one; brute-force kNN tolerates
 * any consistent shape.
 */
export interface AppendExecutionWithEmbeddingInput
  extends Omit<
    AppendExecutionInput,
    | "embedding_bytes"
    | "embedding_model_id"
    | "embedding_dim"
    | "embedding_status"
  > {
  /** Pre-concatenated text to embed. Empty/whitespace → status='skipped'. */
  embedding_text: string;
}

/**
 * Append an EXEC row with the best-effort embedding sidecar. The
 * execution itself always lands (AC4 — embedding failure does NOT mask
 * the execution's success). Cross-project membership denial still
 * propagates from `appendExecution`.
 */
export async function appendExecutionWithEmbedding(
  input: AppendExecutionWithEmbeddingInput,
): Promise<ExecutionRow> {
  const { embedding_text, ...rest } = input;
  const trimmed = embedding_text.trim();

  if (trimmed.length === 0) {
    // Skip path — log structurally (so the operator can spot a skill
    // that's accidentally returning empty summaries) but don't bother
    // with a metric.
    console.info(
      JSON.stringify({
        event: "exec_embedding_skipped",
        reason: "empty_text",
        project_id: rest.project_id,
        exec_ulid: rest.exec_ulid,
        skill_name: rest.skill_name,
      }),
    );
    return appendExecution({ ...rest, embedding_status: "skipped" });
  }

  // Narrow the failure-isolation try/catch to JUST the embedding step.
  // Wrapping `appendExecution` would mask a genuine ledger-write failure
  // as "embedding failed", emitting a misleading metric and an extra
  // (still-failing) write attempt. (Before 2026-06-08 this also protected
  // the cross-project denial throw; that write-gate has since been removed.)
  let embeddingAttrs: {
    embedding_bytes: Uint8Array;
    embedding_model_id: string;
    embedding_dim: number;
    embedding_status: "ok";
  } | null = null;

  try {
    const result = await embedText({
      projectId: rest.project_id,
      text: trimmed,
      inputType: "document",
    });
    embeddingAttrs = {
      embedding_bytes: encodeEmbeddingBytes(result.embedding),
      embedding_model_id: result.modelId,
      embedding_dim: result.dim,
      embedding_status: "ok",
    };
  } catch (err) {
    // Failure isolation (AC4): land the row with status='pending',
    // don't propagate. Emit the structured log + best-effort metric so
    // the retry-queue work is visible to the operator.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      JSON.stringify({
        event: "exec_embedding_failed",
        project_id: rest.project_id,
        exec_ulid: rest.exec_ulid,
        skill_name: rest.skill_name,
        agent_slug: rest.agent_slug,
        error: message,
      }),
    );
    emitEmbeddingFailedMetric();
  }

  if (embeddingAttrs) {
    return appendExecution({ ...rest, ...embeddingAttrs });
  }
  return appendExecution({ ...rest, embedding_status: "pending" });
}

function emitEmbeddingFailedMetric(): void {
  // Best-effort: a metric-emit failure must not mask the successful
  // (degraded) write. Same pattern as project.ts:emitLegacyCredentialRead.
  cw
    .send(
      new PutMetricDataCommand({
        Namespace: "Workforce/Recall",
        MetricData: [
          {
            MetricName: "WfExecEmbeddingFailed",
            Value: 1,
            Unit: "Count",
            Dimensions: [{ Name: "Stage", Value: STAGE }],
          },
        ],
      }),
    )
    .catch((err) => {
      console.warn(
        JSON.stringify({
          event: "exec_embedding_metric_emit_failed",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    });
}
