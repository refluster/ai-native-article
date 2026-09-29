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
  LANE_ENTRY_DENY,
  issueRefsOfPr,
  laneEntryConflicts,
  ownerOf,
  CLOSE_STATE_REASON,
  CLOSE_VERDICTS,
  DEFAULT_REVIEW_DAYS,
  SETTLE_VERDICT_NAMES,
  assertSettleVerdict,
  closedLabel,
  needsSettleReview,
  settleRefusal,
  wasReopened,
} from "./issue-lanes.mjs";
import { labelsToRemove, laneRefusal } from "./issue-triage-post.mjs";
import { settleComment } from "./issue-triage-settle.mjs";
import { BINDINGS } from "../../scripts/lib/bindings-manifest.mjs";

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

  it("#762: re-laning to a different owner drops the stale wf:owner:* label, not just the lane", () => {
    expect(
      labelsToRemove(["wf:lane:design", "wf:owner:dario"], "design", { owner: "nadia" }),
    ).toEqual(["wf:owner:dario"]);
  });

  it("#762: re-applying the same owner keeps the label", () => {
    expect(labelsToRemove(["wf:owner:dario"], "design", { owner: "dario" })).toEqual([]);
  });

  it("#762: mirrors humanRole's default — omitting `owner` keeps nothing, same as omitting `humanRole`", () => {
    expect(labelsToRemove(["wf:owner:dario"], "design")).toEqual(["wf:owner:dario"]);
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

describe("no dead ends — a lane state no worker can act on goes back to the router", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  const daysAgo = (d) => new Date(now - d * 86400_000).toISOString();
  const hoursAgo = (h) => new Date(now - h * 3600_000).toISOString();
  const bound = { implement: ["ren"], design: ["dario"] };

  it("issueRefsOfPr reads closing keywords, Refs, and the worker branch convention", () => {
    expect([...issueRefsOfPr({ body: "Closes #505\n\nsummary", headRef: "ren/issue-505-perf" })]).toEqual([505]);
    expect([...issueRefsOfPr({ body: "Refs #768 — the ADR only", headRef: "dario/adr" })]).toEqual([768]);
    expect([...issueRefsOfPr({ body: "fixes: #12 and resolves #13" })].sort()).toEqual([12, 13]);
    expect([...issueRefsOfPr({ headRef: "dario/issue-769-deprecation-removal-date-rule" })]).toEqual([769]);
  });

  it("issueRefsOfPr ignores a bare mention and another repo's tracker", () => {
    expect(issueRefsOfPr({ body: "see #12; related to #13" }).size).toBe(0);
    expect(issueRefsOfPr({ body: "Closes PSVL/asp-cloud#866" }).size).toBe(0);
    expect(issueRefsOfPr({ headRef: "claude/tissue-12-x" }).size).toBe(0);
  });

  it("a pr-open claim with a live PR is still held", () => {
    const held = { labels: ["issue-implement:pr-open", "wf:lane:implement"], updatedAt: daysAgo(9), number: 505 };
    expect(triageAction(held, { now, openPrRefs: new Set([505]) })).toMatchObject({ action: "skip" });
  });

  it("a pr-open claim whose PR merged as a partial slice is released (#671/#672/#673)", () => {
    const orphan = { labels: ["issue-implement:pr-open", "type:bug"], updatedAt: daysAgo(18), number: 671 };
    const r = triageAction(orphan, { now, openPrRefs: new Set([505]) });
    expect(r.action).toBe("requeue");
    expect(r.why).toMatch(/stale claim.*no open PR references #671/);
  });

  it("an in-progress marker is a dead run only after a day without a PR", () => {
    const fresh = { labels: ["issue-design:in-progress"], updatedAt: hoursAgo(2), number: 9 };
    const dead = { labels: ["issue-design:in-progress"], updatedAt: hoursAgo(30), number: 9 };
    expect(triageAction(fresh, { now, openPrRefs: new Set() }).action).toBe("skip");
    expect(triageAction(dead, { now, openPrRefs: new Set() })).toMatchObject({ action: "requeue" });
  });

  it("parked AND laned is answered now, not after a window every bot comment resets (#664)", () => {
    const both = { labels: ["issue-implement:needs-human", "wf:lane:implement", "wf:owner:ren"], updatedAt: daysAgo(1), number: 664 };
    expect(triageAction(both, { now })).toMatchObject({ action: "requeue" });
    // An unlaned legacy park keeps the adr-0038 window.
    const parkedOnly = { labels: ["issue-implement:needs-human"], updatedAt: daysAgo(1), number: 355 };
    expect(triageAction(parkedOnly, { now }).action).toBe("skip");
  });

  it("an implement lane on a label its worker denies is a dead end (#572, layer:L1)", () => {
    const dead = { labels: ["layer:L1", "wf:lane:implement", "wf:owner:ren"], updatedAt: daysAgo(18), number: 572 };
    const r = triageAction(dead, { now });
    expect(r.action).toBe("requeue");
    expect(r.why).toMatch(/layer:l1/);
    expect(laneEntryConflicts("design", ["layer:L1", "type:tracker"])).toEqual([]);
  });

  it("an owner with no binding for the lane's worker strands the issue (#739 sana, #659 nadia)", () => {
    const stranded = { labels: ["wf:lane:implement", "wf:owner:sana"], updatedAt: daysAgo(3), number: 739 };
    expect(triageAction(stranded, { now, workerOwners: bound })).toMatchObject({ action: "requeue" });
    const fine = { labels: ["wf:lane:design", "wf:owner:dario"], updatedAt: daysAgo(3), number: 768 };
    expect(triageAction(fine, { now, workerOwners: bound }).action).toBe("skip");
    // Unknown roster (API unreachable) → the check is skipped, never guessed.
    expect(triageAction(stranded, { now }).action).toBe("skip");
    // The operator lane has no worker, so any owner is fine there.
    const op = { labels: ["wf:lane:operator", "wf:owner:maya", "wf:human:console"], updatedAt: daysAgo(3), number: 687 };
    expect(triageAction(op, { now, workerOwners: bound }).action).toBe("skip");
  });

  it("ownerOf reads the one owner label", () => {
    expect(ownerOf(["wf:lane:design", "wf:owner:Dario"])).toBe("dario");
    expect(ownerOf(["wf:lane:design"])).toBeNull();
  });

  it("LANE_ENTRY_DENY stays inside every issue-implement binding's deny-list — the two cannot drift", () => {
    const implement = BINDINGS.filter((b) => b.skill === "issue-implement");
    expect(implement.length).toBeGreaterThan(0);
    for (const b of implement) {
      const deny = b.config.issue_selection.deny_labels.map((l) => l.toLowerCase());
      for (const label of LANE_ENTRY_DENY.implement) expect(deny).toContain(label);
    }
  });
});

describe("laneRefusal — the post script never writes a lane nobody drains", () => {
  const base = { lane: "implement", labels: ["type:bug"], owner: "ren", heldBy: [], boundOwners: ["ren"], issue: 1 };

  it("a clean dispatch passes", () => {
    expect(laneRefusal(base)).toBeNull();
  });

  it("refuses to re-lane an issue a live PR holds", () => {
    expect(laneRefusal({ ...base, heldBy: [752] })).toMatch(/held by open PR #752/);
  });

  it("refuses implement on a label the implement worker denies, and names the way out", () => {
    expect(laneRefusal({ ...base, labels: ["layer:L1"] })).toMatch(/Route it to "design"/);
    expect(laneRefusal({ ...base, lane: "design", owner: "dario", boundOwners: ["dario"], labels: ["layer:L1"] })).toBeNull();
  });

  it("refuses an owner outside the lane worker's bound personas — and skips the check when the roster is unknown", () => {
    expect(laneRefusal({ ...base, owner: "sana" })).toMatch(/bound only to ren/);
    expect(laneRefusal({ ...base, owner: "sana", boundOwners: null })).toBeNull();
    expect(laneRefusal({ ...base, owner: "x", boundOwners: [] })).toMatch(/bound only to nobody/);
  });

  it("the operator lane has no worker, so no owner check", () => {
    expect(laneRefusal({ ...base, lane: "operator", owner: "maya", boundOwners: null })).toBeNull();
  });

  it("clearClaims removes stale claim markers only when asked", () => {
    const labels = ["issue-implement:pr-open", "wf:lane:implement"];
    expect(labelsToRemove(labels, "implement", { owner: "ren" })).toEqual([]);
    expect(labelsToRemove(labels, "implement", { owner: "ren", clearClaims: true })).toEqual(["issue-implement:pr-open"]);
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

describe("settling — duplicates consolidate, done and moot issues close", () => {
  const NOW = Date.parse("2026-09-29T00:00:00Z");
  const daysAgo = (d) => new Date(NOW - d * 86400_000).toISOString();

  it("the verdict vocabulary is closed (C-4)", () => {
    expect(SETTLE_VERDICT_NAMES).toEqual(["duplicate", "completed", "obsolete", "still-valid"]);
    expect(CLOSE_VERDICTS).toEqual(["duplicate", "completed", "obsolete"]);
    expect(() => assertSettleVerdict("wontfix")).toThrow(/unknown verdict/);
    expect(() => closedLabel("still-valid")).toThrow(/not a closing verdict/);
    expect(closedLabel("duplicate")).toBe("wf:closed:duplicate");
    expect(CLOSE_STATE_REASON).toEqual({ duplicate: "not_planned", completed: "completed", obsolete: "not_planned" });
  });

  it("a long-idle laned issue gets a settle review — the operator lane included", () => {
    const opts = { now: NOW, openPrRefs: new Set() };
    expect(needsSettleReview({ labels: ["wf:lane:operator", "wf:human:console"], updatedAt: daysAgo(DEFAULT_REVIEW_DAYS + 1), number: 1 }, opts)).toBe(true);
    expect(needsSettleReview({ labels: ["wf:lane:implement"], updatedAt: daysAgo(DEFAULT_REVIEW_DAYS - 1), number: 1 }, opts)).toBe(false);
  });

  it("never reviews live work, a park, an unlaned issue, or a human reopen", () => {
    const old = daysAgo(90);
    const opts = { now: NOW, openPrRefs: new Set([7]) };
    expect(needsSettleReview({ labels: ["wf:lane:implement"], updatedAt: old, number: 7 }, opts)).toBe(false);
    expect(needsSettleReview({ labels: ["wf:lane:implement", "issue-implement:in-progress"], updatedAt: old, number: 1 }, opts)).toBe(false);
    expect(needsSettleReview({ labels: ["wf:lane:design", "wf:handback"], updatedAt: old, number: 1 }, opts)).toBe(false);
    expect(needsSettleReview({ labels: ["type:chore"], updatedAt: old, number: 1 }, opts)).toBe(false);
    expect(needsSettleReview({ labels: ["wf:lane:design", "wf:closed:obsolete"], updatedAt: old, number: 1 }, opts)).toBe(false);
  });

  it("a duplicate folds into another OPEN issue — never itself, a PR, or a closed one", () => {
    const base = { verdict: "duplicate", issue: 12, labels: ["wf:lane:implement"] };
    expect(settleRefusal({ ...base, of: 10, canonical: { state: "open" } })).toBeNull();
    expect(settleRefusal({ ...base, of: null })).toMatch(/--of/);
    expect(settleRefusal({ ...base, of: 12, canonical: { state: "open" } })).toMatch(/itself/);
    expect(settleRefusal({ ...base, of: 10, canonical: { state: "open", pull_request: {} } })).toMatch(/completed/);
    expect(settleRefusal({ ...base, of: 10, canonical: { state: "closed" } })).toMatch(/completed.*obsolete/);
  });

  it("completed needs a MERGED PR; obsolete needs what superseded it", () => {
    expect(settleRefusal({ verdict: "completed", issue: 1, mergedPr: { number: 5, merged_at: "2026-09-01T00:00:00Z" } })).toBeNull();
    expect(settleRefusal({ verdict: "completed", issue: 1 })).toMatch(/merged PR/);
    expect(settleRefusal({ verdict: "completed", issue: 1, mergedPr: { number: 5, merged_at: null } })).toMatch(/not merged/);
    expect(settleRefusal({ verdict: "obsolete", issue: 1, supersededBy: "adr-0038" })).toBeNull();
    expect(settleRefusal({ verdict: "obsolete", issue: 1, supersededBy: "  " })).toMatch(/superseded-by/);
  });

  it("never closes under a live branch, over a human reopen, or an L0/L1/tracker issue", () => {
    const ok = { verdict: "obsolete", issue: 3, supersededBy: "#9" };
    expect(settleRefusal({ ...ok, heldBy: [44] })).toMatch(/held by open PR #44/);
    expect(settleRefusal({ ...ok, labels: ["wf:closed:obsolete"] })).toMatch(/reopened by a human/);
    expect(wasReopened(["wf:closed:duplicate"])).toBe(true);
    for (const l of ["layer:L0", "layer:L1", "type:tracker"]) {
      expect(settleRefusal({ ...ok, labels: [l] })).toMatch(/design decision/);
    }
    // still-valid only records a review, so nothing blocks it
    expect(settleRefusal({ verdict: "still-valid", issue: 3, heldBy: [44], labels: ["layer:L1"] })).toBeNull();
  });

  it("the settle comment carries GitHub's duplicate marker and a greppable verdict marker", () => {
    const dup = settleComment("Same deliverable as #10.", { verdict: "duplicate", of: 10 });
    expect(dup).toContain("Duplicate of #10");
    expect(dup).toContain("<!-- wf:settled:duplicate -->");
    expect(dup).toMatch(/reopen it/);
    expect(settleComment("x", { verdict: "completed", pr: 726 })).toContain("Completed by #726.");
    expect(settleComment("x", { verdict: "obsolete", supersededBy: "adr-0038" })).toContain("Superseded by adr-0038.");
    const keep = settleComment("Still wanted.", { verdict: "still-valid" });
    expect(keep).toContain("<!-- wf:settled:still-valid -->");
    expect(keep).not.toMatch(/reopen/);
  });
});
