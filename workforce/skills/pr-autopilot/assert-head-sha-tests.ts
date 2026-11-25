// @ts-nocheck — the script under test (assert-head-sha.mjs) is ESM; vitest
// imports it fine at runtime. Discovered by
// workforce/lambdas/vitest.config.mjs (`include: ["../skills/**/*-tests.ts"]`),
// so `cd workforce/lambdas && npm test` runs it.
//
// FU-030 — harness-side HEAD assertion.
// Locks the pure assertHeadSha() logic against the four outcomes (match,
// mismatch, git failure, bad args). The getHead injector keeps tests fast
// and free of real git subprocess calls.
import { describe, it, expect } from "vitest";
import { assertHeadSha } from "./assert-head-sha.mjs";

const REAL_SHA = "91d72283a1b2c3d4e5f67890ab12cdef34567890";
const OTHER_SHA = "aabbccdd11223344556677889900aabbccddeeff";
const SHORT_SHA = "91d7228"; // 7-char abbreviation accepted

describe("assertHeadSha — match", () => {
  it("returns ok when HEAD equals expectedSha (full 40-hex)", () => {
    const r = assertHeadSha(REAL_SHA, { getHead: () => REAL_SHA });
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
    expect(r.message).toContain("matches expected sha ✓");
  });

  it("is case-insensitive (uppercase expected vs lowercase actual)", () => {
    const r = assertHeadSha(REAL_SHA.toUpperCase(), { getHead: () => REAL_SHA.toLowerCase() });
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
  });

  it("accepts a 7-char short SHA if HEAD matches that prefix", () => {
    // assertHeadSha does .toLowerCase() on both sides, so a short sha matches
    // only when getHead() returns exactly the same string.
    const r = assertHeadSha(SHORT_SHA, { getHead: () => SHORT_SHA });
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
  });
});

describe("assertHeadSha — mismatch (exit 1)", () => {
  it("returns code 1 when HEAD differs from expected sha", () => {
    const r = assertHeadSha(REAL_SHA, { getHead: () => OTHER_SHA });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(1);
    expect(r.message).toContain("HEAD mismatch");
    expect(r.message).toContain(REAL_SHA);
    expect(r.message).toContain(OTHER_SHA);
  });

  it("message names the head_checkout_cmd step so the caller knows how to fix it", () => {
    const r = assertHeadSha(REAL_SHA, { getHead: () => OTHER_SHA });
    expect(r.message).toContain("head_checkout_cmd");
  });
});

describe("assertHeadSha — git failure (exit 2)", () => {
  it("returns code 2 when getHead throws (simulates execFileSync failure)", () => {
    const r = assertHeadSha(REAL_SHA, {
      getHead: () => { throw new Error("not a git repository"); },
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(2);
    expect(r.message).toContain("git rev-parse HEAD failed");
    expect(r.message).toContain("not a git repository");
  });
});

describe("assertHeadSha — bad arguments (exit 3)", () => {
  for (const bad of [undefined, null, "", "   ", "nothex", "12345", "GGGGGG1234567"]) {
    it(`returns code 3 for bad expectedSha: ${JSON.stringify(bad)}`, () => {
      const r = assertHeadSha(bad as unknown as string, { getHead: () => REAL_SHA });
      expect(r.ok).toBe(false);
      expect(r.code).toBe(3);
      expect(r.message).toContain("bad --expected-sha");
    });
  }

  it("does not call getHead when sha validation fails", () => {
    let called = false;
    assertHeadSha("", { getHead: () => { called = true; return REAL_SHA; } });
    expect(called).toBe(false);
  });
});
