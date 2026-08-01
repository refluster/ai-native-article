// @ts-nocheck — the modules under test are dependency-free ESM scripts, not TS.
// Discovered by workforce/lambdas/vitest.config.mjs (`../skills/**/*-tests.ts`).
//
// Locks the dispatcher's two invariants (adr-0022):
//   1. every issue is in EXACTLY ONE lane — the question "who owns this?" has
//      one answer, which is the whole reason the vocabulary exists;
//   2. no state is absorbing — a parked issue is re-examined after the requeue
//      window instead of ageing out of everyone's scan, which is how the
//      2026-07 backlog tail formed.
import { describe, it, expect } from "vitest";
import {
  LANE_NAMES,
  assertLane,
  laneLabel,
  laneOf,
  ownerLabel,
  triageAction,
  suggestLane,
  DEFAULT_REQUEUE_DAYS,
} from "./issue-lanes.mjs";
import { labelsToRemove } from "./issue-triage-post.mjs";

describe("the lane vocabulary is closed (C-4)", () => {
  it("exposes exactly the three wired lanes", () => {
    expect(LANE_NAMES).toEqual(["implement", "design", "operator"]);
  });

  it("an unknown lane throws rather than becoming a label nobody consumes", () => {
    expect(() => assertLane("research")).toThrow(/unknown lane/);
    expect(() => laneLabel("")).toThrow(/unknown lane/);
  });

  it("laneOf reads the lane back, and rejects a typo'd one", () => {
    expect(laneOf(["type:chore", "wf:lane:design"])).toBe("design");
    expect(laneOf(["type:chore"])).toBeNull();
    expect(() => laneOf(["wf:lane:desgin"])).toThrow(/unknown lane/);
  });

  it("owner labels are slugs, never GitHub handles (ML-012)", () => {
    expect(ownerLabel("dario")).toBe("wf:owner:dario");
    expect(() => ownerLabel("@dario")).toThrow(/agent slug/);
  });
});

describe("labelsToRemove — one issue, one lane", () => {
  it("re-laning removes the previous lane label", () => {
    expect(labelsToRemove(["wf:lane:implement", "type:feature"], "design")).toEqual(["wf:lane:implement"]);
  });

  it("re-applying the same lane removes nothing", () => {
    expect(labelsToRemove(["wf:lane:design"], "design")).toEqual([]);
  });

  it("--requeue also clears the parked needs-human labels — the absorbing state ends", () => {
    const out = labelsToRemove(["issue-implement:needs-human", "wf:lane:implement"], "design", { requeue: true });
    expect(out).toContain("issue-implement:needs-human");
    expect(out).toContain("wf:lane:implement");
  });

  it("without --requeue a parked label is left alone", () => {
    expect(labelsToRemove(["issue-implement:needs-human"], "implement")).toEqual([]);
  });
});

describe("triageAction — what the router should look at", () => {
  const now = Date.parse("2026-07-29T00:00:00Z");
  const daysAgo = (d) => new Date(now - d * 86400_000).toISOString();

  it("an unlaned issue needs a decision", () => {
    expect(triageAction({ labels: ["type:chore"], updatedAt: daysAgo(1) }, { now })).toMatchObject({ action: "triage" });
  });

  it("an already-laned issue is left alone", () => {
    expect(triageAction({ labels: ["wf:lane:design"], updatedAt: daysAgo(90) }, { now })).toMatchObject({
      action: "skip",
      current: "design",
    });
  });

  it("an issue a worker holds right now is never re-triaged out from under it", () => {
    for (const held of ["issue-implement:in-progress", "issue-implement:pr-open", "issue-design:in-progress"]) {
      expect(triageAction({ labels: [held], updatedAt: daysAgo(365) }, { now })).toMatchObject({ action: "skip" });
    }
  });

  it("a parked issue is re-examined once it goes stale — this is the un-absorbing rule", () => {
    const parked = { labels: ["issue-implement:needs-human"], updatedAt: daysAgo(DEFAULT_REQUEUE_DAYS + 1) };
    expect(triageAction(parked, { now })).toMatchObject({ action: "requeue" });
  });

  it("a freshly parked issue is left to its window", () => {
    const parked = { labels: ["issue-implement:needs-human"], updatedAt: daysAgo(2) };
    expect(triageAction(parked, { now })).toMatchObject({ action: "skip" });
  });

  it("the requeue window is configurable per binding", () => {
    const parked = { labels: ["issue-design:needs-human"], updatedAt: daysAgo(5) };
    expect(triageAction(parked, { now, requeueDays: 3 })).toMatchObject({ action: "requeue" });
    expect(triageAction(parked, { now, requeueDays: 30 })).toMatchObject({ action: "skip" });
  });

  it("an unparseable timestamp is left alone rather than guessed at", () => {
    expect(triageAction({ labels: ["issue-implement:needs-human"], updatedAt: "soon" }, { now })).toMatchObject({ action: "skip" });
  });
});

describe("suggestLane — a starting point, not the decision", () => {
  it("routes the stalled tail to design: architecture / L1 / tracker", () => {
    expect(suggestLane({ labels: ["role:architecture", "type:feature"] })).toBe("design");
    expect(suggestLane({ labels: ["layer:L1", "area:docs"] })).toBe("design");
    expect(suggestLane({ labels: ["type:tracker"] })).toBe("design");
  });

  it("an infra/ops issue defaults to the operator lane", () => {
    expect(suggestLane({ labels: ["type:ops", "area:infra"] })).toBe("operator");
  });

  it("an ops-labelled feature is still implementable", () => {
    expect(suggestLane({ labels: ["type:ops", "type:feature"] })).toBe("implement");
  });

  it("ordinary product labels suggest implement", () => {
    expect(suggestLane({ labels: ["type:chore", "area:backend"] })).toBe("implement");
  });

  it("no usable labels -> no suggestion; the router reads the issue", () => {
    expect(suggestLane({ labels: ["insights"] })).toBeNull();
    expect(suggestLane({})).toBeNull();
  });
});
