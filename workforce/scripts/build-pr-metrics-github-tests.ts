// @ts-nocheck — the script under test is dependency-free ESM, not TS.
// Tests the pure classification + aggregation of the GitHub-API PR builder.
import { describe, it, expect } from "vitest";
import {
  classifyPr,
  aggregate,
  aggregateEscalations,
  aggregateReruns,
  fetchPrFacts,
  parseAlsoScopes,
  prProvenanceInputs,
  PR_DETAIL_METRICS,
} from "./build-pr-metrics-github.mjs";
import { assertProvenance, UnprovenanceError } from "./lib/perf-provenance.mjs";

const GREEN = (slug) => `looks good\n<!-- autopilot:review:${slug}:green -->`;

describe("classifyPr (authoritative autopilot signal)", () => {
  it("autopilot-merged: green markers + no needs-human label", () => {
    const r = classifyPr({ bodies: [GREEN("hana"), GREEN("dario")], labels: [] });
    expect(r.autopilotMerged).toBe(true);
    expect(r.reviewers.sort()).toEqual(["dario", "hana"]);
  });
  it("human-involved when the needs-human label is present (even with green markers)", () => {
    const r = classifyPr({ bodies: [GREEN("mateo")], labels: ["autopilot:needs-human"] });
    expect(r.autopilotMerged).toBe(false);
    expect(r.reviewers).toEqual(["mateo"]);
  });
  it("human-involved when there is no green marker", () => {
    expect(classifyPr({ bodies: ["lgtm"], labels: [] }).autopilotMerged).toBe(false);
  });
});

describe("aggregate", () => {
  it("rolls up daily counts, autopilot share, churn, contributors", () => {
    const prs = [
      { merged_at: "2026-06-22T10:00:00Z", additions: 100, deletions: 10, author: "refluster", autopilotMerged: true, reviewers: ["hana", "dario"] },
      { merged_at: "2026-06-22T12:00:00Z", additions: 50, deletions: 5, author: "refluster", autopilotMerged: false, reviewers: ["mateo"] },
      { merged_at: "2026-06-23T09:00:00Z", additions: 20, deletions: 2, author: "someone", autopilotMerged: true, reviewers: ["hana"] },
    ];
    const b = aggregate(prs, { sinceIso: "2026-06-01" });
    expect(b.pr_summary.total_prs).toBe(3);
    expect(b.pr_summary.autopilot_merged).toBe(2);
    expect(b.pr_summary.autopilot_share).toBe(0.667);
    expect(b.pr_summary.total_additions).toBe(170);
    expect(b.window).toEqual({ start: "2026-06-22", end: "2026-06-23" });
    expect(b.pr_daily).toHaveLength(2);
    // humans_involved = authors of non-autopilot PRs only.
    expect(b.pr_summary.humans_involved).toEqual(["refluster"]);
    // hana reviewed 2 → top agent contributor.
    expect(b.pr_contributors[0]).toEqual({ handle: "hana", kind: "agent", prs: 2 });
  });
});

// Epic-019 Story 1: escalated (needs-human) PRs bucket by their
// autopilot:reason:* labels; eligible = the non-L0/L1 share.
describe("aggregateEscalations", () => {
  it("buckets labelled escalations by reason and counts the eligible (non-L0/L1) share", () => {
    const prs = [
      { labels: ["autopilot:needs-human", "autopilot:reason:l0l1-path"] },
      { labels: ["autopilot:needs-human", "autopilot:reason:no-reviewer-consensus"] },
      { labels: ["autopilot:needs-human", "Autopilot:Reason:Stale-Routed"] }, // labels keep GitHub case
      { labels: ["autopilot:needs-human"] }, // the coverage gap — visible, not dropped
    ];
    const e = aggregateEscalations(prs);
    expect(e.escalated_prs).toBe(4);
    expect(e.eligible_escalations).toBe(3);
    expect(e.escalation_reasons).toEqual({
      "l0l1-path": 1,
      "no-reviewer-consensus": 1,
      "stale-routed": 1,
      unspecified: 1,
    });
  });

  it("a PR with several reason labels counts once per bucket, once in the totals", () => {
    const e = aggregateEscalations([
      { labels: ["autopilot:reason:l0l1-path", "autopilot:reason:cycle-cap-exceeded", "autopilot:reason:l0l1-path"] },
    ]);
    expect(e.escalated_prs).toBe(1);
    expect(e.eligible_escalations).toBe(0);
    expect(e.escalation_reasons).toEqual({ "l0l1-path": 1, "cycle-cap-exceeded": 1 });
  });

  it("empty input yields an empty funnel", () => {
    expect(aggregateEscalations([])).toEqual({ escalated_prs: 0, eligible_escalations: 0, escalation_reasons: {} });
  });
});

// Epic-019 Story 2c: `autopilot:reran` PRs roll up into per-check rerun /
// rerun-then-pass counts (from the flaky-rerun audit markers), so a racy
// check — repeatedly passing only on rerun — is detectable and gets a WARN.
describe("aggregateReruns", () => {
  const marker = (names: string[]) => `<!-- autopilot:rerun:1 checks=${names.join("|")} -->`;

  it("counts reruns and rerun-then-pass per check from the audit markers", () => {
    const r = aggregateReruns([
      { merged: true, labels: ["autopilot:reran"], bodies: [`audit…\n${marker(["integration-e2e"])}`] },
      { merged: false, labels: ["autopilot:reran", "autopilot:needs-human", "autopilot:reason:checks-failing"], bodies: [marker(["integration-e2e", "lambda-smoke"])] },
    ]);
    expect(r.reran_prs).toBe(2);
    expect(r.per_check["integration-e2e"]).toEqual({ reruns: 2, rerun_then_pass: 1 });
    expect(r.per_check["lambda-smoke"]).toEqual({ reruns: 1, rerun_then_pass: 0 });
  });

  it("an open, un-escalated reran PR counts as rerun-then-pass (no checks-failing label)", () => {
    const r = aggregateReruns([{ merged: false, labels: ["autopilot:reran"], bodies: [marker(["e2e"])] }]);
    expect(r.per_check["e2e"]).toEqual({ reruns: 1, rerun_then_pass: 1 });
  });

  it("a reran-labelled PR missing its marker buckets as unspecified — visible, not dropped", () => {
    const r = aggregateReruns([{ merged: true, labels: ["autopilot:reran"], bodies: ["no marker here"] }]);
    expect(r.per_check).toEqual({ unspecified: { reruns: 1, rerun_then_pass: 1 } });
    expect(r.warn).toEqual([]); // unspecified never trips the racy WARN
  });

  it("a check at/over the rerun-then-pass threshold is flagged racy (WARN)", () => {
    const items = [1, 2, 3].map(() => ({ merged: true, labels: ["autopilot:reran"], bodies: [marker(["racy-suite"])] }));
    const r = aggregateReruns(items);
    expect(r.warn).toEqual(["racy-suite"]);
    expect(aggregateReruns(items.slice(0, 2)).warn).toEqual([]);
  });

  it("empty input yields an empty roll-up", () => {
    expect(aggregateReruns([])).toEqual({ reran_prs: 0, per_check: {}, warn: [] });
  });
});

// Production 2026-09-13: this loop spends three core-quota calls per merged PR
// over a 180-day window — ~5300 calls across the scopes against a 5000/h quota
// every project now shares through one PAT. It ran out mid-run, and the old
// code read `p.additions || 0` off each refused response: every PR past the
// limit entered the roll-up as a real PR that happened to change zero lines,
// which is indistinguishable from a tiny PR and silently drags the average
// down. An undercount announces itself; a false zero does not.
describe("fetchPrFacts (a PR whose detail never arrived is dropped, not zeroed)", () => {
  const item = (n) => ({ number: n, closed_at: "2026-09-01T00:00:00Z", labels: [], user: { login: "someone" } });
  const ok = (n) => ({
    status: 200,
    json: { number: n, merged_at: "2026-09-01T00:00:00Z", additions: 100, deletions: 5, user: { login: "dev" } },
  });
  const empty = { status: 200, json: [] };

  /** Routes the three per-PR calls, failing `/pulls/{n}` for the listed numbers. */
  const router = (failures: Record<number, unknown>) => async (path: string) => {
    const m = /\/pulls\/(\d+)$/.exec(path);
    if (!m) return empty;
    const n = Number(m[1]);
    return failures[n] ?? ok(n);
  };

  it("keeps the PRs it could read and counts the ones it could not", async () => {
    const gh = router({ 2: { status: 404, json: {} } });
    const r = await fetchPrFacts(gh, "o/r", [item(1), item(2), item(3)]);
    expect(r.prs).toHaveLength(2);
    expect(r.skipped).toBe(1);
    expect(r.quotaExhausted).toBe(false);
    // The dropped PR contributes no churn AT ALL — not a zero-line PR.
    expect(r.prs.every((p) => p.additions === 100)).toBe(true);
  });

  it("stops the loop on a spent quota instead of issuing doomed calls", async () => {
    let calls = 0;
    const limited = {
      status: 403,
      json: { message: "API rate limit exceeded for user ID 1" },
      rateLimit: { remaining: 0, resetAt: "2026-09-13T17:00:00.000Z" },
    };
    const gh = async (path: string) => {
      calls += 1;
      const m = /\/pulls\/(\d+)$/.exec(path);
      if (!m) return empty;
      const n = Number(m[1]);
      return n >= 3 ? limited : ok(n);
    };
    const merged = Array.from({ length: 50 }, (_, i) => item(i + 1));
    const r = await fetchPrFacts(gh, "o/r", merged);
    expect(r.prs).toHaveLength(2);
    expect(r.quotaExhausted).toBe(true);
    // Two PRs fetched (3 calls each) plus the one that hit the limit — and then
    // nothing: 47 more PRs would have cost 141 refusals.
    expect(calls).toBe(9);
  });

  it("reports a clean run as clean", async () => {
    const r = await fetchPrFacts(router({}), "o/r", [item(1), item(2)]);
    expect(r).toMatchObject({ skipped: 0, quotaExhausted: false });
    expect(r.prs).toHaveLength(2);
  });
});

// pr-autopilot review (farah, QA/SRE lens), PR #729: `collapseByRepo()` in
// refresh.mjs decides WHICH scopes to fold, but the CLI plumbing that actually
// carries that decision into this script — `--also-scope`, i.e. the single
// largest cut in the run's quota cost — had no direct test; only the grouping
// logic (refresh-tests.ts) was covered. Extracted so it is.
describe("parseAlsoScopes", () => {
  it("splits, trims, and drops blanks", () => {
    expect(parseAlsoScopes("agent-workforce, foo ,,bar", "workforce")).toEqual([
      "agent-workforce",
      "foo",
      "bar",
    ]);
  });

  it("drops an entry that duplicates the primary scope", () => {
    expect(parseAlsoScopes("workforce,agent-workforce", "workforce")).toEqual(["agent-workforce"]);
  });

  it("returns [] for an absent or empty flag", () => {
    expect(parseAlsoScopes(undefined, "workforce")).toEqual([]);
    expect(parseAlsoScopes("", "workforce")).toEqual([]);
    expect(parseAlsoScopes(true, "workforce")).toEqual([]); // arg() returns `true` for a bare flag
  });
});

// #505: end-to-end wiring of the shared writer-boundary guard onto this
// builder's own PR-row shape — `skipped > 0` is exactly the "a fetch
// degraded and the row would otherwise read as a confident zero" case.
describe("PERF#{scope}/PR row provenance (#505)", () => {
  it("a fully-quiet, fully-fetched window (0 merged PRs, skipped 0) publishes", () => {
    expect(() =>
      assertProvenance({
        scope: "conference",
        sk: "PR",
        metrics: { total_prs: 0, total_additions: 0, total_deletions: 0 },
        unmeasured: [],
      }),
    ).not.toThrow();
  });

  it("every merged PR's detail dropped (skipped > 0) refuses the all-zero row", () => {
    expect(() =>
      assertProvenance({
        scope: "acme",
        sk: "PR",
        metrics: { total_prs: 0, total_additions: 0, total_deletions: 0 },
        unmeasured: PR_DETAIL_METRICS,
      }),
    ).toThrow(UnprovenanceError);
  });

  // #752 O1: the two tests above call `assertProvenance` with hand-built
  // `metrics`/`unmeasured` — they never exercise `prProvenanceInputs`, so a
  // bug in how it actually derives those from `aggregate()`'s block + the
  // real `skipped` count would pass both untouched. These two go through the
  // full pipeline: a fake `gh` that drops a merged PR's detail (mirroring a
  // degraded `fetchPrFacts` run) -> `aggregate` -> `prProvenanceInputs` ->
  // `assertProvenance`.
  const merged = [{ number: 1 }];
  const ghDropsDetail = async (path: string) =>
    path.includes("/pulls/1") && !path.includes("reviews")
      ? { status: 502, json: {}, rateLimit: {} }
      : { status: 200, json: [], rateLimit: {} };
  const ghServesDetail = async (path: string) =>
    path.includes("/pulls/1") && !path.includes("reviews")
      ? { status: 200, json: { number: 1, merged_at: "2026-06-22T10:00:00Z", additions: 10, deletions: 2, user: { login: "refluster" } }, rateLimit: {} }
      : { status: 200, json: [], rateLimit: {} };

  it("a degraded fetchPrFacts run (detail dropped) produces inputs the guard refuses", async () => {
    const { prs, skipped } = await fetchPrFacts(ghDropsDetail, "o/r", merged);
    expect(skipped).toBe(1);
    const block = aggregate(prs, { sinceIso: "2026-06-01" });
    const { metrics, unmeasured } = prProvenanceInputs(block, skipped);
    expect(metrics).toEqual({ total_prs: 0, total_additions: 0, total_deletions: 0 });
    expect(unmeasured).toEqual(PR_DETAIL_METRICS);
    expect(() => assertProvenance({ scope: "acme", sk: "PR", metrics, unmeasured })).toThrow(UnprovenanceError);
  });

  it("a clean fetchPrFacts run (detail served) produces inputs the guard publishes", async () => {
    const { prs, skipped } = await fetchPrFacts(ghServesDetail, "o/r", merged);
    expect(skipped).toBe(0);
    const block = aggregate(prs, { sinceIso: "2026-06-01" });
    const { metrics, unmeasured } = prProvenanceInputs(block, skipped);
    expect(unmeasured).toEqual([]);
    expect(() => assertProvenance({ scope: "acme", sk: "PR", metrics, unmeasured })).not.toThrow();
  });
});
