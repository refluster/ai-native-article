// agents-api — Room routes (Rooms v1, workforce/adr-0048 proposed).
//
//   GET   /rooms                  newest-first list (GSI3 ROOMS)            (public read)
//   GET   /rooms/{id}             room + every turn | ?after= poll tail      (public read)
//   POST  /rooms                  create; dispatches the first turn          (AWS_IAM at GW)
//   POST  /rooms/{id}/turns       operator steer; reopens a concluded room;  (AWS_IAM at GW)
//                                 409 room_concluding once only the chair is left
//   POST  /rooms/{id}/conclude    re-dispatch only the chair's conclusion    (AWS_IAM at GW)
//   PATCH /rooms/{id}             {archived?, title?}                        (AWS_IAM at GW)
//
// Kept in its own module (the boards.ts pattern) so the route logic is
// testable without the handler's mock surface: the handler passes the two
// things this module cannot own — the async Lambda invoke and the IAM check.
//
// Auth model. Same posture as /threads: reads are public on the CORS gate,
// writes carry the AWS_IAM authorizer at API Gateway (the console signs them
// with SigV4). Every write re-checks the IAM principal here as defence in
// depth, like the boards moderation PATCH.
//
// Dispatch. A write lands first, then the run's head turn is async-invoked
// on wf-room-debate with the rest of the schedule in `then` (the ADR-0047
// hand-off; the Lambda passes the baton itself). A dispatch failure never
// fails the request — the room already exists. It is logged
// (`room_dispatch_failed`) and written to META `last_error`, so the console
// shows it and offers "Conclude now" (W-4: visible, never silent).

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

import { type AgentMetaRow, agentPk } from "../shared/agent.js";
import { getItem } from "../shared/ddb.js";
import { newUlid } from "../shared/task.js";
import {
  ROOMS_PAGE_DEFAULT,
  ROOMS_GSI3_PK,
  ROOMS_PAGE_MAX,
  ROOM_OPERATOR_ID,
  appendTurn,
  buildSchedule,
  createRoom,
  getRoomMeta,
  isValidRoomId,
  isValidTurnId,
  listRoomTurnRows,
  listRoomTurns,
  listRoomTurnsAfter,
  listRooms,
  maxAgentRound,
  toDispatch,
  toRoomSummaryView,
  toRoomView,
  updateRoomMeta,
  validateRoomCreate,
  validateRoomTitle,
  validateTurnBody,
  type RoomMetaRow,
  type RoomScheduleStep,
  type RoomTurnDispatch,
  type RoomTurnRow,
} from "../shared/room.js";

export type { RoomTurnDispatch } from "../shared/room.js";

/** Cap on the `last_error` string written to META (it renders as a banner). */
const LAST_ERROR_MAX_CHARS = 300;

export interface RoomsDeps {
  /** Async-invoke wf-room-debate. Throws on failure; this module catches,
   *  logs and records `last_error` — the write already landed. */
  dispatchTurn(payload: RoomTurnDispatch): Promise<void>;
  isIamAuthenticated(event: APIGatewayProxyEventV2): boolean;
}

const ROOM_ROUTES = new Set([
  "GET /rooms",
  "GET /rooms/{id}",
  "POST /rooms",
  "POST /rooms/{id}/turns",
  "POST /rooms/{id}/conclude",
  "PATCH /rooms/{id}",
]);

function reply(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  };
}

function parseJsonBody(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function parsePageSize(qs: Record<string, string | undefined>): number {
  const n = Number.parseInt(qs.page_size ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return ROOMS_PAGE_DEFAULT;
  return Math.min(n, ROOMS_PAGE_MAX);
}

/** A `GET /rooms` cursor is the base64url JSON of a GSI3 `ROOMS` key (the
 *  queryByGsiPaged encoding). Check it here so a garbled or foreign cursor
 *  is a 400 — never a DynamoDB ValidationException surfacing as a 500. */
function isRoomsCursor(raw: string): boolean {
  try {
    const key: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof key !== "object" || key === null || Array.isArray(key)) return false;
    const values = Object.values(key as Record<string, unknown>);
    return (key as Record<string, unknown>).gsi3pk === ROOMS_GSI3_PK && values.every((v) => typeof v === "string");
  } catch {
    return false;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Hand a run to wf-room-debate. Never throws: on failure the room records
 * the error on META (best-effort itself — a failed patch is logged, the
 * request still succeeds). Returns whether the dispatch went out.
 */
async function dispatchRun(
  deps: RoomsDeps,
  roomId: string,
  runId: string,
  schedule: readonly RoomScheduleStep[],
): Promise<boolean> {
  const payload = toDispatch(roomId, runId, schedule);
  try {
    await deps.dispatchTurn(payload);
    return true;
  } catch (err) {
    const error = errorMessage(err);
    console.error(
      JSON.stringify({
        event: "room_dispatch_failed",
        room_id: roomId,
        run_id: runId,
        speaker: payload.speaker,
        round: payload.round,
        kind: payload.kind,
        error,
      }),
    );
    try {
      await updateRoomMeta(
        roomId,
        { last_error: `dispatch failed: ${error}`.slice(0, LAST_ERROR_MAX_CHARS) },
        { ifRunId: runId },
      );
    } catch (patchErr) {
      console.error(
        JSON.stringify({ event: "room_last_error_write_failed", room_id: roomId, error: errorMessage(patchErr) }),
      );
    }
    return false;
  }
}

// --- Reads -------------------------------------------------------------

async function listRoomsRoute(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const qs = event.queryStringParameters ?? {};
  if (qs.cursor !== undefined && !isRoomsCursor(qs.cursor)) return reply(400, { error: "invalid_cursor" });
  const page = await listRooms({ pageSize: parsePageSize(qs), cursor: qs.cursor });
  return reply(200, {
    rooms: page.items.map(toRoomSummaryView),
    ...(page.cursor !== undefined ? { cursor: page.cursor } : {}),
  });
}

async function getRoomRoute(meta: RoomMetaRow, event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const after = event.queryStringParameters?.after;
  if (after !== undefined) {
    if (!isValidTurnId(after)) return reply(400, { error: "invalid_after" });
    const turns = await listRoomTurnsAfter(meta.room_id, after);
    return reply(200, { room: toRoomView(meta), turns });
  }
  return reply(200, { room: toRoomView(meta), turns: await listRoomTurns(meta.room_id) });
}

// --- Writes ------------------------------------------------------------

/** Every participant must be a live (existing, non-archived) agent. One
 *  GetItem per slug — a room has at most six. */
async function unknownParticipants(slugs: readonly string[]): Promise<string[]> {
  const rows = await Promise.all(slugs.map((s) => getItem<AgentMetaRow>(agentPk(s), "META")));
  return slugs.filter((_, i) => !rows[i] || rows[i]!.archived);
}

async function createRoomRoute(event: APIGatewayProxyEventV2, deps: RoomsDeps): Promise<APIGatewayProxyResultV2> {
  const body = parseJsonBody(event.body);
  if (!body) return reply(400, { error: "invalid_json" });
  const v = validateRoomCreate(body);
  if (!v.ok) return reply(400, { error: v.error, ...(v.detail ? { detail: v.detail } : {}) });
  const unknown = await unknownParticipants(v.value.participants);
  if (unknown.length > 0) {
    return reply(400, { error: "invalid_participants", detail: `unknown or archived agents: ${unknown.join(", ")}` });
  }

  const created = await createRoom(v.value);
  await dispatchRun(deps, created.meta.room_id, created.meta.run_id, created.schedule);
  return reply(201, { room_id: created.meta.room_id });
}

/**
 * True when no statement of the current run is left to start: every
 * participant has a statement for every debate round of the run, or the
 * run is conclusion-only (`run_rounds === 0`, "Conclude now"). Only the
 * chair is left then, and it reads its transcript once, up front — a steer
 * stored now would never be read.
 */
function onlyConclusionLeft(meta: RoomMetaRow, rows: readonly RoomTurnRow[]): boolean {
  const start = meta.run_start_round ?? 1;
  const rounds = meta.run_rounds ?? meta.rounds;
  if (rounds === 0) return true;
  const said = new Set(
    rows.filter((t) => t.kind === "statement" && t.run_id === meta.run_id).map((t) => `${t.round}#${t.from}`),
  );
  for (let r = start; r < start + rounds; r++) {
    if (meta.participants.some((p) => !said.has(`${r}#${p}`))) return false;
  }
  return true;
}

/**
 * Operator steer. While debating it is just a turn in the transcript — the
 * speakers still to come read it (no dispatch, the run is already moving).
 * Once only the chair's conclusion is left there is nobody to read it, so
 * it is refused (`409 room_concluding`, nothing stored): reopen with it once
 * the conclusion lands.
 * On a concluded room it REOPENS: a new run of one more round each, from
 * the round after every earlier agent turn (the old conclusion included),
 * plus a fresh conclusion.
 */
async function steerRoute(
  meta: RoomMetaRow,
  event: APIGatewayProxyEventV2,
  deps: RoomsDeps,
): Promise<APIGatewayProxyResultV2> {
  const body = parseJsonBody(event.body);
  if (!body) return reply(400, { error: "invalid_json" });
  let text: string;
  try {
    text = validateTurnBody(body.body);
  } catch (err) {
    return reply(400, { error: "invalid_body", detail: errorMessage(err) });
  }

  if (meta.status !== "concluded") {
    if (onlyConclusionLeft(meta, await listRoomTurnRows(meta.room_id))) {
      return reply(409, {
        error: "room_concluding",
        detail: "the chair is writing the conclusion — reopen with this follow-up once it lands",
      });
    }
    const out = await appendTurn({
      room_id: meta.room_id,
      run_id: meta.run_id,
      round: 0,
      kind: "steer",
      from: ROOM_OPERATOR_ID,
      body: text,
    });
    // The chair's `concluded` flip (or a newer run) can land between the META
    // read above and this write — a window of milliseconds that opens only
    // after a statement of the run failed, so `onlyConclusionLeft` never
    // turned true (cycle-2 review, wf:hana H3). appendTurn returns META after
    // the bump, so the steer that lost that race is visible here: flag it on
    // the room (W-4) rather than hand back a 201 nobody will act on. The
    // other ordering — bump first, flip second — is caught by the Lambda's
    // flagSteerDuringConclusion, which lists turns after the flip.
    if (out.meta.status === "concluded" || out.meta.run_id !== meta.run_id) {
      await updateRoomMeta(meta.room_id, {
        last_error: "a steer landed after the conclusion — reopen with a follow-up to address it",
      });
      return reply(201, { turn_id: out.view.turn_id, reopened: false, landed_after_conclusion: true });
    }
    return reply(201, { turn_id: out.view.turn_id, reopened: false });
  }

  const startRound = maxAgentRound(await listRoomTurnRows(meta.room_id)) + 1;
  const runId = newUlid();
  const out = await appendTurn({
    room_id: meta.room_id,
    run_id: runId,
    round: 0,
    kind: "steer",
    from: ROOM_OPERATOR_ID,
    body: text,
  });
  await updateRoomMeta(
    meta.room_id,
    { status: "debating", run_id: runId, run_start_round: startRound, run_rounds: 1 },
    { increment: { run_count: 1 }, remove: ["last_error"] },
  );
  await dispatchRun(deps, meta.room_id, runId, buildSchedule(meta.participants, 1, meta.chair, startRound));
  return reply(201, { turn_id: out.view.turn_id, reopened: true });
}

/**
 * Re-dispatch ONLY the chair's conclusion under a new run — after a failed
 * conclusion, to cut a debate short, or (operator explicit) to rewrite an
 * existing one. The new run supersedes any turns still in flight. Status is
 * `debating` until the conclusion lands, so the console keeps polling.
 */
async function concludeRoute(meta: RoomMetaRow, deps: RoomsDeps): Promise<APIGatewayProxyResultV2> {
  const round = maxAgentRound(await listRoomTurnRows(meta.room_id)) + 1;
  const runId = newUlid();
  await updateRoomMeta(
    meta.room_id,
    { status: "debating", run_id: runId, run_start_round: round, run_rounds: 0 },
    { increment: { run_count: 1 }, remove: ["last_error"] },
  );
  await dispatchRun(deps, meta.room_id, runId, buildSchedule(meta.participants, 0, meta.chair, round));
  return reply(202, { run_id: runId });
}

async function patchRoomRoute(meta: RoomMetaRow, event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body = parseJsonBody(event.body);
  if (!body) return reply(400, { error: "invalid_json" });
  const set: Record<string, unknown> = {};
  if (body.archived !== undefined) {
    if (typeof body.archived !== "boolean") return reply(400, { error: "invalid_archived" });
    set.archived = body.archived;
  }
  if (body.title !== undefined) {
    const t = validateRoomTitle(body.title);
    if (!t.ok) return reply(400, { error: t.error, ...(t.detail ? { detail: t.detail } : {}) });
    set.title = t.value;
  }
  if (Object.keys(set).length === 0) return reply(400, { error: "invalid_patch", detail: "nothing to patch (archived, title)" });
  const row = await updateRoomMeta(meta.room_id, set);
  return reply(200, { room: toRoomView(row) });
}

/**
 * Dispatch a room route. Returns undefined when `routeKey` is not a room
 * route so the handler's own 404 fall-through applies.
 */
export async function handleRoomsRoute(
  routeKey: string,
  event: APIGatewayProxyEventV2,
  deps: RoomsDeps,
): Promise<APIGatewayProxyResultV2 | undefined> {
  if (!ROOM_ROUTES.has(routeKey)) return undefined;
  const isWrite = !routeKey.startsWith("GET ");
  // Defence in depth behind the API GW AWS_IAM authorizer.
  if (isWrite && !deps.isIamAuthenticated(event)) return reply(403, { error: "forbidden" });

  if (routeKey === "GET /rooms") return listRoomsRoute(event);
  if (routeKey === "POST /rooms") return createRoomRoute(event, deps);

  const roomId = event.pathParameters?.id ?? "";
  if (!isValidRoomId(roomId)) return reply(400, { error: "invalid_room_id" });
  const meta = await getRoomMeta(roomId);
  if (!meta) return reply(404, { error: "not_found", room_id: roomId });

  if (routeKey === "GET /rooms/{id}") return getRoomRoute(meta, event);
  if (routeKey === "PATCH /rooms/{id}") return patchRoomRoute(meta, event);
  if (meta.archived) return reply(409, { error: "room_archived", room_id: roomId });
  if (routeKey === "POST /rooms/{id}/turns") return steerRoute(meta, event, deps);
  if (routeKey === "POST /rooms/{id}/conclude") return concludeRoute(meta, deps);
  return undefined;
}
