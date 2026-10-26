// @ts-nocheck — the module under test is a dependency-free ESM manifest, not TS.
// Discovered by workforce/lambdas/vitest.config.mjs (`../scripts/**/*-tests.ts`).
//
// R-N11 (adr-0038): a cadence that FILLS a queue may not be bound for a project
// unless the cadence that DRAINS it is bound for the same project. The
// regression these tests exist for shipped three times (see the manifest
// header); each is replayed below in the adr-0046 vocabulary, so a future edit
// that re-creates any of them turns CI red instead of turning a queue silent.
import { describe, it, expect } from "vitest";
import {
  BINDINGS,
  QUEUES,
  RETIRED_BINDINGS,
  bindingMatcher,
  boundAgents,
  isBound,
  isRetired,
  laneKeyOf,
  managedBindings,
  queueViolations,
  toBindingLiteral,
  ROUTINE_SPEC,
} from "./bindings-manifest.mjs";
import { reconcileBinding } from "../../../scripts/lib/binding-reconcile.mjs";

const PROJECTS = ["agent-workforce", "asp-cloud"];
const LOOP = ["backlog-reconcile", "issue-triage", "issue-execute", "pr-remediate", "pr-autopilot"];

describe("the manifest as declared is compliant", () => {
  it("every queue with a bound producer has a bound consumer", () => {
    expect(queueViolations()).toEqual([]);
  });

  it("both projects run the full loop", () => {
    for (const project of PROJECTS) for (const skill of LOOP) expect(isBound(BINDINGS, skill, project), `${skill}@${project}`).toBe(true);
  });

  it("every project has at least one executor, and the same roster shape on both", () => {
    for (const project of PROJECTS) expect(boundAgents(BINDINGS, "issue-execute", project)).toEqual(["dario", "ren"]);
  });

  it("declares no duplicate (agent, skill, project) triples", () => {
    const keys = BINDINGS.map((b) => `${b.agent}/${b.skill}/${b.project_id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never declares a binding it also retires", () => {
    for (const b of BINDINGS) expect(isRetired(b), `${b.skill}@${b.project_id}`).toBe(false);
    for (const r of RETIRED_BINDINGS) expect(["issue-implement", "issue-design"]).toContain(r.skill);
  });

  it("managed bindings are enabled in one write (external + api + cron) and carry the generic routine", () => {
    for (const b of managedBindings()) {
      const lit = toBindingLiteral(b);
      expect(lit.executor).toBe("claude-code-routine");
      expect(lit.trigger).toMatchObject({ scheduler: "external", invoked_by: "api" });
      expect(lit.trigger.cron).toMatch(/^cron\(/);
      expect(lit.routine_spec).toBe(ROUTINE_SPEC);
      expect(lit).not.toHaveProperty("agent");
      expect(lit).not.toHaveProperty("managed");
      expect(lit).not.toHaveProperty("bound_at");
    }
  });

  it("the four queues name the three intake stages and the PR author lane", () => {
    expect(QUEUES.map((q) => q.queue)).toEqual(["stage:verified", "stage:assigned + owner:<slug>", "stage:verified (hand-back)", "autopilot:needs-author"]);
  });
});

describe("R-N11 replays the three incidents", () => {
  const drop = (skill, project) => BINDINGS.filter((b) => !(b.skill === skill && b.project_id === project));

  it("pr-remediate missing on one project (#692/#693, OP-016)", () => {
    const v = queueViolations(drop("pr-remediate", "asp-cloud"));
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ producer: "pr-autopilot", consumer: "pr-remediate", project_id: "asp-cloud" });
  });

  it("the router missing on a project that has executors (the asp-cloud absorbing state)", () => {
    const v = queueViolations(drop("issue-triage", "asp-cloud"));
    expect(v.map((x) => x.producer).sort()).toEqual(["backlog-reconcile", "issue-execute", "issue-execute"]);
    for (const x of v) expect(x).toMatchObject({ consumer: "issue-triage", project_id: "asp-cloud" });
  });

  it("a router with nobody to assign to (no executor bound)", () => {
    const list = drop("issue-execute", "agent-workforce");
    const v = queueViolations(list);
    expect(v).toEqual([expect.objectContaining({ producer: "issue-triage", consumer: "issue-execute", project_id: "agent-workforce" })]);
  });

  it("unbinding the producer is an equally valid fix", () => {
    const list = drop("pr-remediate", "asp-cloud").filter((b) => !(b.skill === "pr-autopilot" && b.project_id === "asp-cloud"));
    expect(queueViolations(list)).toEqual([]);
  });
});

describe("the reconciliation key is (skill, project_id, lane), inside one agent", () => {
  const author = { skill: "pr-remediate", project_id: "agent-workforce", config: { sign_off_persona: "ren" } };
  const groom = { skill: "pr-remediate", project_id: "agent-workforce", config: { sign_off_persona: "ren", lane: "groom" } };

  it("an absent config.lane is the author lane", () => {
    expect(laneKeyOf(author)).toBe("author");
    expect(laneKeyOf(groom)).toBe("groom");
    expect(laneKeyOf({})).toBe("author");
  });

  it("the author entry never matches the groom slot (adr-0030)", () => {
    const live = [groom];
    expect(live.findIndex(bindingMatcher(author))).toBe(-1);
    const r = reconcileBinding(live, author, bindingMatcher(author), () => "2026-10-05T00:00:00Z");
    expect(r.verb).toBe("bound");
    expect(r.bindings).toHaveLength(2);
    expect(r.bindings[0]).toBe(groom);
  });

  it("the same (skill, project) on two agents is two bindings, not a collision", () => {
    expect(BINDINGS.filter((b) => b.skill === "issue-execute" && b.project_id === "asp-cloud").map((b) => b.agent).sort()).toEqual(["dario", "ren"]);
  });

  it("isRetired keys on (skill, project_id) only", () => {
    expect(isRetired({ skill: "issue-implement", project_id: "asp-cloud", config: { x: 1 } })).toBe(true);
    expect(isRetired({ skill: "issue-execute", project_id: "asp-cloud" })).toBe(false);
  });
});
