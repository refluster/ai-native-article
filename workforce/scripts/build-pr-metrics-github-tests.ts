// @ts-nocheck — the script under test is dependency-free ESM, not TS.
// Tests the pure classification + aggregation of the GitHub-API PR builder.
import { describe, it, expect } from "vitest";
import { classifyPr, aggregate, aggregateEscalations } from "./build-pr-metrics-github.mjs";

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
