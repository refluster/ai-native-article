// @ts-nocheck — the script under test is dependency-free ESM, not TS.
// Tests the pure reconstruction logic of the 28-day lifecycle backfill.
import { describe, it, expect } from "vitest";
import {
  isTriggerable,
  classifyAsOf,
  buildLifecycleHistory,
  lastNDaysUTC,
} from "./backfill-performance-lifecycle.mjs";

describe("isTriggerable (mirrors bindingCronIsLoadBearing)", () => {
  it("true for eventbridge / gha / claude-code-routine schedulers", () => {
    expect(isTriggerable({ trigger: { scheduler: "eventbridge" } })).toBe(true);
    expect(isTriggerable({ trigger: { scheduler: "gha" } })).toBe(true);
    expect(isTriggerable({ trigger: { scheduler: "claude-code-routine" } })).toBe(true);
  });
  it("true for orchestrator-owned CCR (external + invoked_by:api)", () => {
    expect(
      isTriggerable({ executor: "claude-code-routine", trigger: { scheduler: "external", invoked_by: "api" } }),
    ).toBe(true);
  });
  it("false for manual and bare external", () => {
    expect(isTriggerable({ trigger: { scheduler: "manual" } })).toBe(false);
    expect(isTriggerable({ trigger: { scheduler: "external" } })).toBe(false);
    expect(isTriggerable({})).toBe(false);
  });
});

describe("classifyAsOf (cumulative furthest state)", () => {
  const agent = { createdAt: "2026-06-01T00:00:00Z", firstOkExecAt: "2026-06-10T12:00:00Z", hasTriggerableBinding: true };
  it("not in cohort before creation", () => {
    expect(classifyAsOf(agent, "2026-05-31T23:59:59.999Z")).toBe(null);
  });
  it("registered after creation, before binding/delivery (no binding)", () => {
    expect(classifyAsOf({ createdAt: "2026-06-01T00:00:00Z", hasTriggerableBinding: false }, "2026-06-05T23:59:59.999Z")).toBe("registered");
  });
  it("assigned when bound but not yet delivered", () => {
    expect(classifyAsOf(agent, "2026-06-05T23:59:59.999Z")).toBe("assigned");
  });
  it("delivered from the first ok exec onward", () => {
    expect(classifyAsOf(agent, "2026-06-10T23:59:59.999Z")).toBe("delivered");
    expect(classifyAsOf(agent, "2026-06-28T23:59:59.999Z")).toBe("delivered");
  });
});

describe("buildLifecycleHistory", () => {
  it("produces a cumulative, monotonic-delivered curve", () => {
    const agents = [
      { slug: "a", createdAt: "2026-06-01T00:00:00Z", firstOkExecAt: "2026-06-02T00:00:00Z", hasTriggerableBinding: true },
      { slug: "b", createdAt: "2026-06-01T00:00:00Z", firstOkExecAt: undefined, hasTriggerableBinding: true },
      { slug: "c", createdAt: "2026-06-03T00:00:00Z", firstOkExecAt: undefined, hasTriggerableBinding: false },
    ];
    const days = ["2026-06-01", "2026-06-02", "2026-06-03"];
    const h = buildLifecycleHistory(agents, days);
    expect(h[0]).toEqual({ date: "2026-06-01", registered: 0, assigned: 2, delivered: 0 });
    expect(h[1]).toEqual({ date: "2026-06-02", registered: 0, assigned: 1, delivered: 1 }); // a delivered
    expect(h[2]).toEqual({ date: "2026-06-03", registered: 1, assigned: 1, delivered: 1 }); // c joins (registered)
  });
});

describe("lastNDaysUTC", () => {
  it("returns n oldest→newest YYYY-MM-DD ending today", () => {
    const d = lastNDaysUTC(3, new Date("2026-06-23T08:00:00Z"));
    expect(d).toEqual(["2026-06-21", "2026-06-22", "2026-06-23"]);
  });
});
