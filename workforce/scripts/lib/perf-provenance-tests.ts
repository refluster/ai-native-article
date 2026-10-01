// Discovered by workforce/lambdas/vitest.config.mjs (`../scripts/**/*-tests.ts`).
//
// #505: a PERF#{scope} row whose headline metrics are all zero must carry
// SOME account of why — every zero metric must either be a confirmed
// measurement, or named in `unmeasured` so the caller can tell the reader it
// degraded. A zero metric that is neither is exactly the #498 H2 / #503
// shape (a fetch silently returned nothing and nobody said so), and the
// writer must refuse to publish rather than let it read as a real quiet
// window.
import { describe, it, expect } from "vitest";
import { assertProvenance, UnprovenanceError } from "./perf-provenance.mjs";

describe("assertProvenance", () => {
  it("publishes a row with at least one nonzero metric, no questions asked", () => {
    expect(() =>
      assertProvenance({ scope: "acme", sk: "REPO", metrics: { issues_opened: 0, prs_opened: 3 } }),
    ).not.toThrow();
  });

  it("publishes an all-zero row when nothing is named unmeasured (every zero is confirmed)", () => {
    expect(() =>
      assertProvenance({ scope: "acme", sk: "REPO", metrics: { total_additions: 0, total_deletions: 0 } }),
    ).not.toThrow();
  });

  it("refuses an all-zero row whose only metric is unmeasured (#498/#503 shape)", () => {
    expect(() =>
      assertProvenance({
        scope: "smartmeter-data-analysis",
        sk: "REPO",
        metrics: { issues_opened: 0, prs_opened: 0, total_additions: 0 },
        unmeasured: ["total_additions"],
      }),
    ).toThrow(UnprovenanceError);
  });

  it("refuses when ANY zero metric is unmeasured, even if others are confirmed", () => {
    // The half-honest case: one signal correctly marked unmeasured is still
    // enough to withhold the whole row — a row is one fact, not a pick-list.
    let err: unknown;
    try {
      assertProvenance({
        scope: "acme",
        sk: "PR",
        metrics: { total_prs: 0, total_additions: 0 },
        unmeasured: ["total_additions"],
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UnprovenanceError);
    expect(String((err as Error).message)).toContain("total_additions");
    expect(String((err as Error).message)).not.toContain("total_prs, total_additions");
  });

  it("names every unaccounted metric in the error, not just the first", () => {
    let err: unknown;
    try {
      assertProvenance({
        scope: "acme",
        sk: "REPO",
        metrics: { a: 0, b: 0, c: 0 },
        unmeasured: ["a", "b", "c"],
      });
    } catch (e) {
      err = e;
    }
    expect(String((err as Error).message)).toContain("a, b, c");
  });

  it("never throws on an empty metrics object — nothing to be dishonest about", () => {
    expect(() => assertProvenance({ scope: "acme", sk: "REPO", metrics: {} })).not.toThrow();
  });

  it("ignores an unmeasured marker on a metric that actually came back nonzero", () => {
    // `unmeasured` only matters when it explains a ZERO; a real positive count
    // always publishes regardless of what else on the row degraded.
    expect(() =>
      assertProvenance({
        scope: "acme",
        sk: "PR",
        metrics: { total_prs: 2, total_additions: 0 },
        unmeasured: ["total_prs"],
      }),
    ).not.toThrow();
  });

  it("mirrors the #503 fetchCodeFrequency shape: churn unconfirmed, activity confirmed-zero", () => {
    // A quiet repo (real zero issues/PRs, confirmed) whose code-churn fetch hit
    // a cold stats cache (`partial: true`, never resolved) must still refuse —
    // this is the exact production incident #505 was filed to close the gap on.
    expect(() =>
      assertProvenance({
        scope: "acme",
        sk: "REPO",
        metrics: { issues_opened: 0, prs_opened: 0, total_additions: 0, total_deletions: 0 },
        unmeasured: ["total_additions", "total_deletions"],
      }),
    ).toThrow(UnprovenanceError);
  });

  // #752 O2: `Number(NaN ?? 0) === 0` is false, so a NaN metric used to make
  // `allZero` false and skip the guard entirely — the worst case this module
  // exists to prevent (a computation error publishing silently). A non-finite
  // metric must never be a free pass, whether or not it's named `unmeasured`.
  it("refuses a NaN metric even when nothing is named unmeasured", () => {
    let err: unknown;
    try {
      assertProvenance({ scope: "acme", sk: "REPO", metrics: { issues_opened: NaN, prs_opened: 3 } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UnprovenanceError);
    expect(String((err as Error).message)).toContain("issues_opened");
  });

  it("refuses a non-numeric metric value the same way", () => {
    expect(() =>
      // @ts-expect-error — deliberately malformed input, the failure mode under test
      assertProvenance({ scope: "acme", sk: "PR", metrics: { total_prs: "not-a-number" } }),
    ).toThrow(UnprovenanceError);
  });
});
