// FU-031 class A (PR #870, cycle-2 findings owen A1/A2, mateo A1): the two
// call sites of writeDispatchThrowRow — the batch-error loop in handler() and
// the catch in handleDispatch — driven through the exported handler() with the
// shared modules mocked. handler-tests.ts pins the helper; this file pins that
// the helper is actually called, once per task, with the right project.

process.env.STAGE = "test";
process.env.TABLE_NAME = "wf-table-test";

import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  scanPrefix: vi.fn(),
  queryBySkPrefix: vi.fn(),
  getItem: vi.fn(),
  claimDispatchSlot: vi.fn(),
  releaseDispatchSlot: vi.fn(),
  fireCcrRoutine: vi.fn(),
  appendExecution: vi.fn(),
  getCredential: vi.fn(),
}));

vi.mock("../shared/ddb.js", async (orig) => ({
  ...(await orig<typeof import("../shared/ddb.js")>()),
  scanPrefix: m.scanPrefix,
  queryBySkPrefix: m.queryBySkPrefix,
  getItem: m.getItem,
}));
vi.mock("../shared/dispatch.js", async (orig) => ({
  ...(await orig<typeof import("../shared/dispatch.js")>()),
  claimDispatchSlot: m.claimDispatchSlot,
  releaseDispatchSlot: m.releaseDispatchSlot,
}));
vi.mock("../shared/ccr-fire.js", async (orig) => ({
  ...(await orig<typeof import("../shared/ccr-fire.js")>()),
  fireCcrRoutine: m.fireCcrRoutine,
}));
vi.mock("../shared/project.js", async (orig) => ({
  ...(await orig<typeof import("../shared/project.js")>()),
  appendExecution: m.appendExecution,
  getCredential: m.getCredential,
}));
vi.mock("../shared/engagement-token.js", () => ({ mintEngagementToken: async () => ({ token: "t" }) }));
vi.mock("../shared/budget.js", () => ({
  getMonthSpend: async () => ({ total_usd: 0 }),
  recordCapReached: async () => false,
  wouldBreachBudget: () => false,
  recordEstimatedSpend: async () => undefined,
}));
vi.mock("../shared/cron-match.js", () => ({ matchesNow: () => true }));

const { handler } = await import("./handler.js");

const binding = (project: string) => ({
  skill: "feed-post",
  executor: "claude-code-routine",
  trigger: { scheduler: "external", invoked_by: "api", cron: "cron(0 * * * ? *)" },
  routine_spec: "workforce/docs/routines/agent-runner.md",
  project_id: project,
});
const agent = (slug: string, project: string) => ({
  slug,
  archived: false,
  paused: false,
  budget_monthly_usd_default: 100,
  bindings: [binding(project)],
});

const rows = () => m.appendExecution.mock.calls.map((c) => c[0] as Record<string, any>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  m.queryBySkPrefix.mockResolvedValue([]);
  m.getCredential.mockResolvedValue({ token: "x" });
  m.appendExecution.mockResolvedValue(undefined);
  m.releaseDispatchSlot.mockResolvedValue(undefined);
  m.claimDispatchSlot.mockImplementation(async () => ({ claimed: true, claimed_at: "2026-11-03T00:00:00.000Z" }));
});

describe("handler() batch-error loop", () => {
  // Catches: the loop being deleted, or writing one row per batch instead of
  // one per task; and each row taking another task's project (held/items drift).
  it("writes one throw row per task with that task's own project and releases every slot", async () => {
    m.scanPrefix.mockResolvedValueOnce({
      items: [agent("alice", "proj-a"), agent("bob", "proj-b")],
      cursor: undefined,
    });
    m.fireCcrRoutine.mockRejectedValueOnce(new Error("POST timed out"));

    const result = await handler({}, {} as never);

    const r = rows();
    expect(r).toHaveLength(2);
    expect(r.map((x) => [x.agent_slug, x.project_id, x.status])).toEqual([
      ["alice", "proj-a", "throw"],
      ["bob", "proj-b", "throw"],
    ]);
    for (const x of r) expect(x.error).toMatch(/^ccr_batch_error\[/);
    expect(m.releaseDispatchSlot).toHaveBeenCalledTimes(2);
    expect(result.dispatched).toEqual([]);
    expect(result.skipped).toHaveLength(2);
  });

  // Catches: a ledger failure aborting the tick before slots are released or
  // before the remaining tasks are recorded.
  it("still returns, with every slot released, when appendExecution rejects", async () => {
    m.scanPrefix.mockResolvedValueOnce({
      items: [agent("alice", "proj-a"), agent("bob", "proj-b")],
      cursor: undefined,
    });
    m.fireCcrRoutine.mockRejectedValueOnce(new Error("POST timed out"));
    m.appendExecution.mockRejectedValue(new Error("ddb down"));

    const result = await handler({}, {} as never);

    expect(m.appendExecution).toHaveBeenCalledTimes(2);
    expect(m.releaseDispatchSlot).toHaveBeenCalledTimes(2);
    expect(result.skipped).toHaveLength(2);
  });

  // Catches: dispatched[] leaking the new per-item `project` field into the
  // tick result on the success path.
  it("keeps dispatched[] entries to slug/binding_idx/skill on success", async () => {
    m.scanPrefix.mockResolvedValueOnce({ items: [agent("alice", "proj-a")], cursor: undefined });
    m.fireCcrRoutine.mockResolvedValueOnce({ session_id: "s", session_url: "u" });

    const result = await handler({}, {} as never);

    expect(result.dispatched).toEqual([{ slug: "alice", binding_idx: 0, skill: "feed-post" }]);
    expect(m.appendExecution).not.toHaveBeenCalled();
  });
});

describe("handleDispatch catch (adr-0025 on-demand path)", () => {
  const event = { dispatch: { agent_slug: "alice", binding_idx: 0, reason: "t", requested_by: "t" } };

  // Catches: the ledger write being dropped, or the original error being
  // replaced instead of rethrown.
  it("writes one throw row then rethrows the original error", async () => {
    m.getItem.mockResolvedValueOnce(agent("alice", "proj-a"));
    m.fireCcrRoutine.mockRejectedValueOnce(new Error("fire failed"));

    await expect(handler(event, {} as never)).rejects.toThrow("fire failed");

    const r = rows();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ agent_slug: "alice", project_id: "proj-a", status: "throw", error: "fire failed" });
  });

  // Catches: a ledger failure masking the dispatch error the caller must see.
  it("rethrows the original error even when appendExecution also rejects", async () => {
    m.getItem.mockResolvedValueOnce(agent("alice", "proj-a"));
    m.fireCcrRoutine.mockRejectedValueOnce(new Error("fire failed"));
    m.appendExecution.mockRejectedValue(new Error("ddb down"));

    await expect(handler(event, {} as never)).rejects.toThrow("fire failed");
    expect(m.appendExecution).toHaveBeenCalledTimes(1);
  });
});
