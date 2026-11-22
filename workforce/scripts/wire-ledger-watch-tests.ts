// @ts-nocheck — the module under test is a dependency-free ESM script, not TS.
// Planner tests for wire-ledger-watch.mjs. Pure: no network, no PATCH.
import { describe, expect, it } from "vitest";

import { reconcileBinding } from "../../scripts/lib/binding-reconcile.mjs";
import { countFires } from "../lambdas/shared/cron-match.js";
import { validateIdentityPatch } from "../lambdas/shared/agent-config.js";
import {
  ALLOWED_FIRES_PER_DAY,
  cronMinute,
  djb2,
  normaliseLedgerUrl,
  parseDailyCron,
  planLedgerWatch,
  resolveBase,
  rosterTotals,
  spreadCron,
  w3Projection,
} from "./wire-ledger-watch.mjs";

const URL_A = "https://abc123.execute-api.us-west-2.amazonaws.com";
const costClassOf = (s: string) => (s === "ledger-watch" ? "medium" : "small");
const daily = (skill: string, cron: string, project_id = "agent-workforce") => ({
  skill,
  project_id,
  executor: "claude-code-routine",
  trigger: { scheduler: "external", invoked_by: "api", fired_from: "wf-orchestrator-tick", cron },
});
const agent = (slug: string, bindings: unknown[], budget = 6) => ({ slug, bindings, budget_monthly_usd_default: budget });

describe("wire-ledger-watch planner", () => {
  it("appends one binding per desk with the ledger URL in config and raises the budget to cover it", () => {
    const agents = [
      agent("soledad", [daily("feed-post", "cron(1 0 ? * * *)"), daily("daily-research", "cron(39 13 ? * * *)")]),
      agent("valeria", [daily("feed-post", "cron(2 3 ? * * *)")]),
    ];
    const plan = planLedgerWatch({ agents, ledgerUrl: URL_A, costClassOf });
    expect(plan.map((p: any) => p.action)).toEqual(["append", "append"]);
    const s = plan[0] as any;
    expect(s.desired).toMatchObject({ skill: "ledger-watch", project_id: "workflow-foundry", config: { ledger_api_url: URL_A } });
    expect(s.desired.trigger).toMatchObject({ scheduler: "external", invoked_by: "api" });
    expect(s.desired).not.toHaveProperty("bound_at"); // reconcileBinding stamps it
    expect(s.burnAfter).toBe(9); // 2 small dailies (3.0) + 1 medium daily (6.0)
    expect(s.budgetNext).toBe(9);
  });

  it("stagger lands on minutes no live binding (any project) uses, and the two desks never collide", () => {
    const sBase = djb2("soledad#ledger-watch") % 1440;
    const busy = `cron(${sBase % 60} ${Math.floor(sBase / 60)} ? * * *)`;
    const agents = [agent("other", [daily("pr-autopilot", busy, "asp-cloud")]), agent("soledad", []), agent("valeria", [])];
    const plan = planLedgerWatch({ agents, ledgerUrl: URL_A, costClassOf }) as any[];
    const minutes = plan.map((p) => cronMinute(p.cron));
    expect(minutes[0]).not.toBe(sBase);
    expect(new Set(minutes).size).toBe(2);
  });

  it("is idempotent for the same URL and refuses to replace a different one", () => {
    const bound = { ...daily("ledger-watch", "cron(5 5 ? * * *)", "workflow-foundry"), config: { ledger_api_url: URL_A } };
    const same = planLedgerWatch({ agents: [agent("soledad", [bound]), agent("valeria", [bound])], ledgerUrl: URL_A, costClassOf });
    expect(same.map((p: any) => p.action)).toEqual(["noop", "noop"]);
    const other = planLedgerWatch({ agents: [agent("soledad", [bound]), agent("valeria", [])], ledgerUrl: `${URL_A}/v2`, costClassOf });
    expect(other.map((p: any) => p.action)).toEqual(["drift", "append"]);
  });

  it("never lowers a budget and reports a desk that is not registered", () => {
    const plan = planLedgerWatch({ agents: [agent("soledad", [], 40)], ledgerUrl: URL_A, costClassOf }) as any[];
    expect(plan[0].budgetNext).toBe(40);
    expect(plan[1]).toEqual({ slug: "valeria", action: "missing" });
  });

  it("only accepts an https base URL", () => {
    expect(normaliseLedgerUrl(`${URL_A}/`)).toBe(URL_A);
    expect(normaliseLedgerUrl("http://abc.example.com")).toBeNull();
    expect(normaliseLedgerUrl(`${URL_A}?x=1`)).toBeNull();
    expect(normaliseLedgerUrl(undefined)).toBeNull();
  });

  it("roster totals sum effective budgets and modelled burn", () => {
    const t = rosterTotals([agent("a", [daily("feed-post", "cron(1 0 ? * * *)")], 6), { ...agent("b", [], 9), archived: true }], costClassOf);
    expect(t).toEqual({ planned: 6, burn: 1.5 });
  });
});

describe("wire-ledger-watch --fires-per-day", () => {
  const TODAY = "2026-11-22";
  const lw = (cron: string, note = "Daily ledger-watch.", url = URL_A) => ({
    ...daily("ledger-watch", cron, "workflow-foundry"),
    routine_spec: "workforce/docs/routines/agent-runner.md",
    config: { ledger_api_url: url },
    note,
    bound_at: "2026-11-20T05:15:24.303Z",
  });
  const desk = (slug: string, cron: string, budget = 11, note?: string) =>
    agent(slug, [daily("feed-post", "cron(1 0 ? * * *)"), daily("daily-research", "cron(39 13 ? * * *)"), daily("feed-view", "cron(52 21 ? * * *)"), lw(cron, note)], budget);
  const plan4 = (agents: unknown[], extra: Record<string, unknown> = {}) =>
    planLedgerWatch({ agents, ledgerUrl: URL_A, costClassOf, firesPerDay: 4, reason: "two-week experiment", today: TODAY, ...extra }) as any[];

  it("spreads n fires evenly from the base hour, ascending, wrapping past midnight", () => {
    expect(spreadCron(19, 22, 1)).toBe("cron(19 22 ? * * *)");
    expect(spreadCron(19, 22, 2)).toBe("cron(19 10,22 ? * * *)");
    expect(spreadCron(19, 22, 3)).toBe("cron(19 6,14,22 ? * * *)");
    expect(spreadCron(19, 22, 4)).toBe("cron(19 4,10,16,22 ? * * *)");
    expect(spreadCron(19, 22, 6)).toBe("cron(19 2,6,10,14,18,22 ? * * *)");
    expect(spreadCron(43, 2, 4)).toBe("cron(43 2,8,14,20 ? * * *)");
    expect(spreadCron(0, 0, 4)).toBe("cron(0 0,6,12,18 ? * * *)");
  });

  it("every generated cron passes the write-time validator, and the tick matcher counts n fires a day ≥ 4 h apart", () => {
    for (const n of ALLOWED_FIRES_PER_DAY) {
      const cron = spreadCron(19, 22, n);
      const v = validateIdentityPatch({ bindings: [lw(cron)] } as any, { otherAgentsEffectiveBudgetUsd: 0, skillOwners: () => [] });
      expect(v).toEqual([]);
      const day = countFires(cron, new Date("2026-06-01T00:00:00Z"), new Date("2026-06-02T00:00:00Z"));
      expect(day).toBe(n);
      const hours = parseDailyCron(cron)!.hours;
      const gaps = hours.map((h: number, i: number) => ((hours[(i + 1) % hours.length] - h + 24) % 24) || 24);
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(4); // > one 2-hourly tick window
    }
  });

  it("the validator check above is not vacuous: a list in the MINUTE field is G1-rejected", () => {
    const v = validateIdentityPatch({ bindings: [lw("cron(19,49 22 ? * * *)")] } as any, { otherAgentsEffectiveBudgetUsd: 0, skillOwners: () => [] });
    expect(v.map((x: any) => x.rule)).toContain("G1-cadence-floor");
  });

  it("rejects an n that is not allowed", () => {
    for (const n of [0, 5, 8, 12, 24]) {
      expect(() => spreadCron(19, 22, n)).toThrow(/must be one of 1, 2, 3, 4, 6/);
      expect(() => plan4([desk("soledad", "cron(19 22 ? * * *)")], { firesPerDay: n })).toThrow(/must be one of/);
    }
  });

  it("updates only trigger.cron and note of the existing binding, in place, preserving index and every other binding", () => {
    const agents = [desk("soledad", "cron(19 22 ? * * *)"), desk("valeria", "cron(43 2 ? * * *)")];
    const plan = plan4(agents);
    expect(plan.map((p) => p.action)).toEqual(["update", "update"]);
    const s = plan[0];
    expect(s).toMatchObject({ idx: 3, fromCron: "cron(19 22 ? * * *)", cron: "cron(19 4,10,16,22 ? * * *)", firesBefore: 30, firesAfter: 120 });
    const live = (agents[0] as any).bindings;
    const { bindings: next, verb } = reconcileBinding(live, s.desired, (b: any) => b.skill === "ledger-watch" && b.project_id === "workflow-foundry");
    expect(verb).toMatch(/in-place/);
    expect(next).toHaveLength(4);
    expect(next.slice(0, 3)).toEqual(live.slice(0, 3));
    const { trigger, note, ...rest } = next[3];
    const { trigger: t0, note: n0, ...rest0 } = live[3];
    expect(rest).toEqual(rest0); // bound_at, config, routine_spec, executor … untouched
    expect(trigger).toEqual({ ...t0, cron: "cron(19 4,10,16,22 ? * * *)" });
    expect(note.startsWith(`${n0}\n${TODAY}: cadence changed daily → 4×/day`)).toBe(true);
    expect(note).toContain("why: two-week experiment.");
    expect(note).toContain("[base cron(19 22 ? * * *)]");
    expect(plan[1].cron).toBe("cron(43 2,8,14,20 ? * * *)");
  });

  it("is idempotent for the same n, and reads the base back from the note to change n again or return to daily", () => {
    const first = plan4([desk("soledad", "cron(19 22 ? * * *)")])[0];
    const after = agent("soledad", [first.desired], 29);
    expect(plan4([after])[0]).toMatchObject({ action: "noop", cron: "cron(19 4,10,16,22 ? * * *)" });
    expect(resolveBase(first.desired)).toEqual({ minute: 19, baseHour: 22, n: 4 });
    const back = plan4([after], { firesPerDay: 1 })[0];
    expect(back).toMatchObject({ action: "update", cron: "cron(19 22 ? * * *)", budgetNow: 29, budgetNext: 11, burnDelta: -18 });
    expect(back.desired.note.split("\n")).toHaveLength(3);
    expect(back.desired.note).toMatch(/4×\/day → daily/);
    const six = plan4([after], { firesPerDay: 6 })[0];
    expect(six.cron).toBe("cron(19 2,6,10,14,18,22 ? * * *)");
    // Without --fires-per-day an existing binding is never touched.
    expect(plan4([after], { firesPerDay: undefined })[0].action).toBe("noop");
  });

  it("refuses a list cron whose base it cannot establish rather than guessing", () => {
    const noMarker = plan4([desk("soledad", "cron(19 4,10,16,22 ? * * *)")])[0];
    expect(noMarker).toMatchObject({ action: "unreadable", idx: 3 });
    const handEdited = plan4([desk("soledad", "cron(19 4,11,16,22 ? * * *)", 11, "x [base cron(19 22 ? * * *)]")], { firesPerDay: 2 })[0];
    expect(handEdited.action).toBe("unreadable");
    expect(plan4([desk("soledad", "cron(19 0/6 ? * * *)")])[0].action).toBe("unreadable");
  });

  it("still refuses when the live binding points at a different ledger URL", () => {
    const a = agent("soledad", [lw("cron(19 22 ? * * *)", "n", `${URL_A}/v2`)]);
    expect(plan4([a])[0]).toMatchObject({ action: "drift", live: `${URL_A}/v2`, wanted: URL_A });
  });

  it("moves the budget by exactly the modelled-burn change: medium 0.20 × 30 × Δn", () => {
    const plan = plan4([desk("soledad", "cron(19 22 ? * * *)"), desk("valeria", "cron(43 2 ? * * *)")]);
    for (const p of plan) {
      expect(p.burnBefore).toBe(10.5); // 3 small dailies 4.5 + 1 medium daily 6
      expect(p.burnAfter).toBe(28.5);
      expect(p.burnDelta).toBe(0.2 * 30 * 3);
      expect(p.budgetNext).toBe(11 + 18);
      expect(p.plannedDelta).toBe(18);
    }
    const w3 = w3Projection([desk("soledad", "cron(19 22 ? * * *)"), desk("valeria", "cron(43 2 ? * * *)")], plan, costClassOf, 800);
    expect(w3.before).toEqual({ planned: 22, burn: 21 });
    expect(w3.after).toEqual({ planned: 58, burn: 57 }); // ledger-watch: 2 × 4 × 30 × 0.20 = 48 vs 12
    expect(w3.crosses).toBe(false);
  });

  it("refuses when the new roster total would cross the W-3 ceiling", () => {
    const agents = [desk("soledad", "cron(19 22 ? * * *)", 11), desk("valeria", "cron(43 2 ? * * *)", 11), agent("other", [], 770)];
    const plan = plan4(agents);
    expect(w3Projection(agents, plan, costClassOf, 800)).toMatchObject({ before: { planned: 792 }, after: { planned: 828 }, crosses: true });
  });

  it("an override below the new burn is the operator's figure and is not overridden", () => {
    const a = { ...desk("soledad", "cron(19 22 ? * * *)"), budget_monthly_usd_override: 20 };
    expect(plan4([a])[0]).toMatchObject({ action: "override", override: 20, burnAfter: 28.5 });
  });

  it("a NEW binding with --fires-per-day > 1 is appended already spread, and its extra minutes join the taken-set", () => {
    const plan = plan4([agent("soledad", []), agent("valeria", [])]);
    expect(plan.map((p) => p.action)).toEqual(["append", "append"]);
    expect(parseDailyCron(plan[0].cron)!.hours).toHaveLength(4);
    expect(plan[0].desired.note).toContain("[base cron(");
    expect(plan[0].burnAfter).toBe(24);
    const all = plan.flatMap((p) => parseDailyCron(p.cron)!.hours.map((h: number) => h * 60 + parseDailyCron(p.cron)!.minute));
    expect(new Set(all).size).toBe(8); // the two desks' 4 + 4 fire minutes are distinct
  });
});

