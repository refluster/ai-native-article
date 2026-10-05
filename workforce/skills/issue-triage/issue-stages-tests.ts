// @ts-nocheck — the modules under test are dependency-free ESM scripts, not TS.
// Discovered by workforce/lambdas/vitest.config.mjs (`../skills/**/*-tests.ts`).
//
// Locks the lifecycle's rules (adr-0046 §1):
//   1. every open issue is in EXACTLY ONE stage, and no stage label is Proposed;
//   2. `owner:*` exists iff the stage is Assigned, and there is exactly one;
//   3. an owner must be served — bound to issue-execute on this project, or the
//      operator — so an issue can never be assigned to nobody (#760);
//   4. a claim is an open PR, nothing else; a held issue is not re-staged;
//   5. routing terminates — the fourth assignment is the operator;
//   6. a close needs evidence, a reopen overrules the reconcile, and closes are
//      budgeted per run.
import { describe, it, expect } from "vitest";
import {
  ASSIGN_CAP,
  ASSIGN_MARKER,
  CLOSE_MARKER,
  EXECUTOR_SKILL,
  OPERATOR,
  STAGES,
  applyAssignCap,
  closeRefusal,
  countMarker,
  issueRefsOfPr,
  labelPlan,
  ownerIsServed,
  ownerLabel,
  ownerOf,
  ownersOf,
  reconcileAction,
  retiredLabelsIn,
  rosterFromAgents,
  routeAction,
  stageLabel,
  stageOf,
  transitionRefusal,
} from "./issue-stages.mjs";
import { decide, selectCandidates } from "./issue-stage-scan.mjs";
import { QUEUES } from "../../scripts/lib/bindings-manifest.mjs";

const DAY = 86400_000;
const NOW = Date.parse("2026-10-05T12:00:00Z");
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();

describe("vocabulary", () => {
  it("has exactly the three stage labels, and no stage label reads as proposed", () => {
    expect(STAGES).toEqual(["proposed", "verified", "assigned"]);
    expect(stageOf([])).toBe("proposed");
    expect(stageOf(["type:bug"])).toBe("proposed");
    expect(stageOf(["stage:verified"])).toBe("verified");
    expect(stageOf([{ name: "stage:assigned" }])).toBe("assigned");
    expect(() => stageOf(["stage:closed"])).toThrow(/unknown stage/);
    expect(() => stageLabel("done")).toThrow(/unknown stage/);
  });

  it("owner labels are slugs, never @-mentions; the operator is a valid owner everywhere", () => {
    expect(ownerLabel("ren")).toBe("owner:ren");
    expect(ownerLabel("Operator")).toBe("owner:operator");
    expect(() => ownerLabel("@ren")).toThrow();
    expect(() => ownerLabel("wf:ren")).toThrow();
    expect(ownerOf(["stage:assigned", "owner:dario"])).toBe("dario");
    expect(ownersOf(["owner:a", "owner:b"])).toEqual(["a", "b"]);
    expect(ownerIsServed(OPERATOR, [])).toBe(true);
    expect(ownerIsServed(OPERATOR, null)).toBe(true);
  });

  it("an unknown roster is NOT a pass for a member", () => {
    expect(ownerIsServed("ren", null)).toBe(false);
    expect(ownerIsServed("ren", ["ren"])).toBe(true);
    expect(ownerIsServed("sana", ["ren", "dario"])).toBe(false);
  });

  it("reads the roster from a GET /agents payload, by executor binding on the project", () => {
    const agents = {
      items: [
        { slug: "ren", bindings: [{ skill: EXECUTOR_SKILL, project_id: "asp-cloud" }, { skill: "pr-remediate", project_id: "asp-cloud" }] },
        { slug: "dario", bindings: [{ skill: EXECUTOR_SKILL, project_id: "agent-workforce" }] },
        { slug: "sana", bindings: [{ skill: "skill-maturity-report", project_id: "agent-workforce" }] },
        { slug: "old", archived: true, bindings: [{ skill: EXECUTOR_SKILL, project_id: "asp-cloud" }] },
      ],
    };
    expect(rosterFromAgents(agents, "asp-cloud")).toEqual(["ren"]);
    expect(rosterFromAgents(agents, "agent-workforce")).toEqual(["dario"]);
    expect(rosterFromAgents(agents.items, "nowhere")).toEqual([]);
  });

  it("knows every retired label family (read to be removed, never written)", () => {
    const old = ["wf:lane:design", "wf:owner:sana", "wf:human:product", "wf:handback", "issue-implement:pr-open", "issue-design:in-progress", "wf:closed:duplicate", "type:bug", "stage:verified"];
    expect(retiredLabelsIn(old)).toEqual(old.slice(0, 7));
  });
});

describe("the label plan (rules 1 and 2)", () => {
  it("one stage, one owner, every retired label gone", () => {
    const plan = labelPlan(["stage:proposed", "wf:lane:design", "wf:owner:sana", "owner:maya", "type:bug"], { stage: "assigned", owner: "dario" });
    expect(plan.add).toEqual(["stage:assigned", "owner:dario"]);
    expect(plan.remove.sort()).toEqual(["owner:maya", "stage:proposed", "wf:lane:design", "wf:owner:sana"].sort());
  });

  it("a hand-back strips the owner", () => {
    const plan = labelPlan(["stage:assigned", "owner:ren"], { stage: "verified" });
    expect(plan.add).toEqual(["stage:verified"]);
    expect(plan.remove).toEqual(["stage:assigned", "owner:ren"]);
  });

  it("is idempotent", () => {
    expect(labelPlan(["stage:assigned", "owner:ren"], { stage: "assigned", owner: "ren" })).toEqual({ add: [], remove: [] });
  });

  it("refuses an owner outside assigned and an assigned without owner", () => {
    expect(() => labelPlan([], { stage: "verified", owner: "ren" })).toThrow(/rule 2/);
    expect(() => labelPlan([], { stage: "assigned" })).toThrow(/rule 2/);
  });
});

describe("reconcile decisions", () => {
  it("every Proposed issue is checked; incidents never", () => {
    expect(reconcileAction({ labels: [], updatedAt: iso(1) }, { now: NOW }).action).toBe("check");
    expect(reconcileAction({ labels: ["stage:proposed"], updatedAt: iso(1) }, { now: NOW }).action).toBe("check");
    expect(reconcileAction({ labels: ["incident"], updatedAt: iso(100) }, { now: NOW }).action).toBe("skip");
  });

  it("re-checks Verified/Assigned issues only after the stale window, and never under an open PR", () => {
    expect(reconcileAction({ labels: ["stage:verified"], updatedAt: iso(5) }, { now: NOW }).action).toBe("skip");
    expect(reconcileAction({ labels: ["stage:verified"], updatedAt: iso(31) }, { now: NOW }).action).toBe("stale-check");
    expect(reconcileAction({ labels: ["stage:assigned", "owner:ren"], updatedAt: iso(45), number: 7 }, { now: NOW, openPrRefs: new Set([7]) }).action).toBe("skip");
    expect(reconcileAction({ labels: ["stage:assigned", "owner:ren"], updatedAt: iso(45), number: 7 }, { now: NOW, openPrRefs: new Set([8]) }).action).toBe("stale-check");
  });
});

describe("route decisions (rule 3 — the #760 shape)", () => {
  const roster = ["ren", "dario"];
  it("routes Verified, leaves Proposed to the reconcile, skips incidents", () => {
    expect(routeAction({ labels: ["stage:verified"] }, { roster }).action).toBe("route");
    expect(routeAction({ labels: [] }, { roster }).action).toBe("skip");
    expect(routeAction({ labels: ["incident"] }, { roster }).action).toBe("skip");
  });

  it("re-assigns an Assigned issue whose owner no executor serves here", () => {
    const r = routeAction({ labels: ["stage:assigned", "owner:sana"], number: 760 }, { roster });
    expect(r.action).toBe("reassign");
    expect(r.why).toMatch(/owner:sana/);
    expect(routeAction({ labels: ["stage:assigned", "owner:dario"] }, { roster }).action).toBe("skip");
    expect(routeAction({ labels: ["stage:assigned", "owner:operator"] }, { roster }).action).toBe("skip");
  });

  it("re-assigns a broken rule 2 (no owner, or two)", () => {
    expect(routeAction({ labels: ["stage:assigned"] }, { roster }).action).toBe("reassign");
    expect(routeAction({ labels: ["stage:assigned", "owner:ren", "owner:dario"] }, { roster }).action).toBe("reassign");
  });

  it("never re-assigns under an open PR, and skips the served check when the roster is unknown", () => {
    expect(routeAction({ labels: ["stage:assigned", "owner:sana"], number: 1 }, { roster, openPrRefs: new Set([1]) }).action).toBe("skip");
    expect(routeAction({ labels: ["stage:assigned", "owner:sana"] }, { roster: null }).action).toBe("skip");
  });
});

describe("a claim is an open PR (rule 4)", () => {
  it("reads closing keywords, Refs, and issue-<N> branches", () => {
    expect([...issueRefsOfPr({ body: "Closes #12\nRefs #13", headRef: "ren/issue-14-x" })].sort()).toEqual([12, 13, 14]);
    expect([...issueRefsOfPr({ body: "see other/repo#9" })]).toEqual([]);
  });

  it("transitions refuse a held issue", () => {
    expect(transitionRefusal({ to: "assigned", labels: ["stage:verified"], owner: "ren", heldBy: [99], roster: ["ren"], issue: 5 })).toMatch(/held by open PR #99/);
    expect(transitionRefusal({ to: "verified", labels: ["stage:assigned", "owner:ren"], heldBy: [99], issue: 5 })).toMatch(/held/);
    expect(transitionRefusal({ to: "verified", labels: ["stage:assigned", "owner:ren"], heldBy: [], issue: 5 })).toBeNull();
  });

  it("transitions refuse an unserved owner, an incident, and 'proposed' as a target", () => {
    expect(transitionRefusal({ to: "assigned", labels: [], owner: "sana", roster: ["ren"], issue: 5 })).toMatch(/owner "sana" refused/);
    expect(transitionRefusal({ to: "assigned", labels: [], owner: "ren", roster: null, issue: 5 })).toMatch(/roster unreadable/);
    expect(transitionRefusal({ to: "assigned", labels: [], owner: "operator", roster: null, issue: 5 })).toBeNull();
    expect(transitionRefusal({ to: "assigned", labels: [], owner: "ren", roster: ["ren"], issue: 5 })).toBeNull();
    expect(transitionRefusal({ to: "verified", labels: ["incident"], issue: 5 })).toMatch(/incident/);
    expect(transitionRefusal({ to: "proposed", labels: [], issue: 5 })).toMatch(/filing state/);
  });
});

describe("routing terminates (rule 5)", () => {
  it("counts the router's own assignment comments", () => {
    expect(countMarker(["hello", `x\n${ASSIGN_MARKER}`, ASSIGN_MARKER, null], ASSIGN_MARKER)).toBe(2);
  });

  it("the fourth assignment is the operator, whatever was asked", () => {
    expect(applyAssignCap("ren", 0)).toMatchObject({ owner: "ren", capped: false, assignments: 1 });
    expect(applyAssignCap("ren", ASSIGN_CAP - 1)).toMatchObject({ owner: "ren", capped: false });
    expect(applyAssignCap("ren", ASSIGN_CAP)).toMatchObject({ owner: OPERATOR, capped: true });
    expect(applyAssignCap(OPERATOR, ASSIGN_CAP + 5)).toMatchObject({ owner: OPERATOR, capped: false });
  });
});

describe("closing (rule 6)", () => {
  const base = { issue: 10, labels: ["stage:proposed"], heldBy: [] };
  it("needs evidence per reason", () => {
    expect(closeRefusal({ ...base, reason: "completed" })).toMatch(/--pr/);
    expect(closeRefusal({ ...base, reason: "completed", mergedPr: { number: 3, merged_at: null } })).toMatch(/not merged/);
    expect(closeRefusal({ ...base, reason: "completed", mergedPr: { number: 3, merged_at: "2026-10-01T00:00:00Z" } })).toBeNull();
    expect(closeRefusal({ ...base, reason: "completed", commit: "abc123" })).toBeNull();
    expect(closeRefusal({ ...base, reason: "duplicate" })).toMatch(/--of/);
    expect(closeRefusal({ ...base, reason: "duplicate", of: 10 })).toMatch(/itself/);
    expect(closeRefusal({ ...base, reason: "duplicate", of: 11, canonical: { state: "closed" } })).toMatch(/is closed/);
    expect(closeRefusal({ ...base, reason: "duplicate", of: 11, canonical: { state: "open", pull_request: {} } })).toMatch(/pull request/);
    expect(closeRefusal({ ...base, reason: "duplicate", of: 11, canonical: { state: "open" } })).toBeNull();
    expect(closeRefusal({ ...base, reason: "not_planned" })).toBeNull();
    expect(() => closeRefusal({ ...base, reason: "wontfix" })).toThrow(/unknown close reason/);
  });

  it("never closes a held issue, an incident, or a reopened one; respects the per-run budget", () => {
    expect(closeRefusal({ ...base, reason: "not_planned", heldBy: [4] })).toMatch(/held/);
    expect(closeRefusal({ ...base, reason: "not_planned", labels: ["incident"] })).toMatch(/incident/);
    expect(closeRefusal({ ...base, reason: "not_planned", reopened: true })).toMatch(/reopened/);
    expect(closeRefusal({ ...base, reason: "not_planned", closesSoFar: 10, maxCloses: 10 })).toMatch(/budget spent/);
    expect(countMarker([`bye ${CLOSE_MARKER}`], CLOSE_MARKER)).toBe(1);
  });
});

describe("the scan's selection", () => {
  it("decides per queue and picks oldest-activity first under the cap", () => {
    const issues = [
      { number: 1, labels: [{ name: "stage:verified" }], updated_at: iso(3) },
      { number: 2, labels: [], updated_at: iso(9) },
      { number: 3, labels: [{ name: "stage:assigned" }, { name: "owner:sana" }], updated_at: iso(1) },
      { number: 4, labels: [{ name: "incident" }], updated_at: iso(50) },
    ];
    const opts = { now: NOW, staleDays: 30, openPrRefs: new Set(), roster: ["ren"] };
    const rec = issues.map((i) => ({ ...i, decision: decide("reconcile", i, opts) }));
    expect(selectCandidates(rec).map((c) => c.number)).toEqual([2]);
    const route = issues.map((i) => ({ ...i, decision: decide("route", i, opts) }));
    expect(selectCandidates(route).map((c) => c.number)).toEqual([1, 3]);
    expect(selectCandidates(route, { max: 1 }).map((c) => c.number)).toEqual([1]);
  });
});

describe("the manifest agrees with this module", () => {
  it("every intake queue names a stage this module knows, and the executor skill matches", () => {
    const intake = QUEUES.filter((q) => q.consumer === EXECUTOR_SKILL || q.producer === EXECUTOR_SKILL);
    expect(intake.length).toBeGreaterThanOrEqual(2);
    for (const q of QUEUES) {
      if (q.queue.startsWith("stage:")) expect(STAGES.map(stageLabel)).toContain(q.queue.split(" ")[0]);
    }
  });
});
