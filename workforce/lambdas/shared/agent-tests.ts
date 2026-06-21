// Tests for agent.ts — the effectiveSchedule / bindingCronIsLoadBearing
// predicate that single-sources "will this binding fire, and when?".
//
// Filename uses the `-tests.ts` suffix (not vitest's default `.test.ts`)
// to satisfy the R-N7 naming linter — see vitest.config.mjs.
//
// SCHEDULE_CASES is the canonical parity fixture: the same cases are
// re-asserted by the app-side mirror (workforce/app/src/lib/
// effectiveSchedule.test.ts) so the console display can never re-diverge
// from this engine-side truth. Edit cases here and there together.

import { describe, expect, it } from "vitest";
import {
  bindingCronIsLoadBearing,
  effectiveSchedule,
  isOrchestratorOwnedCcr,
  type AgentBinding,
  type EffectiveSchedule,
} from "./agent.js";

type Case = { name: string; binding: AgentBinding; expect: EffectiveSchedule };

// Exported so the parity fixture is one definition; the app mirror test
// imports the same expectations (see that file's header).
export const SCHEDULE_CASES: Case[] = [
  {
    name: "orchestrator-fired CCR cron (feed-post live shape)",
    binding: {
      skill: "feed-post",
      executor: "claude-code-routine",
      trigger: { scheduler: "external", invoked_by: "api", cron: "cron(57 3 ? * * *)" },
      routine_spec: "workforce/docs/routines/agent-runner.md",
      project_id: "agent-workforce",
    },
    expect: { kind: "cron", cron: "cron(57 3 ? * * *)", scheduler: "external" },
  },
  {
    name: "eventbridge Lambda cron",
    binding: {
      skill: "discord-heartbeat",
      executor: "lambda",
      trigger: { scheduler: "eventbridge", cron: "cron(20 0/2 * * ? *)" },
    },
    expect: { kind: "cron", cron: "cron(20 0/2 * * ? *)", scheduler: "eventbridge" },
  },
  {
    name: "GHA cron",
    binding: {
      skill: "deploy-workforce-data-plane",
      executor: "gha",
      trigger: { scheduler: "gha", cron: "cron(0 7 * * ? *)" },
      workflow: ".github/workflows/deploy-workforce-data-plane.yml",
    },
    expect: { kind: "cron", cron: "cron(0 7 * * ? *)", scheduler: "gha" },
  },
  {
    name: "CCR self-schedule cron",
    binding: {
      skill: "pr-review",
      executor: "claude-code-routine",
      trigger: { scheduler: "claude-code-routine", cron: "cron(0 1 ? * * *)" },
      routine_spec: "workforce/docs/routines/dario-review.md",
    },
    expect: { kind: "cron", cron: "cron(0 1 ? * * *)", scheduler: "claude-code-routine" },
  },
  {
    name: "DEAD cron — manual scheduler with a hand-added cron (daily-research drift)",
    binding: {
      skill: "daily-research",
      executor: "claude-code-routine",
      trigger: { scheduler: "manual", cron: "cron(37 8 ? * * *)" },
      routine_spec: "workforce/docs/routines/agent-runner.md",
      project_id: "agent-workforce",
    },
    expect: { kind: "dead-cron", cron: "cron(37 8 ? * * *)", scheduler: "manual" },
  },
  {
    name: "DEAD cron — external but not invoked_by=api",
    binding: {
      skill: "daily-research",
      executor: "claude-code-routine",
      trigger: { scheduler: "external", invoked_by: "repository_dispatch", cron: "cron(0 9 ? * * *)" },
      routine_spec: "workforce/docs/routines/agent-runner.md",
    },
    expect: { kind: "dead-cron", cron: "cron(0 9 ? * * *)", scheduler: "external" },
  },
  {
    name: "clean paused — manual scheduler, no cron (seed shape)",
    binding: {
      skill: "daily-research",
      executor: "claude-code-routine",
      trigger: { scheduler: "manual" },
      routine_spec: "workforce/docs/routines/agent-runner.md",
      project_id: "agent-workforce",
    },
    expect: { kind: "manual", scheduler: "manual" },
  },
  {
    name: "declarative — cli/manual is reported manual (no cron)",
    binding: {
      skill: "pdm-charter",
      executor: "cli",
      trigger: { scheduler: "manual" },
    },
    expect: { kind: "manual", scheduler: "manual" },
  },
  {
    name: "declarative — github-event CCR (no cron)",
    binding: {
      skill: "pr-review",
      executor: "claude-code-routine",
      trigger: { scheduler: "claude-code-routine", github_event: "pull_request.labeled" },
      routine_spec: "workforce/docs/routines/dario-review.md",
    },
    expect: { kind: "declarative", scheduler: "claude-code-routine", executor: "claude-code-routine" },
  },
];

describe("effectiveSchedule", () => {
  for (const c of SCHEDULE_CASES) {
    it(c.name, () => {
      expect(effectiveSchedule(c.binding)).toEqual(c.expect);
    });
  }

  it("a dead cron is never reported as load-bearing", () => {
    for (const c of SCHEDULE_CASES) {
      if (c.expect.kind === "dead-cron") {
        expect(bindingCronIsLoadBearing(c.binding)).toBe(false);
      }
      if (c.expect.kind === "cron") {
        expect(bindingCronIsLoadBearing(c.binding)).toBe(true);
      }
    }
  });
});

describe("isOrchestratorOwnedCcr (regression guard for the predicate the UI now shares)", () => {
  it("only external + invoked_by=api + claude-code-routine is orchestrator-owned", () => {
    expect(
      isOrchestratorOwnedCcr({
        skill: "x",
        executor: "claude-code-routine",
        trigger: { scheduler: "external", invoked_by: "api", cron: "cron(0 1 ? * * *)" },
      }),
    ).toBe(true);
    expect(
      isOrchestratorOwnedCcr({
        skill: "x",
        executor: "claude-code-routine",
        trigger: { scheduler: "manual", cron: "cron(0 1 ? * * *)" },
      }),
    ).toBe(false);
  });
});
