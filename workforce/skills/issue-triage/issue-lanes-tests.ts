// @ts-nocheck — the modules under test are dependency-free ESM scripts, not TS.
// Discovered by workforce/lambdas/vitest.config.mjs (`../skills/**/*-tests.ts`).
//
// Locks the dispatcher's invariants (adr-0022, extended by adr-0038):
//   1. every issue is in EXACTLY ONE lane — the question "who owns this?" has
//      one answer, which is the whole reason the vocabulary exists;
//   2. no state is absorbing — a hand-back is answered immediately and a legacy
//      park is re-examined after the requeue window, instead of ageing out of
//      everyone's scan (how the 2026-07 backlog tail, and asp-cloud's 18-issue
//      one, both formed);
//   3. routing is BOUNDED — the hop cap stops route → hand back → route from
//      cycling forever now that each step takes seconds rather than a fortnight;
//   4. "a human" is never an answer on its own — the operator lane names the
//      human ACT (`wf:human:<role>`), which is what makes the design/residue
//      split checkable.
import { describe, it, expect } from "vitest";
import {
  HOP_CAP,
  HUMAN_ROLE_NAMES,
  LANE_NAMES,
  LANE_WORKER_SKILL,
  LEGACY_PARKED_LABELS,
  applyHopCap,
  assertHumanRole,
  assertLane,
  hopMarker,
  humanRoleLabel,
  humanRoleOf,
  laneLabel,
  laneOf,
  ownerLabel,
  parseHops,
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

  it("every agent-worked lane names the cadence that consumes it — and only the operator lane has none", () => {
    // The other half of "a lane exists only where a real consumer exists".
    // check-binding-queues.mjs (R-N11) and the router's dispatch both read this.
    for (const lane of LANE_NAMES) {
      expect(LANE_WORKER_SKILL).toHaveProperty(lane);
    }
    expect(LANE_WORKER_SKILL.implement).toBe("issue-implement");
    expect(LANE_WORKER_SKILL.design).toBe("issue-design");
    expect(LANE_WORKER_SKILL.operator).toBeNull();
  });
});

describe("the operator lane names the human act (adr-0038)", () => {
  it("the role set is closed, like the lanes", () => {
    expect(HUMAN_ROLE_NAMES).toContain("architect-ratify");
    expect(HUMAN_ROLE_NAMES).toContain("legal");
    expect(() => assertHumanRole("vibes")).toThrow(/unknown human role/);
  });

  it("role labels round-trip", () => {
    expect(humanRoleLabel("legal")).toBe("wf:human:legal");
    expect(humanRoleOf(["type:chore", "wf:human:architect-ratify"])).toBe("architect-ratify");
    expect(humanRoleOf(["type:chore"])).toBeNull();
  });

  it("a typo'd role is refused rather than silently shelved in an unread queue", () => {
    expect(() => humanRoleOf(["wf:human:leagl"])).toThrow(/unknown human role/);
  });
});

describe("labelsToRemove — one issue, one lane, and the park is answered", () => {
  it("re-laning removes the previous lane label", () => {
    expect(labelsToRemove(["wf:lane:implement", "type:feature"], "design")).toEqual(["wf:lane:implement"]);
  });

  it("re-applying the same lane removes nothing", () => {
    expect(labelsToRemove(["wf:lane:design"], "design")).toEqual([]);
  });

  it("posting a lane always clears the hand-back — the answer IS the un-park (adr-0038)", () => {
    // Pre-adr-0038 this needed an explicit `--requeue` flag; the flag existed
    // only to decide whether to clear, and a router posting a lane has by
    // definition decided. Removing it removed a state, not just an argument.
    expect(labelsToRemove(["wf:handback", "wf:lane:implement"], "design")).toEqual(
      expect.arrayContaining(["wf:handback", "wf:lane:implement"]),
    );
  });

  it("the legacy needs-human parks are still cleared, so the existing backlog re-enters the loop", () => {
    for (const legacy of LEGACY_PARKED_LABELS) {
      expect(labelsToRemove([legacy], "implement")).toEqual([legacy]);
    }
  });

  it("a stale human role is dropped when the issue leaves the operator lane", () => {
    expect(labelsToRemove(["wf:human:legal", "wf:lane:operator"], "implement")).toEqual(
      expect.arrayContaining(["wf:human:legal", "wf:lane:operator"]),
    );
  });

  it("the role in force is kept when the issue stays on the operator lane", () => {
    expect(labelsToRemove(["wf:human:legal", "wf:lane:operator"], "operator", { humanRole: "legal" })).toEqual([]);
  });

  it("swapping one human role for another drops only the old one", () => {
    expect(labelsToRemove(["wf:human:legal"], "operator", { humanRole: "product" })).toEqual(["wf:human:legal"]);
  });
});

describe("the hop bound — routing terminates (adr-0038)", () => {
  it("counts the highest marker, so a failed post cannot reset the bound", () => {
    expect(parseHops(["no marker here"])).toBe(0);
    expect(parseHops([`a ${hopMarker(1)} b`, `c ${hopMarker(3)} d`, hopMarker(2)])).toBe(3);
  });

  it("refuses to write a nonsense marker (C-4)", () => {
    expect(() => hopMarker(0)).toThrow(/positive integer/);
    expect(() => hopMarker("two")).toThrow(/positive integer/);
  });

  it("passes the requested lane through below the cap", () => {
    const r = applyHopCap("design", 0);
    expect(r).toMatchObject({ lane: "design", hops: 1, capped: false });
  });

  it("forces the operator lane once the cap is spent, and says why", () => {
    const r = applyHopCap("implement", HOP_CAP);
    expect(r.lane).toBe("operator");
    expect(r.capped).toBe(true);
    expect(r.why).toMatch(/hop-cap-exceeded/);
  });

  it("route → hand back → route cannot cycle forever", () => {
    // The ping-pong, played out: each iteration re-lanes, and the bound holds.
    let hops = 0;
    const lanes: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = applyHopCap("implement", hops);
      hops = r.hops;
      lanes.push(r.lane);
    }
    expect(lanes.slice(0, HOP_CAP)).toEqual(Array(HOP_CAP).fill("implement"));
    expect(lanes.slice(HOP_CAP).every((l) => l === "operator")).toBe(true);
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

  it("a hand-back is answered NOW, not in a fortnight — the latency fix (adr-0038)", () => {
    // The worker read the issue this minute and declined. Waiting out the
    // requeue window adds 14 days of latency and no information.
    const handed = { labels: ["wf:handback", "wf:lane:implement"], updatedAt: daysAgo(0) };
    expect(triageAction(handed, { now })).toMatchObject({ action: "requeue" });
  });

  it("a hand-back outranks the in-lane skip, or the router would never see it", () => {
    expect(triageAction({ labels: ["wf:handback", "wf:lane:design"], updatedAt: daysAgo(0) }, { now }).action).toBe("requeue");
  });

  it("but a worker actively holding the issue still wins over a stale hand-back label", () => {
    const both = { labels: ["wf:handback", "issue-implement:in-progress"], updatedAt: daysAgo(0) };
    expect(triageAction(both, { now })).toMatchObject({ action: "skip" });
  });

  it("a legacy parked issue is re-examined once it goes stale — this is the un-absorbing rule", () => {
    const parked = { labels: ["issue-implement:needs-human"], updatedAt: daysAgo(DEFAULT_REQUEUE_DAYS + 1) };
    expect(triageAction(parked, { now })).toMatchObject({ action: "requeue" });
  });

  it("a freshly parked legacy issue is left to its window", () => {
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
