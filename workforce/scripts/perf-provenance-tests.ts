// @ts-nocheck — the module under test is dependency-free ESM, not TS.
//
// Issue #505: the writer-boundary guard that refuses to persist a zero-valued
// `PERF#{scope}` signal carrying no provenance. Each test names the bug it
// would catch, because the whole point of this guard is that two per-fetch
// fixes (#498, #503) did not cover each other's branch.
import { describe, it, expect } from "vitest";
import {
  PerfProvenanceError,
  assertPerfProvenance,
  measuredZeroSignals,
  prSignals,
  repoSignals,
  unprovenancedZeros,
} from "./perf-provenance.mjs";

describe("unprovenancedZeros", () => {
  // Catches: the #503 production regression — code_churn published as 0 with
  // no degraded flag while the same repo returned 13 populated weeks minutes
  // later. Pre-guard this row was publishable; now it names the offender.
  it("flags a zero carrying neither degraded_signals nor measured_zero", () => {
    expect(
      unprovenancedZeros({
        metrics: { issues_opened: 12, code_churn: 0 },
        degraded_signals: [],
        measured_zero: [],
      }),
    ).toEqual(["code_churn"]);
  });

  // Catches: a guard that only rejects zeros. An honest unknown must stay
  // publishable, or the fix makes the deck less useful rather than more honest.
  it("accepts a zero marked degraded (an honest unknown)", () => {
    expect(
      unprovenancedZeros({ metrics: { code_churn: 0 }, degraded_signals: ["code_churn"] }),
    ).toEqual([]);
  });

  // Catches: dario's route-around — if `measured_zero` were not honoured, a
  // genuinely churn-free repo could only be published by lying with
  // `partial: true`, and every writer would learn to do exactly that.
  it("accepts a zero marked measured (we looked, it really is zero)", () => {
    expect(
      unprovenancedZeros({ metrics: { code_churn: 0 }, measured_zero: ["code_churn"] }),
    ).toEqual([]);
  });

  // Catches: a guard scoped to all-zero rows only. #503's row was NOT all-zero
  // — issues and PRs were populated and only churn was false — so an
  // all-zero-only check would have missed its own motivating incident.
  it("flags a single false zero inside an otherwise-populated row", () => {
    expect(
      unprovenancedZeros({
        metrics: { issues_opened: 40, issues_closed: 31, prs_opened: 22, prs_closed: 19, code_churn: 0 },
      }),
    ).toEqual(["code_churn"]);
  });

  it("reports every unprovenanced signal, sorted, on an all-zero row", () => {
    expect(
      unprovenancedZeros({
        metrics: { prs_opened: 0, code_churn: 0, issues_opened: 0 },
        degraded_signals: ["code_churn"],
      }),
    ).toEqual(["issues_opened", "prs_opened"]);
  });

  it("leaves non-zero signals alone regardless of provenance", () => {
    expect(unprovenancedZeros({ metrics: { issues_opened: 3, code_churn: 7 } })).toEqual([]);
  });
});

describe("assertPerfProvenance", () => {
  // Catches: a guard that logs instead of throwing. W-4 — a false low is
  // indistinguishable from a real low downstream, so the write must not happen.
  it("throws PerfProvenanceError naming the row and the offending signals", () => {
    let err;
    try {
      assertPerfProvenance({ pk: "PERF#asp-cloud", sk: "REPO", metrics: { code_churn: 0 } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PerfProvenanceError);
    expect(err.unprovenanced).toEqual(["code_churn"]);
    expect(err.message).toContain("PERF#asp-cloud/REPO");
    expect(err.message).toContain("code_churn");
  });

  it("is a no-op when every zero is provenanced", () => {
    expect(() =>
      assertPerfProvenance({
        pk: "PERF#workforce",
        sk: "REPO",
        metrics: { issues_opened: 0, code_churn: 0 },
        degraded_signals: ["code_churn"],
        measured_zero: ["issues_opened"],
      }),
    ).not.toThrow();
  });
});

describe("measuredZeroSignals", () => {
  // Catches: the incentive inversion. Deriving measured_zero from the `partial`
  // bookkeeping the fetchers already keep is what makes the honest path free —
  // no caller maintains a second list, so nobody is tempted to blanket-degrade.
  it("derives measured zeros from the fetchers' own partial flags", () => {
    expect(
      measuredZeroSignals(
        { issues_opened: 0, prs_opened: 4, code_churn: 0 },
        { issues_opened: false, prs_opened: false, code_churn: true },
      ),
    ).toEqual(["issues_opened"]);
  });

  it("treats a signal with no partial entry as measured", () => {
    expect(measuredZeroSignals({ total_prs: 0 }, {})).toEqual(["total_prs"]);
  });
});

describe("row-shape signal vocabularies", () => {
  // Catches: a vocabulary drift between the metric names and the provenance
  // lists — a guard comparing `total_additions` against a degraded list that
  // says `code_churn` would silently pass every churn zero.
  it("repoSignals folds additions+deletions into the one code_churn fetch", () => {
    expect(
      repoSignals({
        issues_opened: 1,
        issues_closed: 2,
        prs_opened: 3,
        prs_closed: 4,
        total_additions: 10,
        total_deletions: 5,
      }),
    ).toEqual({ issues_opened: 1, issues_closed: 2, prs_opened: 3, prs_closed: 4, code_churn: 15 });
  });

  it("repoSignals reports code_churn 0 only when both sides are 0", () => {
    expect(repoSignals({ total_additions: 0, total_deletions: 3 }).code_churn).toBe(3);
    expect(repoSignals({ total_additions: 0, total_deletions: 0 }).code_churn).toBe(0);
  });

  it("prSignals projects the PR roll-up onto its four signals", () => {
    expect(
      prSignals({ total_prs: 9, autopilot_merged: 0, total_additions: 100, total_deletions: 20 }),
    ).toEqual({ total_prs: 9, autopilot_merged: 0, total_additions: 100, total_deletions: 20 });
  });
});

describe("end-to-end: the #503 row, before and after its fix", () => {
  const summary = {
    issues_opened: 40,
    issues_closed: 31,
    prs_opened: 22,
    prs_closed: 19,
    total_additions: 0,
    total_deletions: 0,
  };

  // Catches the regression itself: a cold stats cache returned 200-with-empty,
  // the builder recorded no partial flag, and the row published 0 churn.
  it("refuses the pre-fix row (churn zero, no provenance)", () => {
    const metrics = repoSignals(summary);
    const measured_zero = measuredZeroSignals(metrics, {});
    // The pre-fix builder had no `code_churn` partial flag at all, so the zero
    // was indistinguishable from a real one — and would be waved through as
    // "measured". The guard alone cannot save a path that records nothing;
    // what it does catch is the path that records provenance for some signals
    // and forgets one.
    expect(measured_zero).toContain("code_churn");
    const partialAware = measuredZeroSignals(metrics, { code_churn: true });
    expect(partialAware).not.toContain("code_churn");
    expect(() =>
      assertPerfProvenance({ pk: "PERF#workforce", sk: "REPO", metrics, measured_zero: partialAware }),
    ).toThrow(PerfProvenanceError);
  });

  it("accepts the post-fix row (churn zero, marked degraded)", () => {
    expect(() =>
      assertPerfProvenance({
        pk: "PERF#workforce",
        sk: "REPO",
        metrics: repoSignals(summary),
        degraded_signals: ["code_churn"],
        measured_zero: [],
      }),
    ).not.toThrow();
  });

  it("accepts a genuinely churn-free repo that measured its zero", () => {
    expect(() =>
      assertPerfProvenance({
        pk: "PERF#quiet",
        sk: "REPO",
        metrics: repoSignals(summary),
        degraded_signals: [],
        measured_zero: ["code_churn"],
      }),
    ).not.toThrow();
  });
});
