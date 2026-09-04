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
