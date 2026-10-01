// Tests for budget-runway.ts (ML-038): the modelled monthly burn of an
// agent's bindings, and whether the cap covers it.
//
// The production numbers these reproduce are Nadia's on 2026-09-13: six
// orchestrator-owned bindings modelled at USD 75/month against an USD 8 cap,
// which the gate that went live on 09-09 exhausted on 09-11.

import { describe, expect, it } from "vitest";
import {
  bindingFiresPerMonth,
  budgetRunway,
  modelledMonthlyBurn,
  RUNWAY_WINDOW_DAYS,
} from "./budget-runway.js";
import type { AgentBinding } from "./agent.js";

const owned = (skill: string, cron: string, project_id = "agent-workforce"): AgentBinding =>
  ({
    skill,
    project_id,
    executor: "claude-code-routine",
    routine_spec: "workforce/docs/routines/agent-runner.md",
    trigger: { scheduler: "external", invoked_by: "api", cron, fired_from: "wf-orchestrator-tick" },
  }) as unknown as AgentBinding;

describe("bindingFiresPerMonth", () => {
  it("counts a daily cron as one fire per day of the window", () => {
    expect(bindingFiresPerMonth(owned("feed-post", "cron(30 1 ? * * *)"))).toBe(RUNWAY_WINDOW_DAYS);
  });

  it("counts an hour-list cron per listed hour", () => {
    // Nadia's agent-workforce pr-autopilot leg: 00:23 / 06:23 / 12:23 / 18:23.
    expect(bindingFiresPerMonth(owned("pr-autopilot", "cron(23 0,6,12,18 ? * * *)"))).toBe(4 * RUNWAY_WINDOW_DAYS);
  });

  it("counts a step cron from its base (`1/6` is 01,07,13,19 — four, not one)", () => {
    expect(bindingFiresPerMonth(owned("pr-autopilot", "cron(45 1/6 ? * * *)", "asp-cloud"))).toBe(4 * RUNWAY_WINDOW_DAYS);
  });

  it("counts a fixed day-of-month cron once, whatever day it is computed on", () => {
    expect(bindingFiresPerMonth(owned("vp-monthly-report", "cron(9 1 3 * ? *)"))).toBe(1);
  });

  it("counts a weekday-name cron on those days only", () => {
    // The window starts on a Monday and spans 30 days: five Tuesdays fall
    // inside it (days 2, 9, 16, 23, 30 of the window; the 30th day is a Tuesday).
    expect(bindingFiresPerMonth(owned("editorial-desk", "cron(17 1 ? * TUE *)"))).toBe(5);
  });

  it("charges nothing for a binding the orchestrator does not own", () => {
    const gha = { ...owned("feed-post", "cron(30 1 ? * * *)"), trigger: { scheduler: "gha", cron: "cron(30 1 ? * * *)" } } as unknown as AgentBinding;
    expect(bindingFiresPerMonth(gha)).toBe(0);
    const manual = { ...owned("feed-post", "cron(30 1 ? * * *)"), trigger: { scheduler: "manual" } } as unknown as AgentBinding;
    expect(bindingFiresPerMonth(manual)).toBe(0);
  });

  it("charges nothing for a cron the tick could never evaluate", () => {
    // matchesNow throws on this and the tick skips the binding — it fires 0 times.
    expect(bindingFiresPerMonth(owned("feed-post", "cron(30 1 * *)"))).toBe(0);
  });
});

describe("modelledMonthlyBurn / budgetRunway — the Nadia reproduction", () => {
  const nadia: AgentBinding[] = [
    owned("pr-autopilot", "cron(45 1/6 ? * * *)", "asp-cloud"),
    owned("feed-post", "cron(30 1 ? * * *)"),
    owned("pr-autopilot", "cron(23 0,6,12,18 ? * * *)"),
    owned("backlog-reconcile", "cron(41 2 ? * * *)"),
    owned("daily-research", "cron(18 16 ? * * *)"),
    owned("issue-triage", "cron(23 2 ? * * *)"),
  ];

  it("models Nadia's six bindings at USD 75/month", () => {
    const burn = modelledMonthlyBurn(nadia);
    // 2 × (120 fires × 0.20) + 30 × 0.05 + 30 × 0.60 + 30 × 0.05 + 30 × 0.20
    expect(burn.total_usd).toBe(75);
    expect(burn.per_binding.find((b) => b.skill === "backlog-reconcile")?.usd_per_month).toBe(18);
  });

  it("says an USD 8 cap runs out on day 4", () => {
    const r = budgetRunway(nadia, 8);
    expect(r.fits).toBe(false);
    expect(r.ratio).toBeCloseTo(9.375, 3);
    expect(r.cap_reached_on_day).toBe(4);
  });

  it("says an USD 90 cap fits, with no cap day", () => {
    const r = budgetRunway(nadia, 90);
    expect(r.fits).toBe(true);
    expect(r.cap_reached_on_day).toBeNull();
  });

  it("a burn that exactly meets the cap fits (the cap predicate is >, not >=)", () => {
    expect(budgetRunway(nadia, 75).fits).toBe(true);
  });

  it("an agent with no orchestrator-owned bindings burns nothing and always fits", () => {
    const r = budgetRunway([], 1);
    expect(r.total_usd).toBe(0);
    expect(r.fits).toBe(true);
    expect(r.cap_reached_on_day).toBeNull();
  });
});
