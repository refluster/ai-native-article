// Unit tests for shared/room.ts (Rooms v1, workforce/adr-0048 proposed) —
// the pure helpers (the bounded schedule, create validation, POSITION
// parsing, row → view) and the store's query / write shapes over a mocked
// DDB + S3: the GSI3 `ROOMS` listing, the preview / body_ref split, the
// conditional META patch and the conclusion's run guard. The routes and the
// Lambda exercise the same module end to end in their own tests.

import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
const getItem = vi.fn();
const putItem = vi.fn();
const queryByGsiPaged = vi.fn();
vi.mock("./ddb.js", () => ({
  ddb: { send: (...args: unknown[]) => send(...args) },
  getItem: (...args: unknown[]) => getItem(...args),
  putItem: (...args: unknown[]) => putItem(...args),
  queryByGsiPaged: (...args: unknown[]) => queryByGsiPaged(...args),
}));
vi.mock("./task.js", () => {
  let n = 0;
  return { newUlid: () => `01ROOMTEST${String(++n).padStart(16, "0")}` };
});
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  QueryCommand: class {
    kind = "query";
    constructor(public input: Record<string, unknown>) {}
  },
  UpdateCommand: class {
    kind = "update";
    constructor(public input: Record<string, unknown>) {}
  },
}));
const s3Send = vi.fn();
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send(cmd: unknown) {
      return s3Send(cmd);
    }
  },
  GetObjectCommand: class {
    kind = "get";
    constructor(public input: { Key: string }) {}
  },
  PutObjectCommand: class {
    kind = "put";
    constructor(public input: { Key: string; Body: string }) {}
  },
}));

import {
  ROOM_TURN_HARD_MAX_CHARS,
  ROOM_TURN_PREVIEW_MAX_CHARS,
  appendTurn,
  buildSchedule,
  countAgentTurnsSince,
  createRoom,
  listRoomTurns,
  listRooms,
  maxDebateRound,
  parsePosition,
  toDispatch,
  toRoomSummaryView,
  toRoomView,
  updateRoomMeta,
  validateRoomCreate,
  validateTurnBody,
  type RoomMetaRow,
} from "./room.js";

const ROOM = "01HROOM0000000000000000000";

function meta(over: Partial<RoomMetaRow> = {}): RoomMetaRow {
  return {
    pk: `ROOM#${ROOM}`,
    sk: "META",
    room_id: ROOM,
    title: "Ship Rooms?",
    question: "Should we ship Rooms this week?",
    status: "debating",
    participants: ["maya", "dario", "ren"],
    chair: "dario",
    rounds: 2,
    run_id: "01HRUN00000000000000000000",
    run_count: 1,
    created_by: "operator",
    created_at: "2026-10-24T00:00:00.000Z",
    updated_at: "2026-10-24T00:00:00.000Z",
    last_turn_at: "2026-10-24T00:00:00.000Z",
    turn_count: 1,
    gsi3pk: "ROOMS",
    gsi3sk: "2026-10-24T00:00:00.000Z",
    ...over,
  };
}

type Cmd = { kind: string; input: Record<string, unknown> };
const calls = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.map((c) => c[0] as Cmd);

beforeEach(() => {
  process.env.BUCKET_NAME = "wf-bucket-test";
  process.env.TABLE_NAME = "wf-table-test";
  send.mockReset();
  send.mockImplementation(async (cmd: Cmd) => (cmd.kind === "update" ? { Attributes: meta() } : { Items: [] }));
  getItem.mockReset();
  getItem.mockResolvedValue(meta());
  putItem.mockReset();
  putItem.mockResolvedValue(undefined);
  queryByGsiPaged.mockReset();
  queryByGsiPaged.mockResolvedValue({ items: [], cursor: undefined });
  s3Send.mockReset();
  s3Send.mockResolvedValue({});
});

describe("buildSchedule", () => {
  it("lists rounds × participants statements in order, then the chair's conclusion", () => {
    expect(buildSchedule(["maya", "dario", "ren"], 2, "dario")).toEqual([
      { speaker: "maya", round: 1, kind: "statement" },
      { speaker: "dario", round: 1, kind: "statement" },
      { speaker: "ren", round: 1, kind: "statement" },
      { speaker: "maya", round: 2, kind: "statement" },
      { speaker: "dario", round: 2, kind: "statement" },
      { speaker: "ren", round: 2, kind: "statement" },
      { speaker: "dario", round: 3, kind: "conclusion" },
    ]);
  });

  it("is bounded: participants × rounds + 1 for every legal size", () => {
    for (let p = 2; p <= 6; p++) {
      for (let r = 1; r <= 3; r++) {
        const slugs = Array.from({ length: p }, (_, i) => `a${i}`);
        expect(buildSchedule(slugs, r, "a0")).toHaveLength(p * r + 1);
      }
    }
  });

  it("a reopen starts at the next round with one round each + a fresh conclusion", () => {
    expect(buildSchedule(["maya", "ren"], 1, "ren", 3)).toEqual([
      { speaker: "maya", round: 3, kind: "statement" },
      { speaker: "ren", round: 3, kind: "statement" },
      { speaker: "ren", round: 4, kind: "conclusion" },
    ]);
  });

  it("rounds = 0 is the conclusion alone (POST /conclude)", () => {
    expect(buildSchedule(["maya", "ren"], 0, "maya", 2)).toEqual([{ speaker: "maya", round: 2, kind: "conclusion" }]);
  });

  it("toDispatch puts the head in the event and the tail in `then`", () => {
    const d = toDispatch(ROOM, "01RUN", buildSchedule(["maya", "ren"], 1, "ren"));
    expect(d).toEqual({
      room_id: ROOM,
      run_id: "01RUN",
      speaker: "maya",
      round: 1,
      kind: "statement",
      then: [
        { speaker: "ren", round: 1, kind: "statement" },
        { speaker: "ren", round: 2, kind: "conclusion" },
      ],
    });
  });

  it("maxDebateRound counts statements only", () => {
    expect(maxDebateRound([])).toBe(0);
    expect(
      maxDebateRound([
        { kind: "opening", round: 0 },
        { kind: "statement", round: 2 },
        { kind: "conclusion", round: 3 },
        { kind: "steer", round: 0 },
      ]),
    ).toBe(2);
  });
});

describe("validateRoomCreate", () => {
  const ok = { title: "Ship?", question: "Should we ship?", participants: ["maya", "ren"] };

  it("defaults chair to the first participant and rounds to 2; trims and dedupes", () => {
    const v = validateRoomCreate({ ...ok, title: "  Ship   it? ", participants: [" Maya", "ren", "maya"], context: "   " });
    expect(v).toEqual({
      ok: true,
      value: { title: "Ship it?", question: "Should we ship?", participants: ["maya", "ren"], chair: "maya", rounds: 2 },
    });
  });

  it("bounds participants to 2..6 after dedupe and refuses the operator / non-slugs", () => {
    expect(validateRoomCreate({ ...ok, participants: ["maya", "maya"] })).toMatchObject({ ok: false, error: "invalid_participants" });
    expect(validateRoomCreate({ ...ok, participants: ["a", "b", "c", "d", "e", "f", "g"] })).toMatchObject({
      ok: false,
      error: "invalid_participants",
    });
    expect(validateRoomCreate({ ...ok, participants: ["a", "b", "c", "d", "e", "f"] }).ok).toBe(true);
    expect(validateRoomCreate({ ...ok, participants: ["maya", "operator"] })).toMatchObject({ error: "invalid_participants" });
    expect(validateRoomCreate({ ...ok, participants: ["maya", "Not A Slug"] })).toMatchObject({ error: "invalid_participants" });
    expect(validateRoomCreate({ ...ok, participants: "maya,ren" })).toMatchObject({ error: "invalid_participants" });
  });

  it("requires the chair to be a participant", () => {
    expect(validateRoomCreate({ ...ok, chair: "dario" })).toMatchObject({ ok: false, error: "invalid_chair" });
    expect(validateRoomCreate({ ...ok, chair: "REN" })).toMatchObject({ ok: true, value: { chair: "ren" } });
  });

  it("bounds rounds to integers 1..3", () => {
    for (const rounds of [0, 4, 1.5, "2"]) {
      expect(validateRoomCreate({ ...ok, rounds })).toMatchObject({ ok: false, error: "invalid_rounds" });
    }
    expect(validateRoomCreate({ ...ok, rounds: 3 })).toMatchObject({ ok: true, value: { rounds: 3 } });
  });

  it("caps title (120), question (2000) and context (4000)", () => {
    expect(validateRoomCreate({ ...ok, title: "" })).toMatchObject({ error: "invalid_title" });
    expect(validateRoomCreate({ ...ok, title: "t".repeat(121) })).toMatchObject({ error: "invalid_title" });
    expect(validateRoomCreate({ ...ok, title: "t".repeat(120) }).ok).toBe(true);
    expect(validateRoomCreate({ ...ok, question: " " })).toMatchObject({ error: "invalid_question" });
    expect(validateRoomCreate({ ...ok, question: "q".repeat(2001) })).toMatchObject({ error: "invalid_question" });
    expect(validateRoomCreate({ ...ok, context: "c".repeat(4001) })).toMatchObject({ error: "invalid_context" });
    expect(validateRoomCreate({ ...ok, context: 42 })).toMatchObject({ error: "invalid_context" });
    expect(validateRoomCreate({ ...ok, context: " bg " })).toMatchObject({ ok: true, value: { context: "bg" } });
  });

  it("validateTurnBody trims and caps at the hard max", () => {
    expect(validateTurnBody("  hi  ")).toBe("hi");
    expect(() => validateTurnBody("   ")).toThrow(/empty_body/);
    expect(() => validateTurnBody(42)).toThrow(/invalid_body/);
    expect(() => validateTurnBody("x".repeat(ROOM_TURN_HARD_MAX_CHARS + 1))).toThrow(/over_hard_cap/);
  });
});

describe("parsePosition", () => {
  it("splits the first POSITION line from the prose", () => {
    expect(parsePosition("POSITION: Ship it behind a flag.\n\nThe risk is small.")).toEqual({
      position: "Ship it behind a flag.",
      body: "The risk is small.",
    });
  });

  it("tolerates bold markers and a full-width colon", () => {
    expect(parsePosition("**POSITION:** 今週出すべき。\n理由は三つ。")).toEqual({ position: "今週出すべき。", body: "理由は三つ。" });
    expect(parsePosition("POSITION：見送る\n本文")).toEqual({ position: "見送る", body: "本文" });
  });

  it("caps the position at 140 chars", () => {
    const p = parsePosition(`POSITION: ${"x".repeat(200)}\nbody`);
    expect(p.position).toHaveLength(140);
  });

  it("is fail-soft: no POSITION line leaves the whole text as body", () => {
    expect(parsePosition("  I think we should wait.\nMore.  ")).toEqual({ body: "I think we should wait.\nMore." });
    // Only the FIRST line counts.
    expect(parsePosition("Intro.\nPOSITION: late")).toEqual({ body: "Intro.\nPOSITION: late" });
  });

  it("a lone POSITION line yields an empty body (the Lambda's W-1 guard throws on it)", () => {
    expect(parsePosition("POSITION: only this")).toEqual({ position: "only this", body: "" });
  });
});

describe("views", () => {
  it("summary carries the list fields only; the view adds run + context + error", () => {
    const m = meta({ context: "bg", last_error: "boom", conclusion_preview: "We ship.", conclusion_turn_id: "01C", run_start_round: 1, run_rounds: 2 });
    const s = toRoomSummaryView(m);
    expect(s).toEqual({
      room_id: ROOM,
      title: "Ship Rooms?",
      question: "Should we ship Rooms this week?",
      status: "debating",
      participants: ["maya", "dario", "ren"],
      chair: "dario",
      rounds: 2,
      run_count: 1,
      created_at: "2026-10-24T00:00:00.000Z",
      last_turn_at: "2026-10-24T00:00:00.000Z",
      turn_count: 1,
      conclusion_preview: "We ship.",
    });
    expect(toRoomView(m)).toEqual({
      ...s,
      context: "bg",
      run_id: "01HRUN00000000000000000000",
      run_start_round: 1,
      run_rounds: 2,
      conclusion_turn_id: "01C",
      last_error: "boom",
    });
  });
});

describe("listRooms", () => {
  it("is one GSI3 query on the ROOMS partition, newest first — never a Scan", async () => {
    queryByGsiPaged.mockResolvedValueOnce({ items: [meta()], cursor: "next" });
    const page = await listRooms({ pageSize: 10, cursor: "abc" });
    expect(queryByGsiPaged).toHaveBeenCalledWith("GSI3", "ROOMS", { scanIndexForward: false, limit: 10, cursor: "abc" });
    expect(page.cursor).toBe("next");
  });

  it("defaults to 25 and caps at 100", async () => {
    await listRooms();
    await listRooms({ pageSize: 500 });
    expect(queryByGsiPaged.mock.calls[0]![2]).toMatchObject({ limit: 25 });
    expect(queryByGsiPaged.mock.calls[1]![2]).toMatchObject({ limit: 100 });
  });
});

describe("turn reads", () => {
  it("drains every page in ascending order and hydrates long bodies from S3", async () => {
    send
      .mockResolvedValueOnce({
        Items: [{ turn_id: "01A", room_id: ROOM, run_id: "r", round: 0, kind: "opening", from: "operator", at: "t1", body_preview: "q" }],
        LastEvaluatedKey: { pk: `ROOM#${ROOM}`, sk: "TURN#01A" },
      })
      .mockResolvedValueOnce({
        Items: [
          {
            turn_id: "01B", room_id: ROOM, run_id: "r", round: 1, kind: "statement", from: "maya", at: "t2",
            position: "Ship.", body_preview: "long…", body_ref: `rooms/${ROOM}/01B.md`,
          },
        ],
      });
    s3Send.mockResolvedValueOnce({ Body: { transformToString: async () => "the long body" } });

    const turns = await listRoomTurns(ROOM);

    expect(turns.map((t) => t.turn_id)).toEqual(["01A", "01B"]);
    expect(turns[1]).toMatchObject({ body: "the long body", position: "Ship.", kind: "statement" });
    const q = calls(send);
    expect(q).toHaveLength(2);
    expect(q[0]!.input).toMatchObject({ ScanIndexForward: true, ConsistentRead: true });
    expect(q[1]!.input.ExclusiveStartKey).toEqual({ pk: `ROOM#${ROOM}`, sk: "TURN#01A" });
    expect((calls(s3Send)[0]!.input as { Key: string }).Key).toBe(`rooms/${ROOM}/01B.md`);
  });

  it("countAgentTurnsSince counts non-operator rows from the ULID lower bound", async () => {
    send.mockResolvedValueOnce({ Items: [{ from: "operator" }, { from: "maya" }, { from: "ren" }] });
    expect(await countAgentTurnsSince(ROOM, Date.parse("2026-10-24T00:00:00Z"))).toBe(2);
    const q = calls(send)[0]!.input;
    expect(q.KeyConditionExpression).toBe("#pk = :pk AND #sk >= :lo");
    expect(q.ProjectionExpression).toBe("#from");
    expect(String((q.ExpressionAttributeValues as Record<string, string>)[":lo"])).toMatch(/^TURN#[0-9A-Z]{10}0{16}$/);
  });
});

describe("createRoom", () => {
  it("writes META (debating, run 1, GSI3) then the operator's opening turn", async () => {
    const out = await createRoom({
      title: "Ship?",
      question: "Should we ship?",
      participants: ["maya", "ren"],
      chair: "ren",
      rounds: 2,
      now: () => new Date("2026-10-24T01:00:00Z"),
    });
    expect(putItem).toHaveBeenCalledTimes(2);
    const [m, t] = putItem.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(m).toMatchObject({
      sk: "META",
      status: "debating",
      run_count: 1,
      run_start_round: 1,
      run_rounds: 2,
      turn_count: 1,
      created_by: "operator",
      gsi3pk: "ROOMS",
      gsi3sk: "2026-10-24T01:00:00.000Z",
    });
    expect(t).toMatchObject({ kind: "opening", round: 0, from: "operator", run_id: m!.run_id, body_preview: "Should we ship?" });
    expect(t!.body_ref).toBeUndefined();
    expect(out.schedule).toHaveLength(5);
    expect(out.opening.body).toBe("Should we ship?");
  });
});

describe("appendTurn", () => {
  const base = { room_id: ROOM, run_id: "01HRUN00000000000000000000", round: 1, kind: "statement" as const, from: "maya" };

  it("keeps a short body inline (no S3) and bumps turn_count atomically", async () => {
    const out = await appendTurn({ ...base, body: "Short.", position: "Ship." });
    expect(s3Send).not.toHaveBeenCalled();
    expect(putItem.mock.calls[0]![0]).toMatchObject({ body_preview: "Short.", position: "Ship.", kind: "statement" });
    expect(putItem.mock.calls[0]![0].body_ref).toBeUndefined();
    const u = calls(send)[0]!.input;
    expect(u.UpdateExpression).toMatch(/^SET .*#last_turn_at = :last_turn_at.* ADD #turn_count :inc_turn_count$/);
    expect(u.ConditionExpression).toBe("attribute_exists(#pk)");
    expect(out.view.body).toBe("Short.");
  });

  it("splits a long body: preview of 320 inline, full text to rooms/{room}/{ulid}.md", async () => {
    const body = "y".repeat(ROOM_TURN_PREVIEW_MAX_CHARS + 50);
    const out = await appendTurn({ ...base, body });
    const put = calls(s3Send)[0]!.input as { Key: string; Body: string };
    expect(put.Key).toBe(`rooms/${ROOM}/${out.row.turn_id}.md`);
    expect(put.Body).toBe(body);
    expect(out.row.body_ref).toBe(put.Key);
    expect(out.row.body_preview).toHaveLength(ROOM_TURN_PREVIEW_MAX_CHARS);
    expect(out.view.body).toBe(body);
  });

  it("throws (never a dangling turn) when META is missing", async () => {
    getItem.mockResolvedValueOnce(undefined);
    await expect(appendTurn({ ...base, body: "x" })).rejects.toThrow(/no room META/);
    expect(putItem).not.toHaveBeenCalled();
  });

  it("a conclusion flips META to concluded, guarded on the turn's run", async () => {
    const out = await appendTurn({ ...base, kind: "conclusion", round: 3, from: "dario", body: "## Conclusion\nShip." });
    const u = calls(send)[0]!.input;
    expect(u.ConditionExpression).toBe("attribute_exists(#pk) AND #run_id = :if_run_id");
    expect(u.ExpressionAttributeValues).toMatchObject({
      ":status": "concluded",
      ":conclusion_turn_id": out.row.turn_id,
      ":conclusion_preview": "## Conclusion\nShip.",
      ":if_run_id": base.run_id,
    });
    expect(out.superseded).toBeUndefined();
  });

  it("a conclusion whose run was superseded keeps the turn but does not touch status", async () => {
    const fail = Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" });
    send.mockRejectedValueOnce(fail).mockResolvedValueOnce({ Attributes: meta() });
    const out = await appendTurn({ ...base, kind: "conclusion", round: 3, from: "dario", body: "Done." });
    expect(out.superseded).toBe(true);
    const retry = calls(send)[1]!.input;
    expect(retry.ExpressionAttributeValues).not.toHaveProperty(":status");
    expect(retry.ConditionExpression).toBe("attribute_exists(#pk)");
  });
});

describe("updateRoomMeta", () => {
  it("builds SET / ADD / REMOVE with an existence (and optional run) condition", async () => {
    await updateRoomMeta(ROOM, { status: "debating", run_id: "01N" }, { increment: { run_count: 1 }, remove: ["last_error"], ifRunId: "01O" });
    const u = calls(send)[0]!.input;
    expect(u.Key).toEqual({ pk: `ROOM#${ROOM}`, sk: "META" });
    expect(u.UpdateExpression).toBe(
      "SET #updated_at = :updated_at, #status = :status, #run_id = :run_id ADD #run_count :inc_run_count REMOVE #last_error",
    );
    expect(u.ConditionExpression).toBe("attribute_exists(#pk) AND #run_id = :if_run_id");
    expect(u.ReturnValues).toBe("ALL_NEW");
  });
});
