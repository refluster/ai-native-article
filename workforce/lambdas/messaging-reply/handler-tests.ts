// Unit tests for wf-messaging-reply (Epic-013 Story 3).
//
// The shared messaging store, the Claude wrapper, persona file reads, and
// CloudWatch are all mocked — these tests pin the handler's decision logic:
// loop-safety skips, the per-thread budget, the W-1 guards (artefact / empty /
// truncation), the __NO_REPLY_NEEDED__ sentinel, and the happy-path write.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aws-sdk/client-cloudwatch", () => ({
  CloudWatchClient: class {
    send() {
      return Promise.resolve();
    }
  },
  PutMetricDataCommand: class {
    constructor(public input: unknown) {}
  },
}));

const complete = vi.fn();
vi.mock("../shared/llm-anthropic.js", () => ({
  complete: (...args: unknown[]) => complete(...args),
}));

const getThreadDetail = vi.fn();
const sendMessage = vi.fn();
vi.mock("../shared/messaging.js", () => ({
  MESSAGING_OPERATOR_ID: "operator",
  getThreadDetail: (...args: unknown[]) => getThreadDetail(...args),
  sendMessage: (...args: unknown[]) => sendMessage(...args),
}));

// Recall + memory grounding (skill 0.2.0). Mocked wholesale: memory.ts
// throws at module load without BUCKET_NAME, and recall-prompt pulls the
// whole ddb/voyage stack. Defaults are "nothing to recall" — individual
// tests override.
const buildRecallBlock = vi.fn();
vi.mock("../shared/recall-prompt.js", () => ({
  buildRecallBlock: (...args: unknown[]) => buildRecallBlock(...args),
}));
const readIndex = vi.fn();
const readChunk = vi.fn();
vi.mock("../shared/memory.js", () => ({
  readIndex: (...args: unknown[]) => readIndex(...args),
  readChunk: (...args: unknown[]) => readChunk(...args),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async (p: string) => {
    if (p.endsWith("agent.json")) return JSON.stringify({ model: "anthropic:claude-sonnet-4-6" });
    if (p.endsWith("system.md")) return "You are Maya, a backend engineer on the workforce.";
    throw new Error(`unexpected read: ${p}`);
  }),
}));

import { handler } from "./handler.js";

const NOW = new Date().toISOString();
const TODAY = NOW.slice(0, 10);

function thread(
  messages: Array<{ from: string; body: string; at?: string }>,
  participants = ["maya"],
) {
  return {
    thread_id: "01THREAD",
    participants,
    group: participants.length > 1,
    starred: false,
    created_by: "operator",
    created_at: NOW,
    messages: messages.map((m) => ({ message_id: "m", from: m.from, at: m.at ?? NOW, body: m.body })),
  };
}

function completion(text: string, stop_reason = "end_turn") {
  return { text, tokens_in: 120, tokens_out: 18, stop_reason, cost_usd: 0.001 };
}

beforeEach(() => {
  complete.mockReset();
  getThreadDetail.mockReset();
  sendMessage.mockReset();
  sendMessage.mockResolvedValue({ message_id: "01REPLY" });
  buildRecallBlock.mockReset();
  buildRecallBlock.mockResolvedValue("");
  readIndex.mockReset();
  readIndex.mockResolvedValue(undefined);
  readChunk.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("happy path", () => {
  it("generates a reply and writes the talent MSG row with LLM metadata", async () => {
    getThreadDetail.mockResolvedValueOnce(
      thread([{ from: "operator", body: "Did the migration land?" }]),
    );
    complete.mockResolvedValueOnce(completion("Yes — merged an hour ago, backfill running now."));

    const res = await handler({ thread_id: "01THREAD", addressed_slug: "maya" });

    expect(res).toEqual({ status: "ok", message_id: "01REPLY" });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]![0]).toMatchObject({
      thread_id: "01THREAD",
      from: "maya",
      body: "Yes — merged an hour ago, backfill running now.",
      finish_reason: "end_turn",
      tokens_in: 120,
      tokens_out: 18,
      skill_version: "0.2.0",
    });
    // The persona system.md is fed into the LLM system prompt.
    expect(complete.mock.calls[0]![0].system).toContain("You are Maya");
    expect(complete.mock.calls[0]![0].model).toBe("anthropic:claude-sonnet-4-6");
  });
});

describe("recall packet grounding (0.2.0)", () => {
  it("folds the recall block and the latest memory summary into the system prompt", async () => {
    getThreadDetail.mockResolvedValueOnce(
      thread([{ from: "operator", body: "How did the backfill go?" }]),
    );
    buildRecallBlock.mockResolvedValueOnce(
      "## Relevant past work (recalled)\n\n- [2026-06-08 · feed-post · ok] Backfill finished clean.",
    );
    readIndex.mockResolvedValueOnce({ latest_summary_key: "memory/maya/v0007.md" });
    readChunk.mockResolvedValueOnce("Working on the EXEC backfill; ledger now consistent.");
    complete.mockResolvedValueOnce(completion("Finished yesterday — ledger is consistent now."));

    const res = await handler({ thread_id: "01THREAD", addressed_slug: "maya" });

    expect(res.status).toBe("ok");
    const system = complete.mock.calls[0]![0].system as string;
    expect(system).toContain("Relevant past work (recalled)");
    expect(system).toContain("Backfill finished clean.");
    expect(system).toContain("## Your memory (latest summary)");
    expect(system).toContain("ledger now consistent");
    // Recall is keyed on the inbound message + the agent's self project.
    expect(buildRecallBlock.mock.calls[0]![0]).toMatchObject({
      caller_agent_slug: "maya",
      brief: "How did the backfill go?",
      skillName: "messaging-reply",
      projectId: "self/maya",
    });
    expect(readChunk).toHaveBeenCalledWith("memory/maya/v0007.md");
  });

  it("caps an oversized memory summary with a visible omission marker", async () => {
    getThreadDetail.mockResolvedValueOnce(thread([{ from: "operator", body: "Status?" }]));
    readIndex.mockResolvedValueOnce({ latest_summary_key: "memory/maya/v0009.md" });
    readChunk.mockResolvedValueOnce("x".repeat(5000));
    complete.mockResolvedValueOnce(completion("All good."));

    await handler({ thread_id: "01THREAD", addressed_slug: "maya" });

    const system = complete.mock.calls[0]![0].system as string;
    expect(system).toContain("…(older memory omitted)");
    expect(system).not.toContain("x".repeat(1300));
  });

  it("fail-soft: a broken memory read still produces a reply", async () => {
    getThreadDetail.mockResolvedValueOnce(thread([{ from: "operator", body: "ping" }]));
    readIndex.mockRejectedValueOnce(new Error("ddb offline"));
    complete.mockResolvedValueOnce(completion("pong — all quiet."));

    const res = await handler({ thread_id: "01THREAD", addressed_slug: "maya" });

    expect(res.status).toBe("ok");
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe("__NO_REPLY_NEEDED__ sentinel", () => {
  it("writes no message and reports skipped", async () => {
    getThreadDetail.mockResolvedValueOnce(thread([{ from: "operator", body: "Nice. Ship it." }]));
    complete.mockResolvedValueOnce(completion("__NO_REPLY_NEEDED__"));

    const res = await handler({ thread_id: "01THREAD", addressed_slug: "maya" });

    expect(res).toEqual({ status: "skipped", reason: "no_reply_needed" });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("W-1 guards", () => {
  it("throws on an LLM-failure artefact in the head", async () => {
    getThreadDetail.mockResolvedValueOnce(thread([{ from: "operator", body: "Status?" }]));
    complete.mockResolvedValueOnce(completion("As an AI language model, I cannot..."));

    await expect(handler({ thread_id: "01THREAD", addressed_slug: "maya" })).rejects.toThrow(
      /llm_artefact_in_head/,
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("throws on an empty body after trim", async () => {
    getThreadDetail.mockResolvedValueOnce(thread([{ from: "operator", body: "Status?" }]));
    complete.mockResolvedValueOnce(completion("   \n  "));

    await expect(handler({ thread_id: "01THREAD", addressed_slug: "maya" })).rejects.toThrow(
      /empty reply body/,
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("propagates the truncation throw from complete()", async () => {
    getThreadDetail.mockResolvedValueOnce(thread([{ from: "operator", body: "Status?" }]));
    complete.mockRejectedValueOnce(new Error("anthropic stop_reason=max_tokens (truncated)."));

    await expect(handler({ thread_id: "01THREAD", addressed_slug: "maya" })).rejects.toThrow(
      /max_tokens/,
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("loop safety + budget", () => {
  it("skips when the last message is already the agent's own (no inbound)", async () => {
    getThreadDetail.mockResolvedValueOnce(
      thread([
        { from: "operator", body: "ping" },
        { from: "maya", body: "already replied" },
      ]),
    );

    const res = await handler({ thread_id: "01THREAD", addressed_slug: "maya" });

    expect(res).toEqual({ status: "skipped", reason: "no_inbound" });
    expect(complete).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("throws when the per-thread daily reply budget is exhausted", async () => {
    const burst = Array.from({ length: 50 }, () => ({ from: "maya", body: "x", at: NOW }));
    getThreadDetail.mockResolvedValueOnce(
      thread([...burst, { from: "operator", body: "one more?", at: NOW }]),
    );

    await expect(handler({ thread_id: "01THREAD", addressed_slug: "maya" })).rejects.toThrow(
      /reply budget exhausted/,
    );
    expect(complete).not.toHaveBeenCalled();
    expect(TODAY).toBe(NOW.slice(0, 10)); // guard: fixtures are same-UTC-day
  });
});

describe("input validation", () => {
  it("refuses to address the operator", async () => {
    await expect(handler({ thread_id: "01THREAD", addressed_slug: "operator" })).rejects.toThrow(
      /must be a talent/,
    );
  });

  it("throws when the addressed slug is not a participant", async () => {
    getThreadDetail.mockResolvedValueOnce(thread([{ from: "operator", body: "hi" }], ["dario"]));

    await expect(handler({ thread_id: "01THREAD", addressed_slug: "maya" })).rejects.toThrow(
      /not a participant/,
    );
  });
});
