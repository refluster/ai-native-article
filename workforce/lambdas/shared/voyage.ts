// Voyage AI embeddings client. Direct fetch (no SDK) so the Lambda bundle
// stays thin — same pattern as shared/llm-anthropic.ts.
//
// Added in Epic-010 Story 4 (#93) for the EXEC-row embedding-write path:
// every appendExecutionWithEmbedding call computes a `voyage-3-lite`
// embedding over the execution summary and stores it as a float32 binary
// attribute on the EXEC row. Brute-force cosine kNN over those embeddings
// is done in Lambda (see shared/recall.ts); no separate vector engine, no
// OpenSearch (RFC §9 deviation, captured in
// workforce/docs/epics/epic-010-project-trust-boundary.md §9 as amended
// by parent tracker #89 decision delta #1).
//
// ─── Failure isolation ────────────────────────────────────────────────
//
// Per AC4 (#93): when this client throws, the caller is expected to land
// the EXEC row with `embedding_status='pending'` and let a future retry
// sweep re-embed. The execution itself must still succeed. This client
// therefore throws on every failure mode (network, HTTP non-2xx, malformed
// response, dimension mismatch) — the caller decides whether to swallow
// or propagate. We do NOT silently return a zero vector (that would
// corrupt every future kNN result).
//
// ─── Cost ─────────────────────────────────────────────────────────────
//
// `voyage-3-lite` pricing (2026-05): ~USD 0.02/M tokens. At 100 execs/day
// × ~500 tokens each ≈ USD 1/mo, well under the W-3 ceiling.

import { getCredential, type ProjectId } from "./project.js";
import type { VoyageSecret } from "./secrets.js";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

/** Canonical model id for the v1 embedding pipeline. Stored on the EXEC
 *  row alongside the vector so re-embedding on a model change is a query,
 *  not a guess (Epic-010 Open Q3). */
export const VOYAGE_MODEL_ID = "voyage-3-lite";

/** Expected output dimension for VOYAGE_MODEL_ID. A mismatch in the
 *  response throws — silently storing a wrong-dim vector would corrupt
 *  every future kNN result. */
export const VOYAGE_DIM = 512;

export interface EmbedInput {
  /** Project to resolve the API key from (per Epic-010 §5 — credentials
   *  are project-scoped, never agent-scoped). */
  projectId: ProjectId;
  /** Text to embed. The caller is expected to have already concatenated
   *  `{skill_name, inputs_summary?, artifact.summary?, error?}` per
   *  Epic-010 §9 — this client is text-in / vector-out only. */
  text: string;
  /** `document` for stored vectors (the EXEC-row case); `query` for
   *  search-side embedding (the agent.recall(query=…) case). Voyage's
   *  `input_type` field is the optimisation knob; mis-setting it
   *  silently degrades kNN quality. */
  inputType: "document" | "query";
}

export interface EmbedResult {
  /** Float32 array, length === VOYAGE_DIM. Callers persist via
   *  `encodeEmbeddingBytes()` (shared/embedding.ts). */
  embedding: Float32Array;
  modelId: typeof VOYAGE_MODEL_ID;
  dim: typeof VOYAGE_DIM;
  tokensIn: number;
}

/**
 * Embed one text via voyage-3-lite. Throws on every failure mode (see
 * file header). The caller is expected to wrap this with try/catch and
 * fall back to `embedding_status='pending'` on error per #93 AC4.
 */
export async function embedText(input: EmbedInput): Promise<EmbedResult> {
  const { apiKey } = await getCredential<VoyageSecret>(
    input.projectId,
    "voyage.api_key",
  );

  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL_ID,
      input: [input.text],
      input_type: input.inputType,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`voyage ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    data?: Array<{ embedding?: number[] }>;
    usage?: { total_tokens?: number };
  };

  const raw = data.data?.[0]?.embedding;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(
      `voyage: malformed response (no embedding in data[0]) for model=${VOYAGE_MODEL_ID}`,
    );
  }
  if (raw.length !== VOYAGE_DIM) {
    // W-4 fail-loud: a dim mismatch would silently corrupt the kNN index.
    // Voyage's API documents 512-dim for voyage-3-lite; a non-512 response
    // means either the API version drifted or we misset `model`.
    throw new Error(
      `voyage: dim mismatch — expected ${VOYAGE_DIM}, got ${raw.length} (model=${VOYAGE_MODEL_ID})`,
    );
  }

  return {
    embedding: Float32Array.from(raw),
    modelId: VOYAGE_MODEL_ID,
    dim: VOYAGE_DIM,
    tokensIn: data.usage?.total_tokens ?? 0,
  };
}
