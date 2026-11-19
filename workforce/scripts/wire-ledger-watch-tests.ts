// @ts-nocheck — the module under test is a dependency-free ESM script, not TS.
// Planner tests for wire-ledger-watch.mjs. Pure: no network, no PATCH.
import { describe, expect, it } from "vitest";

import {
  cronMinute,
  djb2,
  normaliseLedgerUrl,
  planLedgerWatch,
  rosterTotals,
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
