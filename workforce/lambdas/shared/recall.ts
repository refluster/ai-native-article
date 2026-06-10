// agent.recall() — structured + semantic queries over the EXEC ledger.
//
// Epic-010 Story 4 (#93). Two query shapes, both partitioned by the
// calling agent (GSI1 on `AGENT#{slug}`):
//
//   - Structured: `recall({ caller_agent_slug, project?, skill?, from?,
//     to?, status?, k? })` → DDB GSI1 query + post-filter, ranked by
//     `started_at` descending (newest first).
//
//   - Semantic:   `recall({ caller_agent_slug, query, k? })` → GSI1
//     query for the caller's executions, brute-force cosine kNN in
//     Lambda, top-k by similarity. Pre-Story-4 rows (no embedding) and
//     `embedding_status !== 'ok'` rows are excluded from the candidate
//     pool but still visible via the structured path.
//
// ─── No membership gate ───────────────────────────────────────────────
//
// recall is always partitioned by the CALLING agent (GSI1 on
// `AGENT#{slug}`), so it only ever surfaces the caller's OWN executions.
// The Story-4 (#93) read-gate that additionally hid the caller's rows for
// projects they were no longer an active member of was removed 2026-06-10
// (owner directive): project↔member binding is not an access-control
// primitive at single-operator scale (C-3), so an agent always recalls its
// full own ledger regardless of current project membership.
//
// ─── Combined query+filter ────────────────────────────────────────────
//
// Best-effort per the PR scope. When the caller provides BOTH `query`
// and structured predicates (skill / time-range / status / project),
// the implementation:
//
//   1. Pulls the full agent partition (paginated to `limit`).
//   2. Runs kNN over the embedded subset.
//   3. Post-filters the kNN-ranked results by the structured predicates.
//   4. Returns the first `k` that satisfy both.
//
// This honours `k` on the semantic axis per RFC §9 ("never the other way
// around"). The semantic-vs-structured combinator surface is intentionally
// minimal; richer composition (boolean combinators, hybrid scoring) is
// out-of-scope and named in the PR follow-ups.

import {
  listExecutions,
  type ExecutionRow,
  type ExecStatus,
  type ProjectId,
} from "./project.js";
import type { AgentSlug } from "./agent.js";
import { decodeEmbeddingBytes, topKByCosine, cosine } from "./embedding.js";
import { embedText } from "./voyage.js";
import { emitRecallLatency, emitVintageMismatch } from "./recall-metrics.js";

/**
 * Thrown (Epic-012 Story 4) when the embedded candidate set is not a single
 * embedding-model vintage, or when that vintage differs from the query's
 * model. Cosine across two embedding spaces is meaningless, so recall
 * fails LOUD rather than silently ranking garbage. The fix is a re-embedding
 * sweep onto the current model (see ADR-0002 §Consequences). The runner's
 * `buildRecallBlock` catches this fail-soft (empty recall block, run
 * proceeds); the agents-api recall route surfaces it as a 500 to the
 * operator. Each occurrence also ticks `WfRecallVintageMismatch`.
 */
export class RecallVintageMismatchError extends Error {
  readonly models: string[];
  readonly queryModel: string;
  constructor(models: string[], queryModel: string) {
    super(
      `recall: embedded candidates span models [${models.join(", ")}] vs query model ${queryModel} — ` +
        `cosine across embedding spaces is invalid; re-embed the corpus onto ${queryModel} (ADR-0002)`,
    );
    this.name = "RecallVintageMismatchError";
    this.models = models;
    this.queryModel = queryModel;
  }
}

/** Common bound on returned rows / kNN candidates. */
const DEFAULT_K = 5;

/** Upper bound on the agent partition scan size for the semantic path.
 *  At workforce scale (≤ 12 agents × ~100 execs/day) this is months of
 *  history per agent — well above the typical recall surface. The cap
 *  is the safety valve for the per-agent-execs > 50k trigger (Epic-010
 *  §9 amendment) that moves us off brute-force entirely. */
const SEMANTIC_SCAN_LIMIT = 1000;

export interface RecallStructuredInput {
  /** Required. Selects the agent partition to recall over (GSI1
   *  `AGENT#{slug}`) — a recall always surfaces the named agent's own
   *  ledger. `_operator` has no agent partition and must scope by
   *  project/skill via listExecutions instead. */
  caller_agent_slug: AgentSlug | "_operator";
  /** Optional structured filters. */
  project?: ProjectId;
  skill?: string;
  /** ISO-8601 inclusive lower bound on started_at. */
  from?: string;
  /** ISO-8601 inclusive upper bound on started_at. */
  to?: string;
  status?: ExecStatus;
  /** Cap on returned rows. Default DEFAULT_K=5. */
  k?: number;
}

export interface RecallSemanticInput {
  caller_agent_slug: AgentSlug | "_operator";
  /** Free-text query. Embedded via voyage-3-lite at recall time. */
  query: string;
  /** Top-k cosine matches. Default DEFAULT_K=5. */
  k?: number;
  /** ProjectId used to resolve the Voyage API key. Defaults to the
   *  caller's `self/{slug}` project (per Epic-010 §3 — every agent is
   *  auto-seeded into their `self` project). `_operator` MUST pass this
   *  explicitly (no `self` partition for the operator). */
  embedding_project_id?: ProjectId;
  /** Optional structured filters composed AFTER the kNN sort (so `k` is
   *  honoured on the semantic axis per RFC §9). Best-effort path. */
  project?: ProjectId;
  skill?: string;
  from?: string;
  to?: string;
  status?: ExecStatus;
}

export interface RecallResult {
  row: ExecutionRow;
  /** Cosine similarity in [-1, 1]. `undefined` for structured-only
   *  results (no kNN was run). */
  score?: number;
}

/**
 * Structured recall — GSI1 query against `AGENT#{caller}` partition with
 * the predicate filters in `RecallStructuredInput` applied.
 */
export async function recallStructured(
  input: RecallStructuredInput,
): Promise<RecallResult[]> {
  const callerForGate = input.caller_agent_slug;
  // The GSI1 partition key is itself `AGENT#{slug}` — for `_operator` we
  // need a different path (full ledger scan), which the structured
  // surface intentionally doesn't expose at v1. For named agents the
  // partition is the natural index.
  if (callerForGate === "_operator") {
    throw new Error(
      "recallStructured: _operator must scope by project or skill — pass project= / skill= explicitly via listExecutions",
    );
  }

  const k = input.k ?? DEFAULT_K;
  const rows = await listExecutions({
    agent_slug: callerForGate,
    from: input.from,
    to: input.to,
    status: input.status,
    limit: SEMANTIC_SCAN_LIMIT,
  });

  // Post-filter on project / skill (GSI1 is already partitioned by agent).
  const filtered = rows.filter((r) => {
    if (input.project && r.project_id !== input.project) return false;
    if (input.skill && r.skill_name !== input.skill) return false;
    return true;
  });

  // Newest-first (matches the operator-chat use case).
  filtered.sort((a, b) => (a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : 0));
  return filtered.slice(0, k).map((row) => ({ row }));
}

/**
 * Semantic recall — embed the query, brute-force kNN over the caller's
 * embedded executions, return top-k by cosine. Optional structured
 * predicates are post-filtered AFTER the kNN sort (best-effort).
 */
export async function recallSemantic(
  input: RecallSemanticInput,
): Promise<RecallResult[]> {
  const caller = input.caller_agent_slug;
  if (caller === "_operator") {
    throw new Error(
      "recallSemantic: _operator must specify a candidate agent — global semantic recall is out of scope (Epic-010 Story 4 §Out of scope)",
    );
  }
  if (input.query.trim().length === 0) {
    throw new Error("recallSemantic: query must be non-empty");
  }

  const k = input.k ?? DEFAULT_K;

  // 1. Pull the agent's full ledger window (or up to SEMANTIC_SCAN_LIMIT).
  const rows = await listExecutions({
    agent_slug: caller,
    limit: SEMANTIC_SCAN_LIMIT,
  });

  // 2. Filter to embedded candidates only. Rows without
  //    `embedding_status='ok'` (or pre-Story-4 rows entirely) are
  //    excluded from the semantic pool but remain visible via
  //    structured recall.
  const candidates = rows
    .filter(
      (r) =>
        r.embedding_status === "ok" &&
        r.embedding_bytes !== undefined &&
        r.embedding_dim !== undefined,
    )
    .map((r) => ({
      row: r,
      embedding: decodeEmbeddingBytes(r.embedding_bytes!),
    }));

  if (candidates.length === 0) {
    return [];
  }

  // 3. Embed the query (input_type='query' — Voyage's search-side hint).
  //    The Voyage API key is resolved from `embedding_project_id`,
  //    defaulting to the caller's `self/{slug}` project.
  const embeddingProject =
    input.embedding_project_id ?? (`self/${caller}` as ProjectId);
  const queryResult = await embedText({
    projectId: embeddingProject,
    text: input.query,
    inputType: "query",
  });

  // Vintage safety (Epic-012 Story 4): cosine is only meaningful within a
  // single embedding space. If the candidate set spans more than one
  // `embedding_model_id`, or that model differs from the query's model, the
  // kNN would silently rank across incompatible spaces. Fail LOUD instead —
  // the operator's signal to run a re-embedding sweep (ADR-0002). The
  // pre-existing dim check is subsumed: a model change usually changes dim,
  // but two models can share a dim (e.g. both 512), which only the model-id
  // check catches.
  const candidateModels = [...new Set(candidates.map((c) => c.row.embedding_model_id ?? "unknown"))];
  if (candidateModels.length > 1 || candidateModels[0] !== queryResult.modelId) {
    await emitVintageMismatch();
    throw new RecallVintageMismatchError(candidateModels, queryResult.modelId);
  }

  // Dim safety: defence-in-depth behind the vintage check above — a query
  // embedding whose `dim` differs from the stored vectors must not rank.
  const firstCandDim = candidates[0]!.row.embedding_dim;
  if (queryResult.dim !== firstCandDim) {
    throw new Error(
      `recallSemantic: query dim=${queryResult.dim} but stored dim=${firstCandDim} ` +
        `(model drift? re-embed the corpus on the new model)`,
    );
  }

  // 4. Brute-force top-k by cosine. Run an over-fetch when structured
  //    filters are also present so we still have k matches after the
  //    post-filter pass.
  const hasPostFilters =
    input.project !== undefined ||
    input.skill !== undefined ||
    input.from !== undefined ||
    input.to !== undefined ||
    input.status !== undefined;
  const kSearch = hasPostFilters ? Math.min(candidates.length, k * 10) : k;
  const ranked = topKByCosine(queryResult.embedding, candidates, kSearch);

  // 5. Apply structured post-filters (composes with kNN per RFC §9).
  const postFiltered = ranked.filter(({ row: r }) => {
    if (input.project && r.project_id !== input.project) return false;
    if (input.skill && r.skill_name !== input.skill) return false;
    if (input.status && r.status !== input.status) return false;
    if (input.from && r.started_at < input.from) return false;
    if (input.to && r.started_at > input.to) return false;
    return true;
  });

  return postFiltered.slice(0, k).map(({ row, score }) => ({ row, score }));
}

/**
 * `agent.recall(...)` — single dispatch surface that picks structured vs.
 * semantic based on whether `query` is present. Mirrors the RFC §9 API
 * shape one-for-one.
 */
export type RecallInput =
  | (RecallStructuredInput & { query?: undefined })
  | RecallSemanticInput;

export async function recall(input: RecallInput): Promise<RecallResult[]> {
  // Epic-012 Story 4: per-call latency → WfRecallLatencyMs (CloudWatch p95
  // over this is the ADR-0002 migration trigger). Measured around BOTH
  // dispatch arms, including the error path, so a slow-then-throwing call
  // still shows up. Emission is best-effort and never alters the result.
  const t0 = Date.now();
  try {
    if ("query" in input && typeof input.query === "string") {
      return await recallSemantic(input);
    }
    return await recallStructured(input as RecallStructuredInput);
  } finally {
    await emitRecallLatency(Date.now() - t0);
  }
}

// Re-export `cosine` so tests / future composers don't need to reach
// into `shared/embedding.ts` directly.
export { cosine };
