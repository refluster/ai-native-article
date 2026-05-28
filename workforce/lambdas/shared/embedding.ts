// Float32 embedding ↔ DDB binary attribute, plus brute-force cosine kNN.
//
// Epic-010 Story 4 (#93). The RFC §9 OpenSearch dependency was deferred
// per parent tracker #89 decision delta #1 — vectors live on the EXEC
// row itself and kNN is done in the recall Lambda. At ≤ 12 agents and
// ~100 execs/day the calling-agent partition stays small enough that
// brute-force latency holds well under the 500 ms target (load-test
// methodology documented in the PR follow-ups).
//
// ─── Storage shape ────────────────────────────────────────────────────
//
// DDB native attribute types do NOT include a "float array". Three
// candidates:
//   (a) `B` (binary) — raw little-endian float32 bytes. 512-dim → 2048 B.
//   (b) `S` (string) — base64 of (a). 512-dim → ~2730 B (+33%).
//   (c) `L` (list)  of `N` (numbers). 512-dim → ~10–20 KB after JSON
//                     marshalling overhead, plus per-element parse cost.
//
// We pick (a). The Document Client auto-marshals Uint8Array → DDB B
// attribute (and back), so storage is transparent. Size matters because
// the row also carries the regular execution metadata; (c) would 5–10×
// the row size and push us closer to DDB's 400 KB item limit.
//
// ─── Cosine semantics ─────────────────────────────────────────────────
//
// We L2-normalise on encode. Stored vectors are unit-norm; the query
// vector is normalised at recall time. Cosine then reduces to a plain
// dot product, and ranking is a single sort by descending score.

/** Byte length of an N-dim float32 vector. */
export function embeddingByteLength(dim: number): number {
  return dim * 4;
}

/**
 * Encode a Float32Array as a Uint8Array of little-endian float32 bytes,
 * with L2 normalisation applied. Persisting normalised vectors lets the
 * recall path skip per-stored-vector renormalisation on every query.
 *
 * Throws on:
 *   - non-finite values (NaN / ±Infinity would poison cosine ranking)
 *   - zero vector (cannot normalise; would silently rank as orthogonal
 *     to everything — failure-loud per W-4)
 */
export function encodeEmbeddingBytes(vec: Float32Array): Uint8Array {
  if (vec.length === 0) {
    throw new Error("encodeEmbeddingBytes: vector is empty");
  }
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    const x = vec[i]!;
    if (!Number.isFinite(x)) {
      throw new Error(
        `encodeEmbeddingBytes: non-finite component at index ${i} (value=${x})`,
      );
    }
    sumSq += x * x;
  }
  if (sumSq === 0) {
    throw new Error(
      "encodeEmbeddingBytes: zero vector — cannot normalise (would silently break cosine ranking)",
    );
  }
  const norm = Math.sqrt(sumSq);
  // Build a fresh buffer so we never mutate the caller's input.
  const buf = new ArrayBuffer(embeddingByteLength(vec.length));
  const view = new DataView(buf);
  for (let i = 0; i < vec.length; i++) {
    view.setFloat32(i * 4, vec[i]! / norm, /*littleEndian=*/ true);
  }
  return new Uint8Array(buf);
}

/**
 * Decode the DDB binary attribute back into a Float32Array. The decoded
 * vector is already L2-normalised (encode side normalised it).
 *
 * Accepts both Uint8Array (what the AWS SDK DocumentClient returns) and
 * raw ArrayBuffer (defensive — some marshalling paths surface either).
 */
export function decodeEmbeddingBytes(bytes: Uint8Array | ArrayBuffer): Float32Array {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.byteLength % 4 !== 0) {
    throw new Error(
      `decodeEmbeddingBytes: byteLength ${u8.byteLength} is not a multiple of 4 (corrupt float32 stream)`,
    );
  }
  const dim = u8.byteLength / 4;
  const out = new Float32Array(dim);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  for (let i = 0; i < dim; i++) {
    out[i] = view.getFloat32(i * 4, /*littleEndian=*/ true);
  }
  return out;
}

/**
 * Cosine similarity in [-1, 1] between two same-length vectors. Both
 * inputs are assumed already L2-normalised (the encode/decode path
 * above maintains that invariant); we still divide by ‖a‖·‖b‖ as a
 * defence-in-depth so a caller that fabricates a non-normalised
 * Float32Array doesn't silently get garbage rankings. The cost is two
 * extra sqrts per candidate — negligible vs the dot-product loop.
 */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`cosine: dim mismatch — a=${a.length}, b=${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface KnnCandidate<T> {
  /** Caller payload — typically an ExecutionRow or its hydration handle. */
  row: T;
  /** L2-normalised embedding for the candidate. */
  embedding: Float32Array;
}

export interface KnnResult<T> {
  row: T;
  score: number;
}

/**
 * Brute-force kNN — return the top-k candidates by cosine similarity to
 * `query`. Stable for ties (preserves input order via the index trick).
 * Two-line implementation; pulling in a "vector search" dep would be
 * dramatically more code than this.
 *
 * Throws if `k < 1`. Returns all candidates (sorted) if `k > candidates.length`.
 */
export function topKByCosine<T>(
  query: Float32Array,
  candidates: ReadonlyArray<KnnCandidate<T>>,
  k: number,
): KnnResult<T>[] {
  if (!Number.isInteger(k) || k < 1) {
    throw new Error(`topKByCosine: k must be a positive integer (got ${k})`);
  }
  const scored = candidates.map((c, i) => ({
    row: c.row,
    score: cosine(query, c.embedding),
    i,
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.i - b.i; // stable on ties
  });
  return scored.slice(0, k).map(({ row, score }) => ({ row, score }));
}
