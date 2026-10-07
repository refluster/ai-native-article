import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.TABLE_NAME = "wf-table-test";
process.env.STAGE = "test";

let execRows: unknown[] = [];
let spent: unknown = undefined;
let llmText = "[]";
const puts: Record<string, unknown>[] = [];
const spend: unknown[] = [];
let llmCalls = 0;

vi.mock("../shared/ddb.js", () => ({
  scanExecWindow: async () => execRows,
  getItem: async () => spent,
  putItem: async (i: Record<string, unknown>) => { puts.push(i); },
  ddb: { send: async (c: unknown) => { spend.push(c); } },
}));
vi.mock("../shared/llm-anthropic.js", () => ({
  complete: async () => { llmCalls++; return { text: llmText, tokens_in: 10, tokens_out: 5, cost_usd: 0.001, stop_reason: "end_turn" }; },
}));
vi.mock("@aws-sdk/client-cloudwatch", () => ({
  CloudWatchClient: class { send = async () => ({}); },
  PutMetricDataCommand: class { constructor(public input: unknown) {} },
}));

const { handler } = await import("./handler.js");
const NOW = "2026-10-07T04:00:00Z";
const failing = { pk: "PROJECT#p1", sk: "EXEC#B", project_id: "p1", agent_slug: "ren", skill_name: "feed-post", started_at: "2026-10-06T01:00:00Z", status: "throw", error: "422" };

beforeEach(() => { execRows = [failing]; spent = undefined; llmText = "[]"; puts.length = 0; spend.length = 0; llmCalls = 0; });

describe("lesson-distiller handler", () => {
  it("skips without an LLM call when the day has no rows", async () => {
    execRows = [];
    const r = await handler({ now: NOW });
    expect(r.skipped).toBe("no_rows");
    expect(llmCalls).toBe(0);
  });
  it("one pass: writes valid candidates, rejects the rest, charges the daily row", async () => {
    llmText = JSON.stringify([
      { scope: "skill:feed-post", body: "Feed posts 422 on empty bodies.", source_refs: ["PROJECT#p1/EXEC#B"], lintable: "no", lintable_reason: "judgment" },
      { scope: "bogus", body: "x", source_refs: ["PROJECT#p1/EXEC#B"], lintable: "no", lintable_reason: "r" },
    ]);
    const r = await handler({ now: NOW });
    expect(llmCalls).toBe(1);
    expect(r).toMatchObject({ day: "2026-10-06", proposed: 2, written: 1, rejected: { scope_not_in_closed_grammar: 1 } });
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ pk: "LESSON", status: "candidate" });
    expect(spend).toHaveLength(1);
  });
  it("throws before the LLM call when the daily budget is spent", async () => {
    spent = { tokens_in: 149_000, tokens_out: 0 };
    await expect(handler({ now: NOW })).rejects.toThrow(/budget exceeded/);
    expect(llmCalls).toBe(0);
  });
  it("fails loud on a malformed model reply", async () => {
    llmText = "not json";
    await expect(handler({ now: NOW })).rejects.toThrow();
  });
});
