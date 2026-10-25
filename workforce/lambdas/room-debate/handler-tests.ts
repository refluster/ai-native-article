// Unit tests for wf-room-debate (Rooms v1, workforce/adr-0048 proposed).
//
// The room reads (META, transcript, daily count), the Claude wrapper, the
// persona rows, memory and CloudWatch are mocked; the WRITE path is the real
// shared/room.ts appendTurn / updateRoomMeta over a mocked DDB, so the tests
// see the exact TURN row and META patch a turn produces. They pin the run
// guards (archived / superseded / already spoke / participant / budget /
// chair-only), the turn-slot claim (an overlapping duplicate delivery loses
// the conditional put and stops), the hand-off (a superseded / archived /
// already-spoken turn
// stops the chain, every other outcome — including a throw — passes the
// baton), the W-1 guards, POSITION parsing, the language line, ordinal
// round labels, the bounded transcript window, the conclusion's META flip
// and the steer-during-conclusion notice.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const metrics: string[] = [];
vi.mock("@aws-sdk/client-cloudwatch", () => ({
  CloudWatchClient: class {
    send(cmd: { input: { MetricData: Array<{ MetricName: string; Dimensions: Array<{ Name: string; Value: string }> }> } }) {
      const d = cmd.input.MetricData[0]!;
      const dims = d.Dimensions.filter((x) => x.Name !== "Stage").map((x) => `${x.Name}=${x.Value}`);
      metrics.push(dims.length > 0 ? `${d.MetricName}{${dims.join(",")}}` : d.MetricName);
      return Promise.resolve();
    }
  },
  PutMetricDataCommand: class {
    constructor(public input: unknown) {}
  },
}));

// The run hand-off: the Lambda async-invokes itself for the next turn.
const lambdaSend = vi.fn();
vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: class {
    send(cmd: unknown) {
      return lambdaSend(cmd);
    }
  },
  InvokeCommand: class {
    constructor(public input: { FunctionName: string; InvocationType: string; Payload: Uint8Array }) {}
  },
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send() {
      return Promise.resolve({});
    }
  },
  GetObjectCommand: class {
    constructor(public input: unknown) {}
  },
  PutObjectCommand: class {
    constructor(public input: unknown) {}
  },
}));

const complete = vi.fn();
vi.mock("../shared/llm-anthropic.js", () => ({
  complete: (...args: unknown[]) => complete(...args),
}));

const readIndex = vi.fn();
const readChunk = vi.fn();
vi.mock("../shared/memory.js", () => ({
  readIndex: (...args: unknown[]) => readIndex(...args),
  readChunk: (...args: unknown[]) => readChunk(...args),
}));

const getItem = vi.fn();
const putItem = vi.fn();
const conditionalPutItem = vi.fn();
const ddbSend = vi.fn();
vi.mock("../shared/ddb.js", () => ({
  ddb: { send: (cmd: unknown) => ddbSend(cmd) },
  getItem: (...args: unknown[]) => getItem(...args),
  putItem: (...args: unknown[]) => putItem(...args),
  conditionalPutItem: (...args: unknown[]) => conditionalPutItem(...args),
  queryByGsiPaged: vi.fn(),
  updateOperational: vi.fn(),
}));

// Reads mocked; appendTurn / updateRoomMeta / claimTurnSlot / parsePosition
// stay real.
const listRoomTurns = vi.fn();
const listRoomTurnRows = vi.fn();
const countAgentTurnsSince = vi.fn();
vi.mock("../shared/room.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../shared/room.js")>();
  return {
    ...real,
    listRoomTurns: (...args: unknown[]) => listRoomTurns(...args),
    listRoomTurnRows: (...args: unknown[]) => listRoomTurnRows(...args),
    countAgentTurnsSince: (...args: unknown[]) => countAgentTurnsSince(...args),
  };
});

import { handler, type RoomDebateEvent } from "./handler.js";

const ROOM = "01J00000000000000000000001";
const RUN = "01J00000000000000000000002";

const AGENTS: Record<string, Record<string, unknown>> = {
  maya: { slug: "maya", first_name: "Maya", last_name: "Ishikawa", role: "PM", model: "anthropic:claude-sonnet-4-6", system_prompt: "You are Maya, the PM." },
  dario: { slug: "dario", first_name: "Dario", last_name: "Bianchi", role: "Governance", model: "anthropic:claude-sonnet-4-6", system_prompt: "You are Dario, governance." },
  ren: { slug: "ren", first_name: "Ren", last_name: "Tanaka", role: "Engineer", model: "anthropic:claude-sonnet-4-6", system_prompt: "You are Ren, an engineer." },
};

let META: Record<string, unknown>;

function turn(over: Record<string, unknown>) {
  return { turn_id: "01J00000000000000000000010", room_id: ROOM, run_id: RUN, round: 0, kind: "opening", from: "operator", at: "t0", body: "Should we ship Rooms this week?", ...over };
}

function completion(text: string, stop_reason = "end_turn") {
  return { text, tokens_in: 900, tokens_out: 240, stop_reason, cost_usd: 0.01 };
}

const EVENT: RoomDebateEvent = {
  room_id: ROOM,
  run_id: RUN,
  speaker: "maya",
  round: 1,
  kind: "statement",
  then: [
    { speaker: "dario", round: 1, kind: "statement" },
    { speaker: "dario", round: 2, kind: "conclusion" },
  ],
};

/** META patches the turn wrote (UpdateCommand inputs). */
function metaUpdates(): Array<Record<string, unknown>> {
  return ddbSend.mock.calls.map((c) => (c[0] as { input: Record<string, unknown> }).input);
}

function handoff(n = 0): Record<string, unknown> {
  const cmd = lambdaSend.mock.calls[n]![0] as { input: { FunctionName: string; InvocationType: string; Payload: Uint8Array } };
  expect(cmd.input.FunctionName).toBe("wf-room-debate-test");
  expect(cmd.input.InvocationType).toBe("Event");
  return JSON.parse(Buffer.from(cmd.input.Payload).toString("utf8"));
}

beforeEach(() => {
  process.env.AWS_LAMBDA_FUNCTION_NAME = "wf-room-debate-test";
  process.env.BUCKET_NAME = "wf-bucket-test";
  process.env.TABLE_NAME = "wf-table-test";
  metrics.length = 0;
  META = {
    pk: `ROOM#${ROOM}`,
    sk: "META",
    room_id: ROOM,
    title: "Ship Rooms?",
    question: "Should we ship Rooms this week?",
    context: "Docs are half done.",
    status: "debating",
    participants: ["maya", "dario"],
    chair: "dario",
    rounds: 1,
    run_id: RUN,
    run_count: 1,
    run_start_round: 1,
    run_rounds: 1,
    turn_count: 1,
  };
  lambdaSend.mockReset();
  lambdaSend.mockResolvedValue({});
  complete.mockReset();
  readIndex.mockReset();
  readIndex.mockResolvedValue(undefined);
  readChunk.mockReset();
  getItem.mockReset();
  getItem.mockImplementation(async (pk: string, sk: string) => {
    if (pk === `ROOM#${ROOM}` && sk === "META") return META;
    if (pk.startsWith("AGENT#") && sk === "META") return AGENTS[pk.slice("AGENT#".length)];
    return undefined;
  });
  putItem.mockReset();
  putItem.mockResolvedValue(undefined);
  conditionalPutItem.mockReset();
  conditionalPutItem.mockResolvedValue(undefined);
  ddbSend.mockReset();
  ddbSend.mockImplementation(async () => ({ Attributes: META }));
  listRoomTurns.mockReset();
  listRoomTurns.mockResolvedValue([turn({})]);
  listRoomTurnRows.mockReset();
  listRoomTurnRows.mockResolvedValue([]);
  countAgentTurnsSince.mockReset();
  countAgentTurnsSince.mockResolvedValue(0);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("statement — happy path", () => {
  it("parses POSITION, writes the TURN row with LLM metadata, then passes the baton", async () => {
    complete.mockResolvedValueOnce(
      completion("POSITION: Ship behind a flag this week.\n\nThe console is ready; the docs gap is a runbook, not a blocker."),
    );

    const res = await handler(EVENT);

    expect(res.status).toBe("ok");
    expect(putItem).toHaveBeenCalledTimes(1);
    expect(putItem.mock.calls[0]![0]).toMatchObject({
      pk: `ROOM#${ROOM}`,
      room_id: ROOM,
      run_id: RUN,
      round: 1,
      kind: "statement",
      from: "maya",
      position: "Ship behind a flag this week.",
      body_preview: "The console is ready; the docs gap is a runbook, not a blocker.",
      finish_reason: "end_turn",
      tokens_in: 900,
      tokens_out: 240,
      skill_version: "0.1.0",
    });
    expect(String(putItem.mock.calls[0]![0].sk)).toMatch(/^TURN#/);
    // META: last_turn_at + turn_count bump, no status change on a statement.
    expect(metaUpdates()[0]!.UpdateExpression).toMatch(/ADD #turn_count :inc_turn_count/);
    expect(metaUpdates()[0]!.ExpressionAttributeValues).not.toHaveProperty(":status");
    expect(handoff()).toEqual({
      room_id: ROOM,
      run_id: RUN,
      speaker: "dario",
      round: 1,
      kind: "statement",
      then: [{ speaker: "dario", round: 2, kind: "conclusion" }],
    });
    expect(metrics).toContain("WfRoomTurn{Slug=maya}");
  });

  it("composes persona + debate contract + roster + round, and puts the question and transcript in the user turn", async () => {
    listRoomTurns.mockResolvedValueOnce([
      turn({}),
      turn({ turn_id: "01J00000000000000000000011", from: "dario", round: 1, kind: "statement", position: "Hold.", body: "Docs first, Maya." }),
      turn({ turn_id: "01J00000000000000000000012", from: "operator", kind: "steer", body: "Consider cost too." }),
    ]);
    readIndex.mockResolvedValueOnce({ latest_summary_key: "memory/maya/v0003.md" });
    readChunk.mockResolvedValueOnce("Shipped the boards feature last month.");
    complete.mockResolvedValueOnce(completion("POSITION: Ship.\nDario, the runbook can follow."));

    await handler({ ...EVENT, then: [] });

    const call = complete.mock.calls[0]![0];
    // The Room engine's model, not the persona's (its META row says sonnet-4-6).
    expect(call.model).toBe("anthropic:claude-sonnet-5-5");
    expect(call.effort).toBe("medium");
    // …and the turn row records which engine spoke.
    const turnPut = putItem.mock.calls.map((c) => c[0] as Record<string, unknown>).find((r) => String(r.sk).startsWith("TURN#"));
    expect(turnPut).toMatchObject({ model: "anthropic:claude-sonnet-5-5", effort: "medium" });
    expect(call.maxTokens).toBe(1600);
    expect(call.reasoningBudgetTokens).toBeGreaterThanOrEqual(1024);
    expect(call.system).toContain("You are Maya, the PM.");
    expect(call.system).toContain("POSITION: <one sentence>");
    expect(call.system).toContain("__NO_REPLY_NEEDED__");
    expect(call.system).toContain("`dario` — Dario Bianchi, Governance (chair)");
    expect(call.system).toContain("This is round 1 of 1.");
    expect(call.system).toContain("Shipped the boards feature last month.");
    expect(call.user).toContain("Should we ship Rooms this week?");
    expect(call.user).toContain("Docs are half done.");
    expect(call.user).toContain("[Round 1] dario: POSITION: Hold.\nDocs first, Maya.");
    expect(call.user).toContain("Operator (steer): Consider cost too.");
  });

  it("fail-soft: no POSITION line still lands the turn, without a position", async () => {
    complete.mockResolvedValueOnce(completion("I'd ship it, carefully."));
    await handler({ ...EVENT, then: [] });
    expect(putItem.mock.calls[0]![0].position).toBeUndefined();
    expect(putItem.mock.calls[0]![0].body_preview).toBe("I'd ship it, carefully.");
  });
});

describe("engine config (WF_ROOM_MODEL / WF_ROOM_EFFORT)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("honours the env override per call", async () => {
    vi.stubEnv("WF_ROOM_MODEL", "anthropic:claude-opus-5-5");
    vi.stubEnv("WF_ROOM_EFFORT", "high");
    complete.mockResolvedValueOnce(completion("POSITION: Ship.\nFine."));
    await handler({ ...EVENT, then: [] });
    const call = complete.mock.calls[0]![0];
    expect(call.model).toBe("anthropic:claude-opus-5-5");
    expect(call.effort).toBe("high");
  });

  it("an invalid WF_ROOM_EFFORT throws under room_config BEFORE the claim and the Claude call (W-4), and still hands off", async () => {
    vi.stubEnv("WF_ROOM_EFFORT", "extreme");
    await expect(handler({ ...EVENT, then: [{ speaker: "dario", round: 1, kind: "statement" }] })).rejects.toThrow(/WF_ROOM_EFFORT=extreme/);
    expect(conditionalPutItem).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(lambdaSend).toHaveBeenCalledTimes(1); // the baton still passed
  });

  it("a non-Anthropic WF_ROOM_MODEL is refused the same way", async () => {
    vi.stubEnv("WF_ROOM_MODEL", "azure:gpt-5");
    await expect(handler({ ...EVENT, then: [] })).rejects.toThrow(/WF_ROOM_MODEL=azure:gpt-5/);
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("run guards", () => {
  it("superseded run_id: skips AND does not pass the baton", async () => {
    META.run_id = "01J0000000000000000000NEWR";
    const res = await handler(EVENT);
    expect(res).toEqual({ status: "skipped", reason: "superseded" });
    expect(complete).not.toHaveBeenCalled();
    expect(lambdaSend).not.toHaveBeenCalled();
    expect(metrics).toContain("WfRoomTurnSkipped{Reason=superseded}");
  });

  it("already_spoke (duplicate delivery): skips AND stops — the copy that wrote the turn already passed the baton", async () => {
    // Passing it again would invoke the next speaker twice and fork the run
    // past participants × rounds + 1 (async retries are off, so a duplicate
    // is never a recovery path).
    listRoomTurns.mockResolvedValueOnce([turn({}), turn({ turn_id: "01J00000000000000000000011", from: "maya", round: 1, kind: "statement", body: "Already said." })]);
    const res = await handler(EVENT);
    expect(res).toEqual({ status: "skipped", reason: "already_spoke" });
    expect(complete).not.toHaveBeenCalled();
    expect(lambdaSend).not.toHaveBeenCalled();
    expect(metrics).toContain("WfRoomTurnSkipped{Reason=already_spoke}");
  });

  it("claims the turn's slot exactly once, with a conditional put, before the Claude call", async () => {
    complete.mockResolvedValueOnce(completion("POSITION: Ship.\nYes."));
    await handler(EVENT);
    expect(conditionalPutItem).toHaveBeenCalledTimes(1);
    const [item, condition] = conditionalPutItem.mock.calls[0]! as [Record<string, unknown>, string];
    expect(item).toMatchObject({
      pk: `ROOM#${ROOM}`,
      sk: `CLAIM#${RUN}#1#statement#maya`,
      room_id: ROOM,
      run_id: RUN,
      round: 1,
      kind: "statement",
      speaker: "maya",
    });
    expect(typeof item.claimed_at).toBe("string");
    expect(condition).toBe("attribute_not_exists(sk)");
    expect(conditionalPutItem.mock.invocationCallOrder[0]!).toBeLessThan(complete.mock.invocationCallOrder[0]!);
  });

  it("an overlapping duplicate delivery (claim lost): no LLM call, no turn, no baton", async () => {
    // Both copies passed the transcript check (the other one has not written
    // its turn yet); only the conditional put tells them apart.
    conditionalPutItem.mockRejectedValueOnce(
      Object.assign(new Error("The conditional request failed"), { name: "ConditionalCheckFailedException" }),
    );
    const res = await handler(EVENT);
    expect(res).toEqual({ status: "skipped", reason: "already_spoke" });
    expect(complete).not.toHaveBeenCalled();
    expect(putItem).not.toHaveBeenCalled();
    expect(lambdaSend).not.toHaveBeenCalled();
    expect(metrics).toContain("WfRoomTurnSkipped{Reason=already_spoke}");
  });

  it("a claim write that fails for another reason throws (W-4) and still hands off", async () => {
    conditionalPutItem.mockRejectedValueOnce(new Error("ddb throttled"));
    await expect(handler(EVENT)).rejects.toThrow(/ddb throttled/);
    expect(complete).not.toHaveBeenCalled();
    expect(lambdaSend).toHaveBeenCalledTimes(1);
  });

  it("the same speaker in another run or round is NOT already_spoke", async () => {
    listRoomTurns.mockResolvedValueOnce([turn({}), turn({ from: "maya", round: 1, kind: "statement", run_id: "01J0000000000000000000OLDR", body: "Old run." })]);
    complete.mockResolvedValueOnce(completion("POSITION: Still ship.\nSame view as before."));
    expect((await handler({ ...EVENT, then: [] })).status).toBe("ok");
  });

  it("archived room: skips AND stops the chain (no self-invoke), like superseded", async () => {
    META.archived = true;
    expect(await handler(EVENT)).toEqual({ status: "skipped", reason: "archived" });
    expect(complete).not.toHaveBeenCalled();
    expect(lambdaSend).not.toHaveBeenCalled();
    expect(metrics).toContain("WfRoomTurnSkipped{Reason=archived}");
    // W-4: the stopped run is said on META (run-guarded), so an unarchived
    // room does not read "Deliberating" forever.
    const patch = metaUpdates()[0]!;
    expect(patch.ExpressionAttributeValues).toMatchObject({ ":if_run_id": RUN });
    expect(String((patch.ExpressionAttributeValues as Record<string, string>)[":last_error"])).toMatch(/room was archived/);
  });

  it("archived skip of a concluded room or a stale run writes nothing", async () => {
    Object.assign(META, { archived: true, status: "concluded" });
    await handler(EVENT);
    Object.assign(META, { status: "debating", run_id: "01J0000000000000000000NEWR" });
    await handler(EVENT);
    expect(ddbSend).not.toHaveBeenCalled();
  });

  it("throws when the room META is missing (and still hands off)", async () => {
    getItem.mockImplementation(async () => undefined);
    await expect(handler(EVENT)).rejects.toThrow(/room .* not found/);
    expect(lambdaSend).toHaveBeenCalledTimes(1);
  });

  it("throws when the speaker is not a participant", async () => {
    await expect(handler({ ...EVENT, speaker: "ren" })).rejects.toThrow(/not a participant/);
    expect(complete).not.toHaveBeenCalled();
  });

  it("throws on the per-room daily budget, before any Claude call", async () => {
    countAgentTurnsSince.mockResolvedValueOnce(60);
    await expect(handler(EVENT)).rejects.toThrow(/daily turn budget exhausted \(60\/60\)/);
    expect(complete).not.toHaveBeenCalled();
    expect(metrics).toContain("WfRoomBudgetExceeded{Slug=maya}");
    // The budget is counted from the start of the UTC day.
    const since = countAgentTurnsSince.mock.calls[0]![1] as number;
    expect(new Date(since).toISOString()).toMatch(/T00:00:00\.000Z$/);
  });

  it("only the chair writes the conclusion", async () => {
    await expect(handler({ ...EVENT, kind: "conclusion", round: 2, then: [] })).rejects.toThrow(/not the chair/);
    expect(complete).not.toHaveBeenCalled();
    expect(metrics).toContain("WfRoomTurnThrow{Reason=not_chair}");
  });

  it("throws (W-4) and counts WfRoomPersonaMissing when the persona row lacks a prompt", async () => {
    AGENTS.maya = { ...AGENTS.maya, system_prompt: "" };
    try {
      await expect(handler(EVENT)).rejects.toThrow(/lacks model\/system_prompt/);
      expect(metrics).toContain("WfRoomPersonaMissing{Slug=maya}");
    } finally {
      AGENTS.maya = { ...AGENTS.maya, system_prompt: "You are Maya, the PM." };
    }
  });
});

describe("a failed turn still passes the baton (W-4: throw, metric, room continues)", () => {
  it("statement throws → rethrows, records last_error on the run, hands off", async () => {
    complete.mockResolvedValueOnce(completion("As an AI language model, I cannot take a position."));

    await expect(handler(EVENT)).rejects.toThrow(/llm_artefact_in_head/);

    expect(putItem).not.toHaveBeenCalled();
    expect(handoff()).toMatchObject({ speaker: "dario" });
    const patch = metaUpdates()[0]!;
    expect(patch.ConditionExpression).toBe("attribute_exists(#pk) AND #run_id = :if_run_id");
    expect(patch.ExpressionAttributeValues).toMatchObject({ ":if_run_id": RUN });
    expect(String((patch.ExpressionAttributeValues as Record<string, string>)[":last_error"])).toMatch(
      /^maya · statement · round 1: room-debate: llm_artefact_in_head/,
    );
    expect(metrics).toContain("WfRoomTurnThrow{Reason=llm_artefact}");
  });

  it("a failing last_error write never masks the original throw", async () => {
    complete.mockRejectedValueOnce(new Error("anthropic stop_reason=max_tokens (truncated)."));
    ddbSend.mockRejectedValueOnce(new Error("ddb down"));
    await expect(handler(EVENT)).rejects.toThrow(/max_tokens/);
    expect(lambdaSend).toHaveBeenCalledTimes(1);
  });

  it("a hand-off failure throws, is counted, and lands on META last_error (retries are off: the room stalls visibly)", async () => {
    complete.mockResolvedValueOnce(completion("POSITION: Ship.\nYes."));
    lambdaSend.mockRejectedValueOnce(new Error("throttled"));
    await expect(handler(EVENT)).rejects.toThrow(/throttled/);
    expect(metrics).toContain("WfRoomHandoffFailed");
    // [0] is the turn's own META bump; [1] is the stalled-run marker.
    const patch = metaUpdates()[1]!;
    expect(patch.ExpressionAttributeValues).toMatchObject({ ":if_run_id": RUN });
    expect(String((patch.ExpressionAttributeValues as Record<string, string>)[":last_error"])).toMatch(/hand-off failed: throttled/);
  });
});

describe("W-1 guards", () => {
  it("propagates the truncation throw from complete()", async () => {
    complete.mockRejectedValueOnce(new Error("anthropic stop_reason=max_tokens (truncated)."));
    await expect(handler({ ...EVENT, then: [] })).rejects.toThrow(/max_tokens/);
    expect(putItem).not.toHaveBeenCalled();
    expect(metrics).toContain("WfRoomTurnThrow{Reason=max_tokens}");
  });

  it("throws on an empty body (a lone POSITION line is not a turn)", async () => {
    complete.mockResolvedValueOnce(completion("POSITION: Ship it."));
    await expect(handler({ ...EVENT, then: [] })).rejects.toThrow(/empty turn body/);
    expect(putItem).not.toHaveBeenCalled();
  });

  it("checks the artefact head of the POSITION line as well as the body", async () => {
    complete.mockResolvedValueOnce(completion("POSITION: Sure! Here's my view.\nWe ship."));
    await expect(handler({ ...EVENT, then: [] })).rejects.toThrow(/llm_artefact_in_head/);
  });

  it("throws if the model emits the no-reply token — every member speaks in a room", async () => {
    complete.mockResolvedValueOnce(completion("__NO_REPLY_NEEDED__"));
    await expect(handler({ ...EVENT, then: [] })).rejects.toThrow(/no-reply token/);
  });
});

describe("conclusion (chair)", () => {
  const CONCLUDE: RoomDebateEvent = { room_id: ROOM, run_id: RUN, speaker: "dario", round: 2, kind: "conclusion", then: [] };

  it("writes the conclusion, flips META to concluded with conclusion_turn_id/preview, hands off to no one", async () => {
    const text = "## Conclusion\nShip behind a flag.\n\n## Where we agree\n- The console is ready.";
    complete.mockResolvedValueOnce(completion(text));

    const res = await handler(CONCLUDE);

    expect(res.status).toBe("ok");
    const row = putItem.mock.calls[0]![0];
    expect(row).toMatchObject({ kind: "conclusion", round: 2, from: "dario", body_preview: text });
    expect(row.position).toBeUndefined();
    const patch = metaUpdates()[0]!;
    expect(patch.ConditionExpression).toBe("attribute_exists(#pk) AND #run_id = :if_run_id");
    expect(patch.ExpressionAttributeValues).toMatchObject({
      ":status": "concluded",
      ":conclusion_turn_id": row.turn_id,
      ":conclusion_preview": text,
    });
    expect(complete.mock.calls[0]![0].maxTokens).toBe(3200);
    expect(complete.mock.calls[0]![0].reasoningBudgetTokens).toBe(2048);
    expect(complete.mock.calls[0]![0].system).toContain("約1,500字");
    expect(complete.mock.calls[0]![0].system).toContain("## 結論");
    expect(complete.mock.calls[0]![0].system).toContain("The debate rounds are over");
    expect(lambdaSend).not.toHaveBeenCalled();
    expect(metrics).toContain("WfRoomConcluded");
  });

  it("a steer newer than the chair's transcript snapshot: last_error says to reopen (W-4) + WfRoomSteerDuringConclusion", async () => {
    complete.mockResolvedValueOnce(completion("## Conclusion\nShip."));
    // The chair read [opening]; the steer landed during its call.
    listRoomTurnRows.mockResolvedValueOnce([
      { turn_id: "01J00000000000000000000010", run_id: RUN, round: 0, kind: "opening", from: "operator" },
      { turn_id: "01J00000000000000000000099", run_id: RUN, round: 0, kind: "steer", from: "operator" },
    ]);
    await handler(CONCLUDE);
    // [0] is the conclusion's META flip; [1] the notice, guarded on the run.
    const patch = metaUpdates()[1]!;
    expect(patch.ExpressionAttributeValues).toMatchObject({ ":if_run_id": RUN });
    expect(String((patch.ExpressionAttributeValues as Record<string, string>)[":last_error"])).toMatch(
      /steer arrived while the chair was writing the conclusion.*reopen/,
    );
    expect(metrics).toContain("WfRoomSteerDuringConclusion");
  });

  it("no notice when every steer of the run was in the snapshot (or belongs to another run)", async () => {
    listRoomTurns.mockResolvedValueOnce([turn({}), turn({ turn_id: "01J00000000000000000000011", kind: "steer", body: "Cost?" })]);
    listRoomTurnRows.mockResolvedValueOnce([
      { turn_id: "01J00000000000000000000010", run_id: RUN, round: 0, kind: "opening", from: "operator" },
      { turn_id: "01J00000000000000000000011", run_id: RUN, round: 0, kind: "steer", from: "operator" },
      { turn_id: "01J00000000000000000000099", run_id: "01J0000000000000000000NEWR", round: 0, kind: "steer", from: "operator" },
    ]);
    complete.mockResolvedValueOnce(completion("## Conclusion\nShip."));
    await handler(CONCLUDE);
    expect(metaUpdates()).toHaveLength(1);
    expect(metrics).not.toContain("WfRoomSteerDuringConclusion");
  });

  it("drops a stray POSITION line from a conclusion", async () => {
    complete.mockResolvedValueOnce(completion("POSITION: Ship.\n## Conclusion\nShip."));
    await handler(CONCLUDE);
    expect(putItem.mock.calls[0]![0]).toMatchObject({ body_preview: "## Conclusion\nShip." });
    expect(putItem.mock.calls[0]![0].position).toBeUndefined();
  });

  it("a conclusion that loses the race to a reopen keeps the turn but does not flip status", async () => {
    complete.mockResolvedValueOnce(completion("## Conclusion\nShip."));
    ddbSend
      .mockRejectedValueOnce(Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" }))
      .mockResolvedValueOnce({ Attributes: META });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await handler(CONCLUDE);
    expect(res.status).toBe("ok");
    expect(metaUpdates()[1]!.ExpressionAttributeValues).not.toHaveProperty(":status");
    expect(metrics).not.toContain("WfRoomConcluded");
    expect(warn.mock.calls.some((c) => String(c[0]).includes("room_conclusion_superseded"))).toBe(true);
  });
});

describe("language + round lines", () => {
  it("a Japanese question: the turn is told to write Japanese and keep the POSITION label", async () => {
    META.question = "今週Roomsを出すべきか？";
    complete.mockResolvedValueOnce(completion("POSITION: 出すべき。\nマヤとして賛成です。"));
    await handler({ ...EVENT, then: [] });
    const system = complete.mock.calls[0]![0].system as string;
    expect(system).toContain("write this turn in Japanese (keep the `POSITION:` label as is)");
    expect(system).toContain("Keep the label `POSITION:` in");
  });

  it("an English question is told English; the last debate round is told to converge", async () => {
    complete.mockResolvedValueOnce(completion("POSITION: Ship.\nYes."));
    await handler({ ...EVENT, then: [] }); // rounds 1 → round 1 is the last
    const system = complete.mock.calls[0]![0].system as string;
    expect(system).toContain("write this turn in English");
    expect(system).toContain("last round before the chair concludes");
  });

  it("not the last round: no converge line", async () => {
    Object.assign(META, { rounds: 2, run_rounds: 2 });
    complete.mockResolvedValueOnce(completion("POSITION: Ship.\nYes."));
    await handler({ ...EVENT, then: [] });
    expect(complete.mock.calls[0]![0].system).not.toContain("last round before the chair concludes");
  });

  it("a Japanese conclusion is told the Japanese heading set, in order", async () => {
    META.question = "今週Roomsを出すべきか？";
    complete.mockResolvedValueOnce(completion("## 結論\n出す。"));
    await handler({ room_id: ROOM, run_id: RUN, speaker: "dario", round: 2, kind: "conclusion", then: [] });
    const system = complete.mock.calls[0]![0].system as string;
    expect(system).toContain("write the conclusion in Japanese, under the Japanese headings");
    expect(system).toContain("Start with the first heading.");
  });
});

describe("reopened run", () => {
  // The backend's real numbering for a 2 × 2 room: statements 1, 2 →
  // conclusion 3 → the reopen speaks at stored round 4 (maxAgentRound + 1).
  const RUN2 = "01J0000000000000000000RUN2";
  const history = () => [
    turn({}),
    turn({ turn_id: "01J00000000000000000000011", from: "maya", round: 1, kind: "statement", body: "R1 maya." }),
    turn({ turn_id: "01J00000000000000000000012", from: "dario", round: 1, kind: "statement", body: "R1 dario." }),
    turn({ turn_id: "01J00000000000000000000013", from: "maya", round: 2, kind: "statement", body: "R2 maya." }),
    turn({ turn_id: "01J00000000000000000000014", from: "dario", round: 2, kind: "statement", body: "R2 dario." }),
    turn({ turn_id: "01J00000000000000000000015", from: "dario", round: 3, kind: "conclusion", body: "## Conclusion\nShip." }),
    turn({ turn_id: "01J00000000000000000000016", from: "operator", round: 0, kind: "steer", run_id: RUN2, body: "And cost?" }),
  ];

  it("labels the stored round by its debate ordinal: stored round 4 is round 3 of 3", async () => {
    Object.assign(META, { rounds: 2, run_id: RUN2, run_start_round: 4, run_rounds: 1, run_count: 2 });
    listRoomTurns.mockResolvedValueOnce(history());
    complete.mockResolvedValueOnce(completion("POSITION: Cost changes nothing.\nStill ship."));
    await handler({ ...EVENT, run_id: RUN2, round: 4, then: [] });
    const call = complete.mock.calls[0]![0];
    expect(call.system).toContain("This is round 3 of 3.");
    expect(call.system).not.toContain("round 4");
    expect(call.system).toContain("reopened the room with a follow-up");
    expect(call.system).toContain("last round before the chair concludes");
    // Transcript tags are ordinals too; the conclusion keeps its own tag.
    expect(call.user).toContain("[Round 2] dario: R2 dario.");
    expect(call.user).toContain("[Conclusion] dario: ## Conclusion");
    expect(call.user).not.toContain("[Round 3]");
    // The row keeps the absolute round.
    expect(putItem.mock.calls[0]![0]).toMatchObject({ round: 4, run_id: RUN2 });
  });
});

describe("transcript window (bounded prompt across reopens)", () => {
  it("keeps the opening, the latest conclusion and the last 30 turns, eliding the rest with a count", async () => {
    const id = (n: number) => `01J000000000000000000${String(n).padStart(5, "0")}`;
    const turns = [turn({ turn_id: id(0) })];
    for (let i = 1; i <= 10; i++) turns.push(turn({ turn_id: id(i), from: "dario", round: i, kind: "statement", body: `early ${i}` }));
    turns.push(turn({ turn_id: id(11), from: "dario", round: 11, kind: "conclusion", body: "## Conclusion\nLatest answer." }));
    for (let i = 12; i <= 50; i++) turns.push(turn({ turn_id: id(i), from: "dario", round: 12, kind: "statement", body: `late ${i}` }));
    listRoomTurns.mockResolvedValueOnce(turns);
    complete.mockResolvedValueOnce(completion("POSITION: Ship.\nYes."));

    await handler({ ...EVENT, then: [] });

    const user = complete.mock.calls[0]![0].user as string;
    expect(user).toContain("Operator (opening the room with the question)");
    expect(user).toContain("…(10 earlier turns omitted)");
    expect(user).toContain("Latest answer.");
    // 39 late turns → the first 9 fall before the 30-turn tail.
    expect(user).toContain("…(9 earlier turns omitted)");
    expect(user).not.toContain("early 10");
    expect(user).not.toMatch(/late 20$/m);
    expect(user).toContain("late 21");
    expect(user).toContain("late 50");
    expect(user.match(/\[Round \d+\] dario: late/g)).toHaveLength(30);
  });

  it("a short room is sent whole (no elision line)", async () => {
    complete.mockResolvedValueOnce(completion("POSITION: Ship.\nYes."));
    await handler({ ...EVENT, then: [] });
    expect(complete.mock.calls[0]![0].user).not.toContain("omitted");
  });
});
