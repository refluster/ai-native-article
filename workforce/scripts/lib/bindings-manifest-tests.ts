// @ts-nocheck — the module under test is a dependency-free ESM manifest, not TS.
// Discovered by workforce/lambdas/vitest.config.mjs (`../scripts/**/*-tests.ts`).
//
// R-N11 (adr-0038): a cadence that FILLS a queue may not be bound for a project
// unless the cadence that DRAINS it is bound for the same project.
//
// The regression these tests exist for is not hypothetical — it shipped three
// times (see the manifest header). Each of the three is replayed below as a
// case, so a future edit that re-creates any of them turns CI red instead of
// turning a queue silent.
import { describe, it, expect } from "vitest";
import {
  BINDINGS,
  QUEUES,
  bindingMatcher,
  isBound,
  laneKeyOf,
  managedBindings,
  queueViolations,
  toBindingLiteral,
  ROUTINE_SPEC,
} from "./bindings-manifest.mjs";
import { reconcileBinding } from "../../../scripts/lib/binding-reconcile.mjs";

describe("the manifest as declared is compliant", () => {
  it("every queue with a bound producer has a bound consumer", () => {
    expect(queueViolations()).toEqual([]);
  });

  it("both projects run the full intake loop", () => {
    for (const project of ["agent-workforce", "asp-cloud"]) {
      for (const skill of ["issue-triage", "issue-design", "issue-implement", "pr-remediate"]) {
        expect(isBound(BINDINGS, skill, project), `${skill}@${project}`).toBe(true);
      }
    }
  });

  it("declares no duplicate (agent, skill, project) triples", () => {
    const keys = BINDINGS.map((b) => `${b.agent}/${b.skill}/${b.project_id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every managed binding carries a single-literal cron and the api trigger shape", () => {
    for (const b of managedBindings()) {
      expect(b.trigger.scheduler, b.skill).toBe("external");
      expect(b.trigger.invoked_by, b.skill).toBe("api");
      // G1-cadence-floor: a single literal minute, so the agents-api's hourly
      // cadence floor can be evaluated and every cron parser agrees.
      expect(b.trigger.cron, b.skill).toMatch(/^cron\(\d+ [\d,/]+ \? \* \* \*\)$/);
    }
  });

  it("the stored literal drops the manifest's own bookkeeping fields", () => {
    const literal = toBindingLiteral(managedBindings()[0]);
    expect(literal).not.toHaveProperty("agent");
    expect(literal).not.toHaveProperty("managed");
    expect(literal.routine_spec).toBe(ROUTINE_SPEC);
  });
});

describe("the three incidents this rule exists for", () => {
  const without = (skill, project) => BINDINGS.filter((b) => !(b.skill === skill && b.project_id === project));

  it("#692/#693 — pr-autopilot bound for a project with no pr-remediate", () => {
    const v = queueViolations(without("pr-remediate", "asp-cloud"));
    expect(v).toContainEqual(
      expect.objectContaining({ project_id: "asp-cloud", producer: "pr-autopilot", consumer: "pr-remediate" }),
    );
  });

  it("the asp-cloud backlog — issue-implement bound with no router to hand back to", () => {
    const v = queueViolations(without("issue-triage", "asp-cloud"));
    expect(v).toContainEqual(
      expect.objectContaining({ project_id: "asp-cloud", producer: "issue-implement", consumer: "issue-triage" }),
    );
  });

  it("a router that lanes design work into a project with no design worker", () => {
    const v = queueViolations(without("issue-design", "asp-cloud"));
    expect(v).toContainEqual(
      expect.objectContaining({ project_id: "asp-cloud", producer: "issue-triage", consumer: "issue-design" }),
    );
  });

  it("removing the PRODUCER instead is also compliant — the rule constrains pairs, not cadences", () => {
    // Un-wiring the producer is a legitimate fix, and one the checker must not
    // argue with: the invariant is "no orphaned queue", not "bind everything".
    const pruned = BINDINGS.filter(
      (b) => !(b.project_id === "asp-cloud" && ["issue-triage", "issue-design", "issue-implement"].includes(b.skill)),
    );
    expect(queueViolations(pruned).filter((v) => v.consumer === "issue-design")).toEqual([]);
  });
});

describe("the queue relation itself", () => {
  it("names a real producer and consumer for every queue", () => {
    const skills = new Set(BINDINGS.map((b) => b.skill));
    for (const q of QUEUES) {
      expect(skills, `producer ${q.producer}`).toContain(q.producer);
      expect(skills, `consumer ${q.consumer}`).toContain(q.consumer);
      expect(q.why.length, q.queue).toBeGreaterThan(20);
    }
  });

  it("covers both hand-back producers — a lane worker of either kind can decline", () => {
    const handback = QUEUES.filter((q) => q.queue === "wf:handback").map((q) => q.producer).sort();
    expect(handback).toEqual(["issue-design", "issue-implement"]);
  });
});

describe("binding identity is (skill, project_id, lane) — adr-0030's sharp edge", () => {
  const groom = {
    skill: "pr-remediate",
    project_id: "agent-workforce",
    executor: "claude-code-routine",
    trigger: { scheduler: "external", invoked_by: "api", fired_from: "wf-orchestrator-tick", cron: "cron(41 2 ? * * *)" },
    config: { lane: "groom", sign_off_persona: "ren", max_prs_per_run: 5 },
  };

  it("an absent config.lane means the author lane", () => {
    expect(laneKeyOf({ config: { sign_off_persona: "ren" } })).toBe("author");
    expect(laneKeyOf(groom)).toBe("groom");
    expect(laneKeyOf(undefined)).toBe("author");
  });

  it("the author-lane manifest entry does NOT match the groom binding", () => {
    // The regression this guards: Ren carries two pr-remediate bindings on the
    // same project (adr-0030). A (skill, project_id) key would match the groom
    // slot and overwrite it with the author lane's config — destroying a
    // binding the manifest does not own and never mentions.
    const author = managedBindings().find((b) => b.skill === "pr-remediate" && b.project_id === "agent-workforce");
    expect(author).toBeDefined();
    expect(bindingMatcher(author)(groom)).toBe(false);
    expect(bindingMatcher(author)({ ...author, config: { ...author.config } })).toBe(true);
  });

  it("reconciling the author lane leaves a live groom binding untouched", () => {
    const author = managedBindings().find((b) => b.skill === "pr-remediate" && b.project_id === "agent-workforce");
    const live = [groom];
    const { bindings, verb } = reconcileBinding(live, toBindingLiteral(author), bindingMatcher(author));
    expect(verb).toBe("bound");
    expect(bindings).toHaveLength(2);
    expect(bindings.find((b) => b.config?.lane === "groom")).toEqual(groom);
  });
});
