// Unit tests for the orchestrator's ccr-prep-error project-attribution
// helper (#650): a prep failure's EXEC row must go somewhere a real
// ledger read can find it — the binding's own project when valid, else
// the agent's reserved self/{slug} observability project.
//
// This file exercises the pure helpers only. The handler() call sites
// (batch-error loop, handleDispatch catch) are driven with the shared modules
// mocked in handler-callsites-tests.ts. asProjectId/selfProjectId themselves are pure string
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


// FU-031 class A (PR #870 review A1/A2): writeDispatchThrowRow is the single
// helper behind both new ledger writes (batch-error loop + handleDispatch
// catch). Testing it directly pins the row shape, the "-" sentinel remap,
// and the swallow-on-failure guarantee that keeps the original error alive.
import { vi, beforeEach, afterEach } from "vitest";
const project = await import("../shared/project.js");

const { writeDispatchThrowRow } = await import("./handler.js");

describe("writeDispatchThrowRow", () => {
  const base = {
    slug: "nobita",
    skill: "feed-post",
    startedAt: "2026-11-03T00:00:00.000Z",
    endedAt: "2026-11-03T00:00:01.000Z",
    error: "ccr_batch_error[r1]: boom",
    ledgerFailureEvent: "test-ledger-write-failed",
  };
  let spy: any;
  beforeEach(() => {
    spy = vi.spyOn(project, "appendExecution").mockResolvedValue(undefined as never);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes one throw row with the declared project and the error", async () => {
    await writeDispatchThrowRow({ ...base, declaredProject: "luckyhat" });
    expect(spy).toHaveBeenCalledTimes(1);
    const row = spy.mock.calls[0]![0] as Record<string, unknown>;
    expect(row).toMatchObject({
      project_id: "luckyhat",
      agent_slug: "nobita",
      skill_name: "feed-post",
      skill_version: "unknown",
      status: "throw",
      used_credential_types: [],
      error: "ccr_batch_error[r1]: boom",
    });
  });

  it('maps the "-" held-slot sentinel to self/{slug} (catches: sentinel leaking as a project id)', async () => {
    await writeDispatchThrowRow({ ...base, declaredProject: "-" });
    expect((spy.mock.calls[0]![0] as { project_id: string }).project_id).toBe("self/nobita");
  });

  it("falls back to self/{slug} when no project is declared", async () => {
    await writeDispatchThrowRow({ ...base, declaredProject: undefined });
    expect((spy.mock.calls[0]![0] as { project_id: string }).project_id).toBe("self/nobita");
  });

  it("swallows an appendExecution rejection and logs it (catches: ledger failure masking the dispatch error)", async () => {
    spy.mockRejectedValueOnce(new Error("ddb down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(writeDispatchThrowRow({ ...base, declaredProject: "luckyhat" })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("test-ledger-write-failed"));
  });
});
