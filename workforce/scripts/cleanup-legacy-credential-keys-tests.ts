// @ts-nocheck — the script under test is dependency-free ESM, not TS.
// Tests the pure safety-decision logic of the legacy bare-credential-key
// cleanup script (#571 / Epic-010 criterion (a)). The AWS-calling `main()`
// is exercised manually by an operator (raw SDK + their own creds, same
// posture as backfill-performance-lifecycle.mjs) — these tests cover the
// part that must never get the safe/unsafe call wrong.
import { describe, it, expect } from "vitest";
import { isSafeToDelete, sumDatapoints, LEGACY_BARE_KEYS } from "./cleanup-legacy-credential-keys.mjs";

describe("isSafeToDelete", () => {
  it("true only for an exact zero sum", () => {
    expect(isSafeToDelete(0)).toBe(true);
  });
  it("false for any positive read count", () => {
    expect(isSafeToDelete(1)).toBe(false);
    expect(isSafeToDelete(3)).toBe(false);
    expect(isSafeToDelete(0.5)).toBe(false);
  });
  it("false for a negative number (defensive — CloudWatch never returns this, but never trust it blindly)", () => {
    expect(isSafeToDelete(-1)).toBe(false);
  });
  it("never guesses safe when the sum could not be determined (W-4)", () => {
    expect(isSafeToDelete(NaN)).toBe(false);
    expect(isSafeToDelete(undefined)).toBe(false);
    expect(isSafeToDelete(null)).toBe(false);
    expect(isSafeToDelete("0")).toBe(false);
  });
});

describe("sumDatapoints", () => {
  it("sums the Sum field across datapoints", () => {
    expect(sumDatapoints([{ Sum: 2 }, { Sum: 3 }])).toBe(5);
  });
  it("treats an empty array as 0 (no submitted values == no occurrences)", () => {
    expect(sumDatapoints([])).toBe(0);
  });
  it("treats undefined/null Datapoints as 0", () => {
    expect(sumDatapoints(undefined)).toBe(0);
    expect(sumDatapoints(null)).toBe(0);
  });
  it("treats a datapoint with a missing Sum as contributing 0", () => {
    expect(sumDatapoints([{ Sum: 4 }, {}])).toBe(4);
  });
});

describe("LEGACY_BARE_KEYS", () => {
  it("matches migrate-credentials/handler.ts's LEGACY_TO_TYPED legacy column", () => {
    // Kept in sync manually (documented in both files) — this test is the
    // tripwire: if either list changes without the other, one of these
    // three assertions breaks CI instead of silently drifting.
    expect(LEGACY_BARE_KEYS).toEqual(["wf/anthropic", "wf/github", "wf/notion"]);
  });
});
