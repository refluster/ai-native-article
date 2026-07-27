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
  gitPrProvenance,
  githubPrProvenance,
  measuredZeroSignals,
  prSignals,
  repoSignals,
  unprovenancedZeros,
  windowCovered,
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

// ── Call-site derivations ────────────────────────────────────────────────────
// Cycle-1 review (`wf:owen` O1): the cases above all target the predicate, and
// the predicate was never the bug. #498 and #503 were defects in what a caller
// handed the predicate — and cycle 1 shipped a third instance of exactly that
// class (`prPartialBySignal = {}`), which no predicate test could see, because
// from the module's side an empty map is a valid argument handled correctly.
// These exercise the derivations instead. The `githubPrProvenance` block below
// FAILS against cycle-1's code: that is the point.

describe("githubPrProvenance — the /PR GitHub-metadata writer", () => {
  const summary = (over = {}) => ({
    total_prs: 42,
    autopilot_merged: 0,
    total_additions: 0,
    total_deletions: 0,
    ...over,
  });

  // Catches: the cycle-1 defect at build-pr-metrics-github.mjs:306 —
  // `const prPartialBySignal = {}` classified every zero as a measured zero,
  // so assertPerfProvenance had nothing left to refuse and the guard was
  // structurally unable to fire on this path (`wf:dario` D1 / `wf:nadia` N1).
  it("does NOT call a zero measured when the per-PR fan-out came back partial", () => {
    const { measured_zero } = githubPrProvenance(summary(), { prFetchPartial: true });
    expect(measured_zero).toEqual([]);
  });

  // Catches: `wf:ren`'s R1 failure mode — a 403 partway through the fan-out
  // yields `total_prs: 42, total_additions: 0`, literally #503's shape. The
  // fan-out-derived signals must be named as degraded so the row reads as
  // "unknown" on the deck rather than as a real low.
  it("degrades exactly the fan-out-derived signals, leaving total_prs clean", () => {
    const { degraded_signals } = githubPrProvenance(summary(), { prFetchPartial: true });
    expect(degraded_signals).toEqual(["autopilot_merged", "total_additions", "total_deletions"]);
    expect(degraded_signals).not.toContain("total_prs");
  });

  // Catches: a regression that over-corrects into blanket-degrading — the
  // other way teams route around the guard (`wf:dario`'s #505 caveat). A clean
  // fan-out must still get the measured-zero path for free.
  it("keeps measured_zero free when the fan-out completed", () => {
    const { degraded_signals, measured_zero } = githubPrProvenance(summary(), {
      prFetchPartial: false,
    });
    expect(degraded_signals).toEqual([]);
    expect(measured_zero).toEqual(["autopilot_merged", "total_additions", "total_deletions"]);
  });

  // Catches: a partial fetch on a row with no zeros at all being silently
  // dropped — the undercount is still an undercount when the number is > 0.
  it("still reports degraded signals on a fully-populated partial row", () => {
    const { degraded_signals, measured_zero } = githubPrProvenance(
      summary({ autopilot_merged: 7, total_additions: 900, total_deletions: 120 }),
      { prFetchPartial: true },
    );
    expect(degraded_signals).toEqual(["autopilot_merged", "total_additions", "total_deletions"]);
    expect(measured_zero).toEqual([]);
  });

  // Catches: the end-to-end contract — a partial fan-out row must survive the
  // writer guard as an honest unknown rather than throwing or lying.
  it("produces a row the writer guard accepts as unknown, not as a real low", () => {
    const pr_summary = summary();
    const { degraded_signals, measured_zero } = githubPrProvenance(pr_summary, {
      prFetchPartial: true,
    });
    expect(() =>
      assertPerfProvenance({
        pk: "PERF#workforce",
        sk: "PR",
        metrics: prSignals(pr_summary),
        degraded_signals,
        measured_zero,
      }),
    ).not.toThrow();
  });
});

describe("windowCovered — the git-derived writer's coverage probe", () => {
  // Catches: reintroducing a shell-string interpolation of BRANCH
  // (`wf:ren` R2). argv form means a branch name with a space is passed as one
  // argument and fails honestly, instead of resolving to a different command
  // that throws into the catch and lands on "degraded" by accident.
  it("passes the branch as a single argv entry, never a shell string", () => {
    const calls: Array<[string, string[]]> = [];
    windowCovered(
      (file, args) => {
        calls.push([file, args]);
        return "abc123\n";
      },
      { sinceIso: "2026-06-27", branch: "release branch" },
    );
    expect(calls).toEqual([
      ["git", ["rev-list", "-1", "--before=2026-06-27", "release branch"]],
    ]);
  });

  it("reports covered when a commit predates the window start", () => {
    expect(windowCovered(() => "abc123\n", { sinceIso: "2026-06-27", branch: "main" })).toBe(true);
  });

  // Catches: a shallow clone (CI's `fetch-depth: 1`) reading as a quiet month.
  it("reports uncovered when nothing reachable predates the window start", () => {
    expect(windowCovered(() => "\n", { sinceIso: "2026-06-27", branch: "main" })).toBe(false);
  });

  // Catches: "cannot tell" being optimistically treated as covered — the most
  // important sentence in the module, previously guaranteed only by a comment.
  it("treats a throwing probe as uncovered, never as a measured zero", () => {
    expect(
      windowCovered(
        () => {
          throw new Error("fatal: bad revision");
        },
        { sinceIso: "2026-06-27", branch: "main" },
      ),
    ).toBe(false);
  });
});

describe("gitPrProvenance — the /PR git-derived writer", () => {
  const quiet = {
    total_prs: 0,
    autopilot_merged: 0,
    total_additions: 0,
    total_deletions: 0,
  };

  // Catches: the third instance of the class found while wiring cycle 1 — a
  // truncated clone publishing four zeros as a real month. These are the two
  // rows of the PR body's hand-verified table, now pinned.
  it("marks every git-derived signal degraded when the window is truncated", () => {
    const { degraded_signals, measured_zero } = gitPrProvenance(quiet, { windowCovered: false });
    expect(degraded_signals).toEqual([
      "autopilot_merged",
      "total_additions",
      "total_deletions",
      "total_prs",
    ]);
    expect(measured_zero).toEqual([]);
  });

  it("measures its zeros when the history covers the window", () => {
    const { degraded_signals, measured_zero } = gitPrProvenance(
      { ...quiet, total_prs: 31, total_additions: 4200, total_deletions: 900 },
      { windowCovered: true },
    );
    expect(degraded_signals).toEqual([]);
    expect(measured_zero).toEqual(["autopilot_merged"]);
  });

  // Catches: a truncated-window row being refused outright instead of
  // published as an honest unknown (fail-loud must not mean fail-always).
  it("produces a row the writer guard accepts when the window is truncated", () => {
    const { degraded_signals, measured_zero } = gitPrProvenance(quiet, { windowCovered: false });
    expect(() =>
      assertPerfProvenance({
        pk: "PERF#workforce",
        sk: "PR",
        metrics: prSignals(quiet),
        degraded_signals,
        measured_zero,
      }),
    ).not.toThrow();
  });
});
