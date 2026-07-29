// @ts-nocheck — the scripts under test (pr-remediate-*.mjs) are dependency-free
// ESM scripts, not TS; vitest/esbuild imports them fine at runtime, and this
// suite is not shipped code. Discovered by workforce/lambdas/vitest.config.mjs
// (`include: ["../skills/**/*-tests.ts"]`).
//
// Locks the AUTHOR lane's decision surface (adr-0022). Two properties matter
// more than any individual case:
//   1. the cadence never touches a PR that is not its own (not-in-lane /
//      terminal / paused), and
//   2. the lane is BOUNDED — the attempt cap is checked before any work is
//      classified as actionable, and an unclassifiable PR escalates rather than
//      sitting in the queue forever.
import { describe, it, expect } from "vitest";
import { classifyRemediation, reasonCodesFrom } from "./pr-remediate-scan.mjs";
import { labelsToClearOnResolve, assertBlockedReason, claimBody } from "./pr-remediate-post.mjs";
import { AUTHOR_LABEL, ESCALATION_LABEL, REMEDIATION_CAP, countRemediationAttempts } from "../pr-autopilot/pr-merge.mjs";

const inLane = (over = {}) => ({ labels: [AUTHOR_LABEL], mergeable: true, mergeableState: "clean", reasons: [], attempts: 0, ...over });

describe("classifyRemediation — whose PR is this?", () => {
  it("a PR without the author label is never touched", () => {
    expect(classifyRemediation({ labels: [], mergeableState: "dirty" })).toMatchObject({ kind: "not-in-lane", actionable: false });
  });

  it("the human lane wins when both labels are present — a human owns it", () => {
    const v = classifyRemediation(inLane({ labels: [AUTHOR_LABEL, ESCALATION_LABEL], mergeableState: "dirty" }));
    expect(v).toMatchObject({ kind: "terminal", actionable: false });
  });

  it("autopilot:off pauses this cadence too", () => {
    expect(classifyRemediation(inLane({ labels: [AUTHOR_LABEL, "autopilot:off"], mergeableState: "dirty" }))).toMatchObject({
      kind: "not-in-lane",
    });
  });
});

describe("classifyRemediation — the bound comes before the work", () => {
  it("a PR at the cap escalates, even with a plainly fixable conflict", () => {
    const v = classifyRemediation(inLane({ mergeableState: "dirty", attempts: REMEDIATION_CAP }));
    expect(v).toMatchObject({ kind: "cap-exceeded", actionable: false, escalate: "remediation-cap-exceeded" });
  });

  it("one attempt below the cap is still actionable", () => {
    expect(classifyRemediation(inLane({ mergeableState: "dirty", attempts: REMEDIATION_CAP - 1 }))).toMatchObject({
      kind: "merge-conflict",
      actionable: true,
    });
  });
});

describe("classifyRemediation — kind ordering", () => {
  it("a conflict outranks findings and checks: the tree they describe will not survive the merge", () => {
    const v = classifyRemediation(inLane({ mergeableState: "dirty", reasons: ["review-findings-open", "checks-failing"] }));
    expect(v.kind).toBe("merge-conflict");
  });

  it("mergeable=false alone (state not yet computed) is still a conflict", () => {
    expect(classifyRemediation(inLane({ mergeable: false, mergeableState: "" })).kind).toBe("merge-conflict");
  });

  it("behind is its own, weaker case", () => {
    expect(classifyRemediation(inLane({ mergeableState: "behind" })).kind).toBe("branch-behind");
  });

  it("a stated finding outranks a red check", () => {
    const v = classifyRemediation(inLane({ reasons: ["checks-failing", "review-findings-open"] }));
    expect(v.kind).toBe("review-findings");
  });

  it("a red check alone is actionable", () => {
    expect(classifyRemediation(inLane({ reasons: ["checks-failing"] })).kind).toBe("checks-failing");
  });
});

describe("classifyRemediation — an unclassifiable PR escalates, never idles", () => {
  it("parked in the lane, clean, no reason codes -> unclear + escalate", () => {
    const v = classifyRemediation(inLane());
    expect(v).toMatchObject({ kind: "unclear", actionable: false, escalate: "remediation-blocked" });
  });
});

describe("reasonCodesFrom — the hand-off's own words", () => {
  it("collects codes across bodies, de-duplicated and order-preserving", () => {
    const bodies = [
      "verdict <!-- autopilot:reason:merge-conflict -->",
      "sweep <!-- autopilot:reason:merge-conflict --> <!-- autopilot:reason:review-findings-open -->",
    ];
    expect(reasonCodesFrom(bodies)).toEqual(["merge-conflict", "review-findings-open"]);
  });

  it("an unknown code throws (C-4) rather than being read as a new bucket", () => {
    expect(() => reasonCodesFrom(["<!-- autopilot:reason:made-up -->"])).toThrow(/unknown/);
  });
});

describe("pr-remediate-post — leaving the lane cleanly", () => {
  it("a resolved attempt clears the author label and its stale author-lane reasons only", () => {
    const cleared = labelsToClearOnResolve([
      AUTHOR_LABEL,
      "autopilot:reason:merge-conflict",
      "autopilot:reason:l0l1-path",
      "type:chore",
    ]);
    expect(cleared).toEqual([AUTHOR_LABEL, "autopilot:reason:merge-conflict"]);
  });

  it("a blocked hand-off cannot carry an author-lane reason — that is the state being left", () => {
    expect(() => assertBlockedReason("merge-conflict")).toThrow(/cannot carry the author-lane reason/);
    expect(() => assertBlockedReason("review-findings-open")).toThrow(/cannot carry the author-lane reason/);
  });

  it("the two exit reasons and specific human-lane clauses are accepted", () => {
    for (const code of ["remediation-blocked", "remediation-cap-exceeded", "l0l1-path"]) {
      expect(() => assertBlockedReason(code)).not.toThrow();
    }
  });

  it("an unknown blocked reason throws", () => {
    expect(() => assertBlockedReason("gave-up")).toThrow(/unknown/);
  });
});

// wf:farah F1 on #518: a cap the bounded cadence increments only on success is
// not a cap. The claim comment is what spends the attempt BEFORE the work, so a
// run that dies mid-attempt cannot refund itself — these lock that the claim
// carries the counter and nothing that depends on the work having succeeded.
describe("claimBody — the attempt is spent before the work", () => {
  it("carries the attempt marker the cap is counted from", () => {
    expect(claimBody(2)).toContain("<!-- autopilot:remediation:2 -->");
  });

  it("is round-trippable by the counter", () => {
    expect(countRemediationAttempts([claimBody(1), claimBody(2)])).toBe(2);
  });

  it("claims nothing about an outcome — it is posted before there is one", () => {
    const body = claimBody(1).toLowerCase();
    for (const word of ["resolved", "fixed", "pushed to", "verified"]) expect(body).not.toContain(word);
  });

  it("refuses to render an attempt past the cap", () => {
    expect(() => claimBody(REMEDIATION_CAP + 1)).toThrow(/remediation-cap-exceeded/);
  });
});
