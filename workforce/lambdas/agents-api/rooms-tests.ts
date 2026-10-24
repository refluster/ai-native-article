// Unit tests for agents-api/rooms.ts (Rooms v1, workforce/adr-0048 proposed)
// — the six routes end to end through the REAL shared/room.ts (validation,
// schedule, row shapes, conditional META patches) over an in-memory fake of
// the single table + S3. Pins: create → META + opening turn + the first
// dispatch payload carrying the full schedule; validation 400s; a steer
// while debating is a transcript turn with no dispatch; a steer on a
// concluded room reopens (new run, run_count + 1, one more round from the
// next round, fresh conclusion) and dispatches; conclude re-dispatches only
// the chair's conclusion; `?after` returns only newer turns; PATCH; the IAM
// gate on every write; and that a failed dispatch never fails the request.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

// --- In-memory single table ---------------------------------------------

type Item = Record<string, unknown> & { pk: string; sk: string };
const table = new Map<string, Item>();
const key = (pk: string, sk: string) => `${pk}\u0000${sk}`;

function conditionalFailure(): Error {
  return Object.assign(new Error("The conditional request failed"), { name: "ConditionalCheckFailedException" });
}

/** Evaluate the Query / Update shapes shared/room.ts emits. */
async function fakeSend(cmd: { kind: string; input: Record<string, unknown> }): Promise<unknown> {
  const input = cmd.input;
  const values = (input.ExpressionAttributeValues ?? {}) as Record<string, unknown>;
  const names = (input.ExpressionAttributeNames ?? {}) as Record<string, string>;
  if (cmd.kind === "query") {
    const kce = String(input.KeyConditionExpression);
    const pk = values[":pk"];
    let items = [...table.values()].filter((i) => i.pk === pk);
    if (kce.includes("begins_with")) items = items.filter((i) => i.sk.startsWith(String(values[":skp"])));
    else if (kce.includes("#sk > :after")) items = items.filter((i) => i.sk > String(values[":after"]));
    else if (kce.includes("#sk >= :lo")) items = items.filter((i) => i.sk >= String(values[":lo"]));
    items.sort((a, b) => (a.sk < b.sk ? -1 : 1));
    if (input.ScanIndexForward === false) items.reverse();
    return { Items: items.map((i) => ({ ...i })) };
  }
  if (cmd.kind === "update") {
    const k = input.Key as { pk: string; sk: string };
    const existing = table.get(key(k.pk, k.sk));
    const cond = String(input.ConditionExpression ?? "");
    if (cond.includes("attribute_exists") && !existing) throw conditionalFailure();
    if (cond.includes(":if_run_id") && existing?.run_id !== values[":if_run_id"]) throw conditionalFailure();
    const next: Item = { ...(existing ?? { pk: k.pk, sk: k.sk }) };
    const expr = String(input.UpdateExpression);
    for (const clause of expr.split(/ (?=ADD |REMOVE )/)) {
      const [verb, ...rest] = clause.split(" ");
      const body = rest.join(" ");
      for (const part of body.split(", ")) {
        if (verb === "SET") {
          const [n, v] = part.split(" = ");
          next[names[n!]!] = values[v!];
        } else if (verb === "ADD") {
          const [n, v] = part.split(" ");
          next[names[n!]!] = Number(next[names[n!]!] ?? 0) + Number(values[v!]);
        } else if (verb === "REMOVE") {
          delete next[names[part]!];
        }
      }
    }
    table.set(key(k.pk, k.sk), next);
    return { Attributes: { ...next } };
  }
  throw new Error(`fakeSend: unexpected command ${cmd.kind}`);
}

vi.mock("../shared/ddb.js", () => ({
  ddb: { send: (cmd: { kind: string; input: Record<string, unknown> }) => fakeSend(cmd) },
  getItem: async (pk: string, sk: string) => {
    const i = table.get(key(pk, sk));
    return i ? { ...i } : undefined;
  },
  putItem: async (item: Item) => {
    table.set(key(item.pk, item.sk), { ...item });
  },
  queryByGsiPaged: async (_index: string, pk: string, q: { scanIndexForward?: boolean; limit?: number }) => {
    const items = [...table.values()]
      .filter((i) => i.gsi3pk === pk)
      .sort((a, b) => (String(a.gsi3sk) < String(b.gsi3sk) ? -1 : 1));
    if (q.scanIndexForward === false) items.reverse();
    return { items: items.slice(0, q.limit ?? 100), cursor: undefined };
  },
}));
vi.mock("../shared/task.js", () => {
  let n = 0;
  // Valid Crockford ULIDs (digits + J), strictly increasing — time order.
  return { newUlid: () => `01J${String(++n).padStart(23, "0")}` };
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
const objects = new Map<string, string>();
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    async send(cmd: { kind: string; input: { Key: string; Body?: string } }) {
      if (cmd.kind === "put") {
        objects.set(cmd.input.Key, String(cmd.input.Body));
        return {};
      }
      const body = objects.get(cmd.input.Key);
      return body === undefined ? {} : { Body: { transformToString: async () => body } };
    }
  },
  GetObjectCommand: class {
    kind = "get";
    constructor(public input: unknown) {}
  },
  PutObjectCommand: class {
    kind = "put";
    constructor(public input: unknown) {}
  },
}));

import { handleRoomsRoute, type RoomsDeps } from "./rooms.js";
import type { RoomTurnDispatch } from "../shared/room.js";

// --- Fixtures -----------------------------------------------------------

const AGENTS = [
  { slug: "maya", first_name: "Maya", last_name: "Ishikawa", role: "PM", archived: false },
  { slug: "dario", first_name: "Dario", last_name: "Bianchi", role: "Governance", archived: false },
  { slug: "ren", first_name: "Ren", last_name: "Tanaka", role: "Engineer", archived: false },
  { slug: "old", first_name: "Old", last_name: "Timer", role: "Retired", archived: true },
];

function event(
  routeKey: string,
  opts: { id?: string; body?: unknown; qs?: Record<string, string>; iam?: boolean } = {},
): APIGatewayProxyEventV2 {
  const [method] = routeKey.split(" ");
  return {
    version: "2.0",
    routeKey,
    rawPath: "",
    rawQueryString: "",
    headers: {},
    queryStringParameters: opts.qs,
    pathParameters: opts.id ? { id: opts.id } : undefined,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    isBase64Encoded: false,
    requestContext: {
      http: { method, path: "", protocol: "HTTP/1.1", sourceIp: "", userAgent: "" },
      ...(opts.iam === false ? {} : { authorizer: { iam: { userArn: "arn:aws:iam::1:user/op" } } }),
    } as unknown as APIGatewayProxyEventV2["requestContext"],
  } as APIGatewayProxyEventV2;
}

function parse(res: unknown): { statusCode: number; body: Record<string, unknown> } {
  const r = res as { statusCode: number; body: string };
  return { statusCode: r.statusCode, body: JSON.parse(r.body) as Record<string, unknown> };
}

const dispatchTurn = vi.fn();
const deps: RoomsDeps = {
  dispatchTurn: (p) => dispatchTurn(p),
  isIamAuthenticated: (e) => Boolean((e.requestContext as unknown as { authorizer?: { iam?: unknown } }).authorizer?.iam),
};

async function call(routeKey: string, opts: Parameters<typeof event>[1] = {}) {
  return parse(await handleRoomsRoute(routeKey, event(routeKey, opts), deps));
}

function meta(roomId: string): Item {
  return table.get(key(`ROOM#${roomId}`, "META"))!;
}

function turnRows(roomId: string): Item[] {
  return [...table.values()].filter((i) => i.pk === `ROOM#${roomId}` && i.sk.startsWith("TURN#")).sort((a, b) => (a.sk < b.sk ? -1 : 1));
}

const CREATE = {
  title: "Ship Rooms this week?",
  question: "Should we ship Rooms this week, or hold for the docs?",
  participants: ["maya", "dario", "ren"],
  chair: "dario",
  rounds: 2,
};

async function createRoom(body: Record<string, unknown> = CREATE): Promise<string> {
  const r = await call("POST /rooms", { body });
  expect(r.statusCode).toBe(201);
  return r.body.room_id as string;
}

/** Simulate the Lambda: write an agent turn straight into the table. */
function agentTurn(roomId: string, turnId: string, over: Partial<Item>): void {
  const m = meta(roomId);
  table.set(key(`ROOM#${roomId}`, `TURN#${turnId}`), {
    pk: `ROOM#${roomId}`,
    sk: `TURN#${turnId}`,
    turn_id: turnId,
    room_id: roomId,
    run_id: m.run_id,
    round: 1,
    kind: "statement",
    from: "maya",
    at: "2026-10-24T00:00:05.000Z",
    body_preview: "A statement.",
    ...over,
  });
}

beforeEach(() => {
  process.env.BUCKET_NAME = "wf-bucket-test";
  process.env.TABLE_NAME = "wf-table-test";
  table.clear();
  objects.clear();
  for (const a of AGENTS) table.set(key(`AGENT#${a.slug}`, "META"), { pk: `AGENT#${a.slug}`, sk: "META", ...a });
  dispatchTurn.mockReset();
  dispatchTurn.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Tests --------------------------------------------------------------

describe("routing", () => {
  it("returns undefined for non-room routes", async () => {
    expect(await handleRoomsRoute("GET /threads", event("GET /threads"), deps)).toBeUndefined();
    expect(await handleRoomsRoute("GET /roomsx", event("GET /roomsx"), deps)).toBeUndefined();
  });

  it("403s every write without an IAM principal (defence in depth)", async () => {
    const id = await createRoom();
    for (const route of ["POST /rooms", "POST /rooms/{id}/turns", "POST /rooms/{id}/conclude", "PATCH /rooms/{id}"]) {
      const r = await call(route, { id, body: { body: "x", archived: true }, iam: false });
      expect(r).toMatchObject({ statusCode: 403, body: { error: "forbidden" } });
    }
  });

  it("reads are public; a malformed id 400s, an unknown room 404s", async () => {
    await createRoom();
    expect((await call("GET /rooms", { iam: false })).statusCode).toBe(200);
    expect((await call("GET /rooms/{id}", { id: "not-a-ulid", iam: false })).statusCode).toBe(400);
    expect((await call("GET /rooms/{id}", { id: "01J99999999999999999999999", iam: false })).statusCode).toBe(404);
  });
});

describe("POST /rooms", () => {
  it("writes META + the opening turn and dispatches the first turn with the full schedule", async () => {
    const id = await createRoom();

    const m = meta(id);
    expect(m).toMatchObject({
      room_id: id,
      title: "Ship Rooms this week?",
      status: "debating",
      participants: ["maya", "dario", "ren"],
      chair: "dario",
      rounds: 2,
      run_count: 1,
      turn_count: 1,
      created_by: "operator",
      gsi3pk: "ROOMS",
    });
    const turns = turnRows(id);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ kind: "opening", round: 0, from: "operator", run_id: m.run_id, body_preview: CREATE.question });

    expect(dispatchTurn).toHaveBeenCalledTimes(1);
    const payload = dispatchTurn.mock.calls[0]![0] as RoomTurnDispatch;
    expect(payload).toEqual({
      room_id: id,
      run_id: m.run_id,
      speaker: "maya",
      round: 1,
      kind: "statement",
      then: [
        { speaker: "dario", round: 1, kind: "statement" },
        { speaker: "ren", round: 1, kind: "statement" },
        { speaker: "maya", round: 2, kind: "statement" },
        { speaker: "dario", round: 2, kind: "statement" },
        { speaker: "ren", round: 2, kind: "statement" },
        { speaker: "dario", round: 3, kind: "conclusion" },
      ],
    });
  });

  it("defaults chair to the first participant and rounds to 2", async () => {
    const id = await createRoom({ title: "t", question: "q?", participants: ["ren", "maya"] });
    expect(meta(id)).toMatchObject({ chair: "ren", rounds: 2 });
    const payload = dispatchTurn.mock.calls[0]![0] as RoomTurnDispatch;
    expect(payload.then.at(-1)).toEqual({ speaker: "ren", round: 3, kind: "conclusion" });
    expect(payload.then).toHaveLength(4);
  });

  it("400s validation failures with the invalid_* code and writes nothing", async () => {
    const cases: Array<[Record<string, unknown> | string, string]> = [
      ["not json", "invalid_json"],
      [{ ...CREATE, title: "" }, "invalid_title"],
      [{ ...CREATE, question: "" }, "invalid_question"],
      [{ ...CREATE, question: "q".repeat(2001) }, "invalid_question"],
      [{ ...CREATE, context: "c".repeat(4001) }, "invalid_context"],
      [{ ...CREATE, participants: ["maya"] }, "invalid_participants"],
      [{ ...CREATE, participants: ["a", "b", "c", "d", "e", "f", "g"] }, "invalid_participants"],
      [{ ...CREATE, chair: "sora" }, "invalid_chair"],
      [{ ...CREATE, rounds: 4 }, "invalid_rounds"],
      [{ ...CREATE, participants: ["maya", "ghost"], chair: "maya" }, "invalid_participants"],
      [{ ...CREATE, participants: ["maya", "old"], chair: "maya" }, "invalid_participants"],
    ];
    for (const [body, error] of cases) {
      const e = event("POST /rooms", {});
      e.body = typeof body === "string" ? body : JSON.stringify(body);
      const r = parse(await handleRoomsRoute("POST /rooms", e, deps));
      expect(r, JSON.stringify(body).slice(0, 80)).toMatchObject({ statusCode: 400, body: { error } });
    }
    expect([...table.keys()].some((k) => k.startsWith("ROOM#"))).toBe(false);
    expect(dispatchTurn).not.toHaveBeenCalled();
  });

  it("keeps the room when dispatch fails and records last_error (W-4 visible)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    dispatchTurn.mockRejectedValueOnce(new Error("lambda throttled"));
    const id = await createRoom();
    expect(meta(id).last_error).toBe("dispatch failed: lambda throttled");
    expect(String(err.mock.calls[0]![0])).toContain("room_dispatch_failed");
    const g = await call("GET /rooms/{id}", { id });
    expect((g.body.room as { last_error: string }).last_error).toMatch(/lambda throttled/);
  });
});

describe("GET /rooms and GET /rooms/{id}", () => {
  it("lists summaries newest first", async () => {
    const a = await createRoom({ ...CREATE, title: "first" });
    table.get(key(`ROOM#${a}`, "META"))!.gsi3sk = "2026-10-01T00:00:00.000Z";
    const b = await createRoom({ ...CREATE, title: "second" });
    const r = await call("GET /rooms");
    const rooms = r.body.rooms as Array<{ room_id: string; title: string; run_id?: string }>;
    expect(rooms.map((x) => x.room_id)).toEqual([b, a]);
    // Summary shape: no run internals.
    expect(rooms[0]!.run_id).toBeUndefined();
    expect(rooms[0]).toMatchObject({ title: "second", status: "debating", turn_count: 1, rounds: 2 });
  });

  it("400s a cursor that is not a ROOMS key (never a DynamoDB 500), accepts one that is", async () => {
    const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    for (const cursor of ["not-base64-json", enc(123), enc(["x"]), enc({ pk: "AGENT#maya", sk: "META", gsi3pk: "FEED" })]) {
      const r = await call("GET /rooms", { qs: { cursor } });
      expect(r.statusCode).toBe(400);
      expect(r.body.error).toBe("invalid_cursor");
    }
    const ok = enc({ pk: "ROOM#01J0", sk: "META", gsi3pk: "ROOMS", gsi3sk: "2026-10-24T00:00:00.000Z" });
    expect((await call("GET /rooms", { qs: { cursor: ok } })).statusCode).toBe(200);
  });

  it("returns the room view + every turn chronologically, S3-hydrating long bodies", async () => {
    const id = await createRoom({ ...CREATE, question: `Q: ${"long ".repeat(100)}` });
    agentTurn(id, "01J90000000000000000000001", { position: "Hold.", body_preview: "short" });
    const r = await call("GET /rooms/{id}", { id });
    expect(r.statusCode).toBe(200);
    const room = r.body.room as Record<string, unknown>;
    expect(room).toMatchObject({ room_id: id, run_id: meta(id).run_id, status: "debating", chair: "dario" });
    const turns = r.body.turns as Array<Record<string, unknown>>;
    expect(turns.map((t) => t.kind)).toEqual(["opening", "statement"]);
    expect(turns[0]!.body).toBe(`Q: ${"long ".repeat(100)}`.trim());
    expect(Object.keys(turns[1]!).sort()).toEqual(["at", "body", "from", "kind", "position", "room_id", "round", "run_id", "turn_id"]);
  });

  it("?after returns only newer turns (and still the room)", async () => {
    const id = await createRoom();
    const opening = turnRows(id)[0]!.turn_id as string;
    agentTurn(id, "01J90000000000000000000001", { from: "maya" });
    agentTurn(id, "01J90000000000000000000002", { from: "dario" });
    const r = await call("GET /rooms/{id}", { id, qs: { after: "01J90000000000000000000001" } });
    expect((r.body.turns as Array<{ turn_id: string }>).map((t) => t.turn_id)).toEqual(["01J90000000000000000000002"]);
    expect(r.body.room).toBeDefined();
    const all = await call("GET /rooms/{id}", { id, qs: { after: opening } });
    expect((all.body.turns as unknown[]).length).toBe(2);
    expect((await call("GET /rooms/{id}", { id, qs: { after: "garbage" } })).statusCode).toBe(400);
  });
});

describe("POST /rooms/{id}/turns (steer)", () => {
  it("while debating: stores a round-0 steer on the current run and does NOT dispatch", async () => {
    const id = await createRoom();
    dispatchTurn.mockClear();
    const r = await call("POST /rooms/{id}/turns", { id, body: { body: "Focus on the docs risk." } });
    expect(r).toMatchObject({ statusCode: 201, body: { reopened: false } });
    const steer = turnRows(id).at(-1)!;
    expect(steer).toMatchObject({ kind: "steer", round: 0, from: "operator", run_id: meta(id).run_id, turn_id: r.body.turn_id });
    expect(meta(id).turn_count).toBe(2);
    expect(dispatchTurn).not.toHaveBeenCalled();
  });

  it("on a concluded room: reopens — new run, run_count + 1, one round from the next round, fresh conclusion", async () => {
    const id = await createRoom({ ...CREATE, rounds: 1 });
    const firstRun = meta(id).run_id;
    agentTurn(id, "01J90000000000000000000001", { from: "maya", round: 1 });
    agentTurn(id, "01J90000000000000000000002", { from: "dario", round: 1 });
    agentTurn(id, "01J90000000000000000000003", { from: "ren", round: 1 });
    agentTurn(id, "01J90000000000000000000004", { from: "dario", round: 2, kind: "conclusion" });
    Object.assign(table.get(key(`ROOM#${id}`, "META"))!, { status: "concluded", conclusion_turn_id: "01J90000000000000000000004", last_error: "old" });
    dispatchTurn.mockClear();

    const r = await call("POST /rooms/{id}/turns", { id, body: { body: "What about cost?" } });

    expect(r).toMatchObject({ statusCode: 201, body: { reopened: true } });
    const m = meta(id);
    expect(m.run_id).not.toBe(firstRun);
    // The old conclusion sat at round 2, so the reopened round is 3 (never a
    // reused round number).
    expect(m).toMatchObject({ status: "debating", run_count: 2, run_start_round: 3, run_rounds: 1 });
    expect(m.last_error).toBeUndefined();
    const steer = turnRows(id).find((t) => t.turn_id === r.body.turn_id)!;
    expect(steer).toMatchObject({ kind: "steer", round: 0, run_id: m.run_id });
    expect(dispatchTurn).toHaveBeenCalledTimes(1);
    expect(dispatchTurn.mock.calls[0]![0]).toEqual({
      room_id: id,
      run_id: m.run_id,
      speaker: "maya",
      round: 3,
      kind: "statement",
      then: [
        { speaker: "dario", round: 3, kind: "statement" },
        { speaker: "ren", round: 3, kind: "statement" },
        { speaker: "dario", round: 4, kind: "conclusion" },
      ],
    });
  });

  it("a 3 × 2 room: conclusion round 3 → reopen statements round 4 + conclusion 5 → conclude-now round 6", async () => {
    const id = await createRoom(); // 3 participants × 2 rounds, chair dario
    let n = 0;
    const tid = () => `01J9${String(++n).padStart(22, "0")}`;
    for (const round of [1, 2]) for (const from of ["maya", "dario", "ren"]) agentTurn(id, tid(), { from, round });
    agentTurn(id, tid(), { from: "dario", round: 3, kind: "conclusion" });
    table.get(key(`ROOM#${id}`, "META"))!.status = "concluded";
    dispatchTurn.mockClear();

    await call("POST /rooms/{id}/turns", { id, body: { body: "And the cost?" } });
    const reopen = dispatchTurn.mock.calls[0]![0] as RoomTurnDispatch;
    expect(meta(id)).toMatchObject({ run_start_round: 4, run_rounds: 1 });
    expect([reopen, ...reopen.then].map((s) => `${s.kind}:${s.round}`)).toEqual([
      "statement:4", "statement:4", "statement:4", "conclusion:5",
    ]);

    // The reopened run lands, including its conclusion at round 5.
    for (const from of ["maya", "dario", "ren"]) agentTurn(id, tid(), { from, round: 4 });
    agentTurn(id, tid(), { from: "dario", round: 5, kind: "conclusion" });
    dispatchTurn.mockClear();

    await call("POST /rooms/{id}/conclude", { id });
    expect(dispatchTurn.mock.calls[0]![0]).toMatchObject({ speaker: "dario", round: 6, kind: "conclusion", then: [] });
    expect(meta(id)).toMatchObject({ run_start_round: 6, run_rounds: 0, run_count: 3 });
  });

  it("400s an empty / over-cap body, 409s an archived room", async () => {
    const id = await createRoom();
    expect(await call("POST /rooms/{id}/turns", { id, body: { body: "  " } })).toMatchObject({ statusCode: 400, body: { error: "invalid_body" } });
    expect((await call("POST /rooms/{id}/turns", { id, body: { body: "x".repeat(6001) } })).statusCode).toBe(400);
    table.get(key(`ROOM#${id}`, "META"))!.archived = true;
    expect(await call("POST /rooms/{id}/turns", { id, body: { body: "hi" } })).toMatchObject({ statusCode: 409, body: { error: "room_archived" } });
  });
});

describe("POST /rooms/{id}/conclude", () => {
  it("re-dispatches ONLY the chair's conclusion under a new run, after the last debate round", async () => {
    const id = await createRoom();
    const firstRun = meta(id).run_id;
    agentTurn(id, "01J90000000000000000000001", { from: "maya", round: 1 });
    dispatchTurn.mockClear();

    const r = await call("POST /rooms/{id}/conclude", { id });

    expect(r.statusCode).toBe(202);
    const m = meta(id);
    expect(r.body).toEqual({ run_id: m.run_id });
    expect(m.run_id).not.toBe(firstRun);
    expect(m).toMatchObject({ status: "debating", run_count: 2, run_start_round: 2, run_rounds: 0 });
    expect(dispatchTurn.mock.calls[0]![0]).toEqual({ room_id: id, run_id: m.run_id, speaker: "dario", round: 2, kind: "conclusion", then: [] });
  });

  it("is allowed on a concluded room (operator explicit) and 409s when archived", async () => {
    const id = await createRoom();
    table.get(key(`ROOM#${id}`, "META"))!.status = "concluded";
    expect((await call("POST /rooms/{id}/conclude", { id })).statusCode).toBe(202);
    table.get(key(`ROOM#${id}`, "META"))!.archived = true;
    expect(await call("POST /rooms/{id}/conclude", { id })).toMatchObject({ statusCode: 409, body: { error: "room_archived" } });
  });
});

describe("PATCH /rooms/{id}", () => {
  it("archives and renames, returning the room view", async () => {
    const id = await createRoom();
    const r = await call("PATCH /rooms/{id}", { id, body: { archived: true, title: "  Renamed " } });
    expect(r.statusCode).toBe(200);
    expect(r.body.room).toMatchObject({ room_id: id, archived: true, title: "Renamed" });
    expect(meta(id)).toMatchObject({ archived: true, title: "Renamed" });
    // An archived room can still be read and un-archived.
    expect((await call("GET /rooms/{id}", { id })).statusCode).toBe(200);
    expect((await call("PATCH /rooms/{id}", { id, body: { archived: false } })).body.room).toMatchObject({ archived: false });
  });

  it("400s a bad or empty patch", async () => {
    const id = await createRoom();
    expect(await call("PATCH /rooms/{id}", { id, body: { archived: "yes" } })).toMatchObject({ statusCode: 400, body: { error: "invalid_archived" } });
    expect(await call("PATCH /rooms/{id}", { id, body: { title: "" } })).toMatchObject({ statusCode: 400, body: { error: "invalid_title" } });
    expect(await call("PATCH /rooms/{id}", { id, body: {} })).toMatchObject({ statusCode: 400, body: { error: "invalid_patch" } });
  });
});
