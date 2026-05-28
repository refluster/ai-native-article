// Unit tests for workforce/lambdas/shared/embedding.ts.
//
// Covers the #93 best-effort AC: "Unit tests for cosine kNN correctness
// on a small fixture." Specifically:
//
//   - encode round-trips through decode (with L2 normalisation)
//   - encode throws on NaN / Infinity / zero vectors (W-4 fail-loud)
//   - decode rejects byteLength % 4 !== 0 (corrupt stream)
//   - cosine = 1 for identical vectors, -1 for anti-parallel, 0 for
//     orthogonal (within float32 precision)
//   - topKByCosine returns the canonical nearest neighbours on a fixed
//     2D fixture (the geometry is obvious so the test is debuggable)
//   - topKByCosine is stable on ties

import { describe, expect, it } from "vitest";
import {
  encodeEmbeddingBytes,
  decodeEmbeddingBytes,
  cosine,
  topKByCosine,
  embeddingByteLength,
} from "./embedding.js";

const FP_TOL = 1e-5;

describe("encodeEmbeddingBytes / decodeEmbeddingBytes round-trip", () => {
  it("byteLength is 4 * dim", () => {
    expect(embeddingByteLength(512)).toBe(2048);
    expect(embeddingByteLength(3)).toBe(12);
  });

  it("encode normalises to unit norm; decode round-trips the normalised value", () => {
    const v = Float32Array.from([3, 0, 4]); // pre-norm 5 → unit (0.6, 0, 0.8)
    const bytes = encodeEmbeddingBytes(v);
    expect(bytes.byteLength).toBe(12);
    const back = decodeEmbeddingBytes(bytes);
    expect(back.length).toBe(3);
    expect(back[0]).toBeCloseTo(0.6, 5);
    expect(back[1]).toBeCloseTo(0, 5);
    expect(back[2]).toBeCloseTo(0.8, 5);
    // Unit norm:
    let n2 = 0;
    for (const x of back) n2 += x * x;
    expect(Math.sqrt(n2)).toBeCloseTo(1, 5);
  });

  it("encode does not mutate its input", () => {
    const v = Float32Array.from([3, 0, 4]);
    encodeEmbeddingBytes(v);
    expect(v[0]).toBe(3);
    expect(v[2]).toBe(4);
  });

  it("encode throws on empty vector", () => {
    expect(() => encodeEmbeddingBytes(new Float32Array(0))).toThrow(/empty/);
  });

  it("encode throws on zero vector (cannot normalise — W-4)", () => {
    expect(() => encodeEmbeddingBytes(Float32Array.from([0, 0, 0]))).toThrow(
      /zero vector/,
    );
  });

  it("encode throws on NaN / Infinity components", () => {
    expect(() => encodeEmbeddingBytes(Float32Array.from([1, NaN, 0]))).toThrow(
      /non-finite/,
    );
    expect(() => encodeEmbeddingBytes(Float32Array.from([1, Infinity, 0]))).toThrow(
      /non-finite/,
    );
    expect(() =>
      encodeEmbeddingBytes(Float32Array.from([1, -Infinity, 0])),
    ).toThrow(/non-finite/);
  });

  it("decode rejects byteLength % 4 !== 0 (corrupt stream)", () => {
    expect(() => decodeEmbeddingBytes(new Uint8Array([1, 2, 3]))).toThrow(
      /not a multiple of 4/,
    );
  });

  it("decode accepts both Uint8Array and ArrayBuffer", () => {
    const u8 = encodeEmbeddingBytes(Float32Array.from([1, 0]));
    expect(decodeEmbeddingBytes(u8).length).toBe(2);
    // u8.buffer can be ArrayBuffer | SharedArrayBuffer in strict TS lib
    // typings; copy into a fresh ArrayBuffer to satisfy the signature.
    const copy = new ArrayBuffer(u8.byteLength);
    new Uint8Array(copy).set(u8);
    expect(decodeEmbeddingBytes(copy).length).toBe(2);
  });
});

describe("cosine similarity", () => {
  it("identical vectors → 1", () => {
    const v = Float32Array.from([1, 2, 3]);
    expect(cosine(v, v)).toBeCloseTo(1, 5);
  });

  it("anti-parallel vectors → -1", () => {
    const a = Float32Array.from([1, 2, 3]);
    const b = Float32Array.from([-1, -2, -3]);
    expect(cosine(a, b)).toBeCloseTo(-1, 5);
  });

  it("orthogonal vectors → 0", () => {
    const a = Float32Array.from([1, 0, 0]);
    const b = Float32Array.from([0, 1, 0]);
    expect(Math.abs(cosine(a, b))).toBeLessThan(FP_TOL);
  });

  it("throws on dim mismatch", () => {
    expect(() =>
      cosine(Float32Array.from([1, 2]), Float32Array.from([1, 2, 3])),
    ).toThrow(/dim mismatch/);
  });

  it("returns 0 on zero vectors (avoids NaN)", () => {
    const z = new Float32Array(3);
    const v = Float32Array.from([1, 0, 0]);
    expect(cosine(z, v)).toBe(0);
    expect(cosine(v, z)).toBe(0);
  });
});

describe("topKByCosine", () => {
  // 2D fixture — geometry is "around the unit circle":
  //   north(0,1), east(1,0), south(0,-1), west(-1,0), NE(√.5,√.5)
  // Query "near east" → ranking should be: east, NE, north/south (tied
  // at cos=0 with east as 0°, NE at 45°), west last.
  const NORTH = Float32Array.from([0, 1]);
  const EAST = Float32Array.from([1, 0]);
  const SOUTH = Float32Array.from([0, -1]);
  const WEST = Float32Array.from([-1, 0]);
  const NE = Float32Array.from([Math.SQRT1_2, Math.SQRT1_2]);

  const candidates = [
    { row: "north", embedding: NORTH },
    { row: "east", embedding: EAST },
    { row: "south", embedding: SOUTH },
    { row: "west", embedding: WEST },
    { row: "ne", embedding: NE },
  ];

  it("top-1 returns the closest neighbour", () => {
    const top = topKByCosine(EAST, candidates, 1);
    expect(top).toHaveLength(1);
    expect(top[0]!.row).toBe("east");
    expect(top[0]!.score).toBeCloseTo(1, 5);
  });

  it("top-3 returns east, ne, then a north/south tie (stable order)", () => {
    const top = topKByCosine(EAST, candidates, 3);
    expect(top.map((r) => r.row)).toEqual(["east", "ne", "north"]);
    expect(top[0]!.score).toBeCloseTo(1, 5);
    expect(top[1]!.score).toBeCloseTo(Math.SQRT1_2, 5);
    expect(Math.abs(top[2]!.score)).toBeLessThan(FP_TOL); // north @ cos=0
  });

  it("top-k larger than candidate count returns all candidates sorted", () => {
    const top = topKByCosine(EAST, candidates, 999);
    expect(top).toHaveLength(5);
    expect(top.map((r) => r.row)).toEqual(["east", "ne", "north", "south", "west"]);
    expect(top[4]!.score).toBeCloseTo(-1, 5); // west @ 180°
  });

  it("stable on ties — north before south because of input order (both at cos=0)", () => {
    const top = topKByCosine(EAST, candidates, 4);
    const cos0Pair = top.slice(2);
    expect(cos0Pair.map((r) => r.row)).toEqual(["north", "south"]);
  });

  it("throws on k=0 / negative / non-integer", () => {
    expect(() => topKByCosine(EAST, candidates, 0)).toThrow(/positive integer/);
    expect(() => topKByCosine(EAST, candidates, -1)).toThrow(/positive integer/);
    expect(() => topKByCosine(EAST, candidates, 1.5)).toThrow(/positive integer/);
  });

  it("works against the round-tripped (decoded) form — the production shape", () => {
    // Encode each candidate, then decode and run kNN — this is what the
    // recall path does (DDB stores the bytes, the kNN runs on decoded
    // Float32Arrays). The L2-normalisation in encode is what lets the
    // post-decode cosine work correctly without renormalisation.
    const encoded = candidates.map((c) => ({
      row: c.row,
      embedding: decodeEmbeddingBytes(encodeEmbeddingBytes(c.embedding)),
    }));
    const top = topKByCosine(
      decodeEmbeddingBytes(encodeEmbeddingBytes(EAST)),
      encoded,
      2,
    );
    expect(top.map((r) => r.row)).toEqual(["east", "ne"]);
  });
});
