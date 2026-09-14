// Unit tests for the orchestrator's ccr-prep-error project-attribution
// helper (#650): a prep failure's EXEC row must go somewhere a real
// ledger read can find it — the binding's own project when valid, else
// the agent's reserved self/{slug} observability project.
//
// Only this pure helper is exercised. The full handler() (DDB scan +
// per-routine CCR batch POST) has no test harness in this repo yet — a
// realistic one would mean mocking shared/ddb.js, shared/ccr-fire.js,
// shared/github.js, and every credential-minting module together, which
// is a bigger lift than this fix and out of scope for it (Ren: smallest
// reversible step). asProjectId/selfProjectId themselves are pure string
// transforms with no DDB/env dependency, so the real shared/project.js
// is used unmocked below rather than re-implementing its validation
// rules in a mock.

process.env.STAGE = "test";
process.env.TABLE_NAME = "wf-table-test";

import { describe, expect, it } from "vitest";

const { ccrPrepErrorProjectId } = await import("./handler.js");

describe("ccrPrepErrorProjectId", () => {
  it("uses the binding's declared project when it's a valid ProjectId", () => {
    expect(ccrPrepErrorProjectId("nobita", "luckyhat")).toBe("luckyhat");
  });

  it("falls back to self/{slug} when the binding has no project_id", () => {
    // The "binding missing project_id" prep-error itself: by definition
    // there is no real target project to attribute the row to.
    expect(ccrPrepErrorProjectId("nobita", undefined)).toBe("self/nobita");
  });

  it("falls back to self/{slug} when the declared project_id is unparseable", () => {
    // asProjectId rejects '#'/'|' (DDB row-shape delimiters) and empty
    // strings — an unusable declared id is no more attributable than a
    // missing one.
    expect(ccrPrepErrorProjectId("nobita", "bad#id")).toBe("self/nobita");
    expect(ccrPrepErrorProjectId("nobita", "")).toBe("self/nobita");
  });
});

// ML-038: the first budget-cap refusal of the month writes one loud row to the
// execution ledger. Only the pure row builder is exercised here, for the same
// reason as above — handler() still has no DDB/CCR harness — but the row's
// shape is what the console and GET /agents/{slug}/executions will render, so
// its contract is worth pinning.
const { budgetCapSkipRow } = await import("./handler.js");

describe("budgetCapSkipRow", () => {
  const row = budgetCapSkipRow({
    slug: "nadia",
    projectId: "self/nadia" as never,
    tickedAt: "2026-09-11T15:29:57.636Z",
    skill: "pr-autopilot",
    monthUsd: 8,
    plannedUsd: 0.2,
    capUsd: 8,
  });

  it("is a skipped run on the agent's own observability project, not a throw", () => {
    expect(row.status).toBe("skipped");
    expect(row.project_id).toBe("self/nadia");
    expect(row.agent_slug).toBe("nadia");
    expect(row.skill_name).toBe("pr-autopilot");
    expect(row.started_at).toBe("2026-09-11T15:29:57.636Z");
    expect(row.used_credential_types).toEqual([]);
  });

  it("names the arithmetic and the remedy where a reader will look", () => {
    expect(row.error).toMatch(/month=8\.00 \+ planned=0\.20 > cap=8\.00 \(W-3\)/);
    expect(row.error).toMatch(/PATCH budget_monthly_usd_default/);
    expect(row.summary).toMatch(/W-3 cap reached: USD 8\.00 of 8\.00/);
    expect(row.summary).toMatch(/ML-038/);
  });

  it("mints a fresh ulid per row", () => {
    const again = budgetCapSkipRow({ slug: "nadia", projectId: "self/nadia" as never, tickedAt: "2026-09-11T15:29:57.636Z", skill: "pr-autopilot", monthUsd: 8, plannedUsd: 0.2, capUsd: 8 });
    expect(again.exec_ulid).not.toBe(row.exec_ulid);
  });
});
