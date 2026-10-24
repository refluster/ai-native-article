// workforce/lambdas/shared/room.ts
//
// ROOM row family + helpers (Rooms v1 — workforce/adr-0048, proposed). A
// Room is the purpose-first twin of a thread: it is created FOR a question
// (議題 / 論点), the operator summons 2–6 agents into it, they deliberate in
// a bounded number of rounds, and a chair writes the conclusion. A thread
// (shared/messaging.ts, ADR-0006/0047) is participant-first; a Room has a
// lifecycle (`debating → concluded`), a conclusion artefact, and ends by
// construction.
//
// Mirrors the posture of shared/messaging.ts and shared/board.ts: the
// runtime *shape* lives here so the wf-rooms-api routes (operator writes) and
// the wf-room-debate Lambda (agent turns) share one trust domain and one
// row shape. An agent turn is written via `appendTurn`, never through the
// HTTP route, so a turn can never re-enter the dispatch path (loop safety by
// construction, same argument as ADR-0006).
//
// Row family (catalogued in workforce/docs/data-model.md, Zone A PR):
//   ROOM#{room_id} / META          — room descriptor + current run
//   ROOM#{room_id} / TURN#{ulid}   — one turn (operator or agent)
//   ROOM#{room_id} / CLAIM#{run_id}#{round}#{kind}#{speaker}
//                                  — wf-room-debate's turn-slot claim: a
//                                    conditional put taken before the
//                                    Claude call, so one scheduled turn is
//                                    spoken once even when AWS delivers its
//                                    event twice and both copies overlap
//
// Listing is one GSI3 partition (`gsi3pk="ROOMS"`, `gsi3sk=created_at`),
// the same single-partition precedent as the activity FEED (shared/post.ts
// listFeed). Rooms are operator-created, so the partition stays cool.
//
// The schedule. A run is fixed when the room starts (or is reopened):
// `buildSchedule` lists every (speaker, round, kind) in order and the API
// hands it to the Lambda as `then`, which only ever shrinks (the ADR-0047
// hand-off). A run is therefore at most `participants × rounds + 1` Claude
// calls. Every run carries a fresh `run_id`; the Lambda drops a turn whose
// `run_id` is no longer META's (a reopen / re-conclude superseded it).
//
// CLAUDE.md / W-4 (fail-loud): a row whose `body_ref` does not resolve in
// S3 throws rather than returning a silent partial.

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { ulidLowerBound } from "./board.js";
import { conditionalPutItem, ddb, getItem, putItem, queryByGsiPaged, type PagedResult } from "./ddb.js";
import { newUlid } from "./task.js";

const s3 = new S3Client({});

// Read lazily (not at module load) so a test can set them per case and a
// missing value fails at the call that needs it, with a precise message.
function bucketName(): string {
  const b = process.env.BUCKET_NAME;
  if (!b) throw new Error("BUCKET_NAME env var is required for room turn bodies");
  return b;
}
function tableName(): string {
  return process.env.TABLE_NAME ?? "";
}

// --- Caps + constants ----------------------------------------------------

/** Hard cap on an operator turn body (the opening question, a steer) —
 *  what `POST /rooms/{id}/turns` accepts and the console composer allows. */
export const ROOM_TURN_HARD_MAX_CHARS = 6000;

/** Sanity cap on an AGENT turn body (statement / conclusion). It must sit
 *  above anything a complete reply can be: `complete()` throws on
 *  `max_tokens`, so a reply that reaches here is at most the wire cap — a
 *  conclusion's 3200 visible + 2048 reasoning-headroom tokens = 5248 —
 *  i.e. ≈ 22–24k chars of English prose (≈ 4.5 chars/token; Japanese is
 *  ~1–1.5 chars/token, far below). At 6000 an over-long but complete
 *  English conclusion was rejected after the call was paid for, leaving
 *  the room without one. The length itself is the prompt's job (~900
 *  words); this only refuses a runaway. */
export const ROOM_AGENT_TURN_MAX_CHARS = 24000;

/** Inline preview cap — a body at or under this is fully contained in
 *  `body_preview` and needs no S3 round-trip (same split as MSG / POST rows). */
export const ROOM_TURN_PREVIEW_MAX_CHARS = 320;

export const ROOM_MIN_PARTICIPANTS = 2;
export const ROOM_MAX_PARTICIPANTS = 6;
export const ROOM_MIN_ROUNDS = 1;
export const ROOM_MAX_ROUNDS = 3;
export const ROOM_DEFAULT_ROUNDS = 2;
export const ROOM_QUESTION_MAX_CHARS = 2000;
export const ROOM_CONTEXT_MAX_CHARS = 4000;
export const ROOM_TITLE_MAX_CHARS = 120;
/** Cap on the one-line stance parsed from a statement's `POSITION:` line. */
export const ROOM_POSITION_MAX_CHARS = 140;

/** The human operator's pseudo-slug. Mirrors MESSAGING_OPERATOR_ID so
 *  `from` lines up across the two surfaces and the SPA. */
export const ROOM_OPERATOR_ID = "operator";

/** GSI3 partition holding every room (newest first on created_at). */
export const ROOMS_GSI3_PK = "ROOMS";

/** Default / max page size of `GET /rooms`. */
export const ROOMS_PAGE_DEFAULT = 25;
export const ROOMS_PAGE_MAX = 100;

/** Agent slug shape (lowercase kebab). Same alphabet the roster uses. */
const SLUG_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;
/** Room / turn / run ids are ULIDs (Crockford base32, 26 chars). */
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

// --- Row types -----------------------------------------------------------

export type RoomStatus = "debating" | "concluded";
export type RoomTurnKind = "opening" | "statement" | "steer" | "conclusion";
/** The two kinds an agent speaks (the Lambda's dispatch kinds). */
export type RoomAgentTurnKind = "statement" | "conclusion";

export interface RoomMetaRow {
  pk: `ROOM#${string}`;
  sk: "META";
  room_id: string;
  title: string;
  question: string;
  /** Optional background, inline (≤4000c — no S3 split on META). */
  context?: string;
  status: RoomStatus;
  /** Agent slugs, 2..6, deduped, chair included. */
  participants: string[];
  chair: string;
  /** Debate rounds per run as created (1..3). */
  rounds: number;
  /** ULID of the current/last schedule run. */
  run_id: string;
  /** Number of runs (start = 1; +1 per reopen and per conclude-now). */
  run_count: number;
  /** First debate round of the current run (1 on the first run; the round
   *  after every earlier agent turn on a reopen). For a
   *  conclusion-only run it is the conclusion's round. */
  run_start_round?: number;
  /** Debate rounds in the current run (`rounds` on the first run, 1 on a
   *  reopen, 0 on a conclusion-only run). */
  run_rounds?: number;
  created_by: "operator";
  created_at: string;
  updated_at: string;
  last_turn_at: string;
  turn_count: number;
  conclusion_turn_id?: string;
  conclusion_preview?: string;
  archived?: boolean;
  /** Last turn / dispatch failure (W-4: visible on the room, never silent). */
  last_error?: string;
  gsi3pk: typeof ROOMS_GSI3_PK;
  gsi3sk: string;
}

export interface RoomTurnRow {
  pk: `ROOM#${string}`;
  sk: `TURN#${string}`;
  turn_id: string;
  room_id: string;
  run_id: string;
  /** 0 = operator (opening / steer), 1..N = debate, conclusion = last + 1. */
  round: number;
  kind: RoomTurnKind;
  /** Agent slug, or ROOM_OPERATOR_ID. */
  from: string;
  at: string;
  /** One-line stance (agent statements only; absent when not emitted). */
  position?: string;
  body_preview: string;
  /** S3 key `rooms/{room_id}/{ulid}.md`; absent when the body is inline. */
  body_ref?: string;
  // LLM metadata on agent turns (mirrors MSG / POST rows).
  finish_reason?: string;
  tokens_in?: number;
  tokens_out?: number;
  skill_version?: string;
}

// --- API view types ------------------------------------------------------

export interface RoomSummaryView {
  room_id: string;
  title: string;
  question: string;
  status: RoomStatus;
  participants: string[];
  chair: string;
  rounds: number;
  run_count: number;
  created_at: string;
  last_turn_at: string;
  turn_count: number;
  conclusion_preview?: string;
  archived?: boolean;
}

export interface RoomView extends RoomSummaryView {
  context?: string;
  run_id: string;
  run_start_round?: number;
  run_rounds?: number;
  conclusion_turn_id?: string;
  last_error?: string;
}

export interface TurnView {
  turn_id: string;
  room_id: string;
  run_id: string;
  round: number;
  kind: RoomTurnKind;
  from: string;
  at: string;
  position?: string;
  body: string;
}

/** One scheduled agent turn. */
export interface RoomScheduleStep {
  speaker: string;
  round: number;
  kind: RoomAgentTurnKind;
}

/** The wf-room-debate event: the turn to speak now + the rest of the run. */
export interface RoomTurnDispatch extends RoomScheduleStep {
  room_id: string;
  run_id: string;
  then: RoomScheduleStep[];
}

// --- Key + id helpers ----------------------------------------------------

export function roomPk(roomId: string): `ROOM#${string}` {
  return `ROOM#${roomId}`;
}

export function turnSk(turnId: string): `TURN#${string}` {
  return `TURN#${turnId}`;
}

/** Sort key of one scheduled turn's slot claim. Fixed by the schedule step
 *  (run, round, kind, speaker), so two deliveries of one event collide. */
export function claimSk(
  runId: string,
  round: number,
  kind: RoomAgentTurnKind,
  speaker: string,
): `CLAIM#${string}` {
  return `CLAIM#${runId}#${round}#${kind}#${speaker}`;
}

export function isValidRoomId(id: string): boolean {
  return ULID_PATTERN.test(id);
}

export function isValidTurnId(id: string): boolean {
  return ULID_PATTERN.test(id);
}

export function roomBodyKey(roomId: string, turnId: string): string {
  return `rooms/${roomId}/${turnId}.md`;
}

// --- Schedule ------------------------------------------------------------

/**
 * The ordered turns of one run: for each round in
 * `startRound..startRound+rounds-1`, every participant in order speaks a
 * `statement`; then the chair writes the `conclusion` at the next round.
 * Pure. `rounds = 0` yields the conclusion alone (POST /rooms/{id}/conclude).
 */
export function buildSchedule(
  participants: readonly string[],
  rounds: number,
  chair: string,
  startRound = 1,
): RoomScheduleStep[] {
  const out: RoomScheduleStep[] = [];
  for (let r = startRound; r < startRound + rounds; r++) {
    for (const speaker of participants) out.push({ speaker, round: r, kind: "statement" });
  }
  out.push({ speaker: chair, round: startRound + rounds, kind: "conclusion" });
  return out;
}

/** Turn a schedule into the first dispatch: head speaks, tail rides `then`. */
export function toDispatch(
  roomId: string,
  runId: string,
  schedule: readonly RoomScheduleStep[],
): RoomTurnDispatch {
  const [head, ...then] = schedule;
  if (!head) throw new Error("toDispatch: empty schedule");
  return { room_id: roomId, run_id: runId, speaker: head.speaker, round: head.round, kind: head.kind, then };
}

/**
 * The operator-facing ordinal of a debate round. Stored `round` numbers are
 * absolute and a conclusion takes a round number of its own (3 × 2 room:
 * statements 1, 2 → conclusion 3 → reopened statements 4), so every LABEL
 * — the agent's "round N of M", the transcript tags, the console — counts
 * debate rounds only: the ordinal of `round` among the distinct statement
 * rounds below it, plus one (round 4 above is the 3rd debate round). A
 * round with no statement yet gets the ordinal it will have once it lands.
 * Mirrored in workforce/app/src/lib/rooms.ts.
 */
export function ordinalOfRound(turns: ReadonlyArray<Pick<RoomTurnRow, "kind" | "round">>, round: number): number {
  const below = new Set<number>();
  for (const t of turns) if (t.kind === "statement" && t.round < round) below.add(t.round);
  return below.size + 1;
}

/** Absolute round → ordinal, for every distinct statement round. */
export function debateRoundOrdinals(turns: ReadonlyArray<Pick<RoomTurnRow, "kind" | "round">>): Map<number, number> {
  const rounds = [...new Set(turns.filter((t) => t.kind === "statement").map((t) => t.round))].sort((a, b) => a - b);
  return new Map(rounds.map((r, i) => [r, i + 1]));
}

/** Highest round any agent has spoken in (statements AND conclusions); 0
 *  when none. A reopen / conclude-now starts at the round after it, so no
 *  new turn ever shares a round number with an earlier one — a conclusion
 *  at round 3 is followed by reopened statements at round 4, not 3. */
export function maxAgentRound(turns: ReadonlyArray<Pick<RoomTurnRow, "kind" | "round">>): number {
  let max = 0;
  for (const t of turns) {
    if ((t.kind === "statement" || t.kind === "conclusion") && t.round > max) max = t.round;
  }
  return max;
}

// --- Validation ----------------------------------------------------------

export type RoomValidation<T> = { ok: true; value: T } | { ok: false; error: string; detail?: string };

export interface RoomCreateInput {
  title: string;
  question: string;
  context?: string;
  participants: string[];
  chair: string;
  rounds: number;
}

function bad<T>(error: string, detail?: string): RoomValidation<T> {
  return detail !== undefined ? { ok: false, error, detail } : { ok: false, error };
}

/** Trim + validate a room title. */
export function validateRoomTitle(raw: unknown): RoomValidation<string> {
  if (typeof raw !== "string") return bad("invalid_title", "title must be a string");
  const title = raw.replace(/\s+/g, " ").trim();
  if (title.length === 0) return bad("invalid_title", "title is empty");
  if (title.length > ROOM_TITLE_MAX_CHARS) {
    return bad("invalid_title", `title over ${ROOM_TITLE_MAX_CHARS} chars`);
  }
  return { ok: true, value: title };
}

/**
 * Validate a `POST /rooms` body (shape only — whether each slug is a live,
 * non-archived agent is the route's job, it needs the AGENT rows).
 * Participants are trimmed, lowercased and deduplicated in first-seen
 * order; the chair defaults to the first participant and must be one of
 * them; rounds default to 2.
 */
export function validateRoomCreate(body: Record<string, unknown>): RoomValidation<RoomCreateInput> {
  const title = validateRoomTitle(body.title);
  if (!title.ok) return title;

  if (typeof body.question !== "string" || body.question.trim().length === 0) {
    return bad("invalid_question", "question is required");
  }
  const question = body.question.trim();
  if (question.length > ROOM_QUESTION_MAX_CHARS) {
    return bad("invalid_question", `question over ${ROOM_QUESTION_MAX_CHARS} chars`);
  }

  let context: string | undefined;
  if (body.context !== undefined && body.context !== null) {
    if (typeof body.context !== "string") return bad("invalid_context", "context must be a string");
    const trimmed = body.context.trim();
    if (trimmed.length > ROOM_CONTEXT_MAX_CHARS) {
      return bad("invalid_context", `context over ${ROOM_CONTEXT_MAX_CHARS} chars`);
    }
    if (trimmed.length > 0) context = trimmed;
  }

  if (!Array.isArray(body.participants)) return bad("invalid_participants", "participants must be an array");
  const participants: string[] = [];
  for (const p of body.participants) {
    if (typeof p !== "string") return bad("invalid_participants", "participants must be slugs");
    const slug = p.trim().toLowerCase();
    if (slug === ROOM_OPERATOR_ID || !SLUG_PATTERN.test(slug)) {
      return bad("invalid_participants", `not an agent slug: ${p}`);
    }
    if (!participants.includes(slug)) participants.push(slug);
  }
  if (participants.length < ROOM_MIN_PARTICIPANTS || participants.length > ROOM_MAX_PARTICIPANTS) {
    return bad(
      "invalid_participants",
      `a room takes ${ROOM_MIN_PARTICIPANTS}..${ROOM_MAX_PARTICIPANTS} distinct agents (got ${participants.length})`,
    );
  }

  let chair = participants[0]!;
  if (body.chair !== undefined && body.chair !== null) {
    if (typeof body.chair !== "string") return bad("invalid_chair", "chair must be a slug");
    chair = body.chair.trim().toLowerCase();
    if (!participants.includes(chair)) return bad("invalid_chair", "chair must be one of the participants");
  }

  let rounds = ROOM_DEFAULT_ROUNDS;
  if (body.rounds !== undefined && body.rounds !== null) {
    if (
      typeof body.rounds !== "number" ||
      !Number.isInteger(body.rounds) ||
      body.rounds < ROOM_MIN_ROUNDS ||
      body.rounds > ROOM_MAX_ROUNDS
    ) {
      return bad("invalid_rounds", `rounds must be an integer ${ROOM_MIN_ROUNDS}..${ROOM_MAX_ROUNDS}`);
    }
    rounds = body.rounds;
  }

  return {
    ok: true,
    value: { title: title.value, question, ...(context !== undefined ? { context } : {}), participants, chair, rounds },
  };
}

/** Trim + validate a turn body. Throws on empty / over-cap (C-4 fail-loud).
 *  `max` defaults to the operator cap; agent turns pass ROOM_AGENT_TURN_MAX_CHARS. */
export function validateTurnBody(body: unknown, max: number = ROOM_TURN_HARD_MAX_CHARS): string {
  if (typeof body !== "string") throw new Error("room_turn: invalid_body");
  const trimmed = body.trim();
  if (trimmed.length === 0) throw new Error("room_turn: empty_body");
  if (trimmed.length > max) {
    throw new Error(`room_turn: body_over_hard_cap: ${trimmed.length} > ${max}`);
  }
  return trimmed;
}

const JA_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/;

/** The question's language — 'ja' if it carries any kana or CJK ideograph,
 *  else 'en'. Same rule as the console (workforce/app/src/lib/rooms.ts), so
 *  the turns, the conclusion headings and the console's room-content labels
 *  (round dividers, progress band — marked `lang` there; the chrome stays
 *  English) agree. */
export function questionLanguage(q: string): "ja" | "en" {
  return JA_RE.test(q) ? "ja" : "en";
}

// --- POSITION parsing ----------------------------------------------------

const POSITION_LINE = /^\**\s*POSITION\s*\**\s*[:：]\s*\**\s*(.+?)\s*\**\s*$/i;

/** First sentence of a line (Latin or Japanese terminator) + the rest. */
const FIRST_SENTENCE = /^(.+?[.!?。！？])\s*(\S[\s\S]*)$/u;

/**
 * Split a statement into its one-line stance and its prose. The debate
 * contract asks for a first line exactly `POSITION: <one sentence>`; the
 * parse tolerates the drift models actually produce (bold markers, a
 * full-width colon in a Japanese answer) and is fail-soft — no such line
 * means no `position`, the whole text stays the body.
 *
 * It never drops text (W-1: no partial body under a byline). A stance line
 * over ROOM_POSITION_MAX_CHARS is the model running its prose onto it: a
 * first sentence that fits becomes the stance and the rest of the line
 * leads the body; otherwise there is no stance and the line stays prose.
 */
export function parsePosition(text: string): { position?: string; body: string } {
  const trimmed = text.trim();
  const nl = trimmed.indexOf("\n");
  const first = nl === -1 ? trimmed : trimmed.slice(0, nl);
  const m = POSITION_LINE.exec(first);
  if (!m) return { body: trimmed };
  const stance = m[1]!.trim();
  const rest = nl === -1 ? "" : trimmed.slice(nl + 1).trim();
  if (stance.length === 0) return { body: rest };
  if (stance.length <= ROOM_POSITION_MAX_CHARS) return { position: stance, body: rest };
  const join = (head: string) => [head, rest].filter((s) => s.length > 0).join("\n\n");
  const s = FIRST_SENTENCE.exec(stance);
  if (s && s[1]!.length <= ROOM_POSITION_MAX_CHARS) return { position: s[1]!.trim(), body: join(s[2]!.trim()) };
  return { body: join(stance) };
}

// --- Row → view ----------------------------------------------------------

export function toRoomSummaryView(meta: RoomMetaRow): RoomSummaryView {
  return {
    room_id: meta.room_id,
    title: meta.title,
    question: meta.question,
    status: meta.status,
    participants: meta.participants,
    chair: meta.chair,
    rounds: meta.rounds,
    run_count: meta.run_count,
    created_at: meta.created_at,
    last_turn_at: meta.last_turn_at,
    turn_count: meta.turn_count,
    ...(meta.conclusion_preview !== undefined ? { conclusion_preview: meta.conclusion_preview } : {}),
    ...(meta.archived !== undefined ? { archived: meta.archived } : {}),
  };
}

export function toRoomView(meta: RoomMetaRow): RoomView {
  return {
    ...toRoomSummaryView(meta),
    ...(meta.context !== undefined ? { context: meta.context } : {}),
    run_id: meta.run_id,
    ...(meta.run_start_round !== undefined ? { run_start_round: meta.run_start_round } : {}),
    ...(meta.run_rounds !== undefined ? { run_rounds: meta.run_rounds } : {}),
    ...(meta.conclusion_turn_id !== undefined ? { conclusion_turn_id: meta.conclusion_turn_id } : {}),
    ...(meta.last_error !== undefined ? { last_error: meta.last_error } : {}),
  };
}

export function toTurnView(row: RoomTurnRow, body: string): TurnView {
  return {
    turn_id: row.turn_id,
    room_id: row.room_id,
    run_id: row.run_id,
    round: row.round,
    kind: row.kind,
    from: row.from,
    at: row.at,
    ...(row.position !== undefined ? { position: row.position } : {}),
    body,
  };
}

// --- Read helpers --------------------------------------------------------

export async function getRoomMeta(roomId: string): Promise<RoomMetaRow | undefined> {
  return getItem<RoomMetaRow>(roomPk(roomId), "META");
}

export interface ListRoomsQuery {
  pageSize?: number;
  cursor?: string;
}

/** Newest-first page of rooms: one GSI3 partition query (never a Scan). */
export async function listRooms(query: ListRoomsQuery = {}): Promise<PagedResult<RoomMetaRow>> {
  return queryByGsiPaged<RoomMetaRow>("GSI3", ROOMS_GSI3_PK, {
    scanIndexForward: false,
    limit: Math.min(Math.max(1, query.pageSize ?? ROOMS_PAGE_DEFAULT), ROOMS_PAGE_MAX),
    cursor: query.cursor,
  });
}

/** Drain one key range of the room partition, ascending (oldest first).
 *  Rooms are bounded (participants × rounds + 1 per run), but every page is
 *  still drained — a Limit-capped single page would silently drop the tail
 *  (the FU-PROJ-SCAN bug class). */
async function drainTurns(
  roomId: string,
  keyCondition: string,
  values: Record<string, unknown>,
  projection?: string,
): Promise<RoomTurnRow[]> {
  const out: RoomTurnRow[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: keyCondition,
        ExpressionAttributeNames: projection
          ? { "#pk": "pk", "#sk": "sk", "#from": "from" }
          : { "#pk": "pk", "#sk": "sk" },
        ExpressionAttributeValues: { ":pk": roomPk(roomId), ...values },
        ...(projection ? { ProjectionExpression: projection } : {}),
        ScanIndexForward: true,
        ExclusiveStartKey: exclusiveStartKey,
        ConsistentRead: true,
      }),
    );
    out.push(...((res.Items ?? []) as RoomTurnRow[]));
    exclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);
  return out;
}

/** Every TURN row of a room, chronological, un-hydrated (authorship/rounds). */
export async function listRoomTurnRows(roomId: string): Promise<RoomTurnRow[]> {
  return drainTurns(roomId, "#pk = :pk AND begins_with(#sk, :skp)", { ":skp": "TURN#" });
}

/** Resolve a turn body: inline preview, else the S3 object (throws on a
 *  missing object — W-4). */
export async function resolveTurnBody(row: RoomTurnRow): Promise<string> {
  if (!row.body_ref) return row.body_preview;
  const res = await s3.send(new GetObjectCommand({ Bucket: bucketName(), Key: row.body_ref }));
  if (!res.Body) throw new Error(`room turn body not found in S3: ${row.body_ref}`);
  return await res.Body.transformToString();
}

/** S3 body reads in flight at once while hydrating a room. A room
 *  reopened many times carries dozens of long turns; serial reads could
 *  outlast the wf-rooms-api timeout, an unbounded fan-out would burst S3. */
export const ROOM_BODY_FETCH_CONCURRENCY = 8;

/** `Promise.all(items.map(fn))` with at most `limit` calls in flight;
 *  results keep the input order, the first rejection rejects the whole. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return out;
}

async function hydrate(rows: RoomTurnRow[]): Promise<TurnView[]> {
  return mapWithConcurrency(rows, ROOM_BODY_FETCH_CONCURRENCY, async (row) => toTurnView(row, await resolveTurnBody(row)));
}

/** Every turn of a room, chronological, bodies resolved. */
export async function listRoomTurns(roomId: string): Promise<TurnView[]> {
  return hydrate(await listRoomTurnRows(roomId));
}

/** Turns strictly newer than `afterTurnId`, oldest first — the console's
 *  poll tail (`GET /rooms/{id}?after=`). A key-range query on the ULID sk. */
export async function listRoomTurnsAfter(roomId: string, afterTurnId: string): Promise<TurnView[]> {
  return hydrate(await drainTurns(roomId, "#pk = :pk AND #sk > :after", { ":after": turnSk(afterTurnId) }));
}

/** Agent-authored turns on a room since `sinceMs` — the per-room daily
 *  budget wf-room-debate enforces. Drained, `from`-only projection. */
export async function countAgentTurnsSince(roomId: string, sinceMs: number): Promise<number> {
  const rows = await drainTurns(
    roomId,
    "#pk = :pk AND #sk >= :lo",
    { ":lo": turnSk(ulidLowerBound(sinceMs)) },
    "#from",
  );
  return rows.filter((r) => r.from !== ROOM_OPERATOR_ID).length;
}

// --- Write path ----------------------------------------------------------

async function writeBody(roomId: string, turnId: string, body: string): Promise<string | undefined> {
  if (body.length <= ROOM_TURN_PREVIEW_MAX_CHARS) return undefined;
  const key = roomBodyKey(roomId, turnId);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: key,
      Body: body,
      ContentType: "text/markdown; charset=utf-8",
    }),
  );
  return key;
}

function isConditionalFailure(err: unknown): boolean {
  return (err as { name?: string } | undefined)?.name === "ConditionalCheckFailedException";
}

export interface UpdateRoomMetaOptions {
  /** Attributes to REMOVE (e.g. a cleared `last_error`). */
  remove?: string[];
  /** Atomic counter increments (`ADD`). */
  increment?: Record<string, number>;
  /** Apply only while META's `run_id` still equals this — a stale run must
   *  never overwrite the state of the run that superseded it. */
  ifRunId?: string;
}

/**
 * Patch the META row. Unlike `updateOperational`, the write is conditional
 * on the row existing (an update must never conjure a stub META for a room
 * that is not there) and optionally on the current run. Throws
 * ConditionalCheckFailedException when a condition does not hold.
 * Returns the row after the update.
 */
export async function updateRoomMeta(
  roomId: string,
  set: Record<string, unknown>,
  opts: UpdateRoomMetaOptions = {},
): Promise<RoomMetaRow> {
  const names: Record<string, string> = { "#pk": "pk", "#updated_at": "updated_at" };
  const values: Record<string, unknown> = { ":updated_at": new Date().toISOString() };
  const sets: string[] = ["#updated_at = :updated_at"];
  for (const [k, v] of Object.entries(set)) {
    if (v === undefined || k === "updated_at") continue;
    names[`#${k}`] = k;
    values[`:${k}`] = v;
    sets.push(`#${k} = :${k}`);
  }
  const adds: string[] = [];
  for (const [k, v] of Object.entries(opts.increment ?? {})) {
    names[`#${k}`] = k;
    values[`:inc_${k}`] = v;
    adds.push(`#${k} :inc_${k}`);
  }
  const removes: string[] = [];
  for (const k of opts.remove ?? []) {
    names[`#${k}`] = k;
    removes.push(`#${k}`);
  }
  let condition = "attribute_exists(#pk)";
  if (opts.ifRunId !== undefined) {
    names["#run_id"] = "run_id";
    values[":if_run_id"] = opts.ifRunId;
    condition += " AND #run_id = :if_run_id";
  }
  const expression = [
    `SET ${sets.join(", ")}`,
    ...(adds.length > 0 ? [`ADD ${adds.join(", ")}`] : []),
    ...(removes.length > 0 ? [`REMOVE ${removes.join(", ")}`] : []),
  ].join(" ");
  const res = await ddb.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { pk: roomPk(roomId), sk: "META" },
      UpdateExpression: expression,
      ConditionExpression: condition,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    }),
  );
  return (res.Attributes ?? {}) as RoomMetaRow;
}

/**
 * Claim one scheduled turn before its Claude call: a conditional put of
 * `ROOM#{room_id}` / `CLAIM#{run_id}#{round}#{kind}#{speaker}` that only
 * succeeds if no copy of this step has claimed it. Async Lambda delivery
 * is at-least-once, and two overlapping copies of one event would both
 * pass a transcript check during the 10–90 s call — both would speak and
 * both pass the baton, forking the run past participants × rounds + 1.
 * Returns false when the slot was already claimed; any other failure
 * throws.
 */
export async function claimTurnSlot(
  step: { room_id: string; run_id: string; round: number; kind: RoomAgentTurnKind; speaker: string },
  now: () => Date = () => new Date(),
): Promise<boolean> {
  try {
    await conditionalPutItem(
      {
        pk: roomPk(step.room_id),
        sk: claimSk(step.run_id, step.round, step.kind, step.speaker),
        room_id: step.room_id,
        run_id: step.run_id,
        round: step.round,
        kind: step.kind,
        speaker: step.speaker,
        claimed_at: now().toISOString(),
      },
      "attribute_not_exists(sk)",
    );
    return true;
  } catch (err) {
    if (isConditionalFailure(err)) return false;
    throw err;
  }
}

export interface CreateRoomInput extends RoomCreateInput {
  now?: () => Date;
  newUlid?: () => string;
}

export interface CreatedRoom {
  meta: RoomMetaRow;
  opening: TurnView;
  /** The first run's full schedule (head = the first dispatch). */
  schedule: RoomScheduleStep[];
}

/**
 * Create a room. Writes (in order): the S3 body of the opening turn (if
 * long) → META (status `debating`, run 1, turn_count 1) → the `opening`
 * TURN (from the operator, round 0, body = the question). The caller
 * dispatches `schedule[0]`.
 */
export async function createRoom(input: CreateRoomInput): Promise<CreatedRoom> {
  const mkUlid = input.newUlid ?? newUlid;
  const at = (input.now ?? (() => new Date()))().toISOString();
  const roomId = mkUlid();
  const runId = mkUlid();
  const turnId = mkUlid();
  const body = validateTurnBody(input.question);
  const bodyRef = await writeBody(roomId, turnId, body);

  const meta: RoomMetaRow = {
    pk: roomPk(roomId),
    sk: "META",
    room_id: roomId,
    title: input.title,
    question: input.question,
    ...(input.context !== undefined ? { context: input.context } : {}),
    status: "debating",
    participants: input.participants,
    chair: input.chair,
    rounds: input.rounds,
    run_id: runId,
    run_count: 1,
    run_start_round: 1,
    run_rounds: input.rounds,
    created_by: "operator",
    created_at: at,
    updated_at: at,
    last_turn_at: at,
    turn_count: 1,
    gsi3pk: ROOMS_GSI3_PK,
    gsi3sk: at,
  };
  await putItem(meta);

  const turn: RoomTurnRow = {
    pk: roomPk(roomId),
    sk: turnSk(turnId),
    turn_id: turnId,
    room_id: roomId,
    run_id: runId,
    round: 0,
    kind: "opening",
    from: ROOM_OPERATOR_ID,
    at,
    body_preview: body.slice(0, ROOM_TURN_PREVIEW_MAX_CHARS),
    ...(bodyRef !== undefined ? { body_ref: bodyRef } : {}),
  };
  await putItem(turn);

  return {
    meta,
    opening: toTurnView(turn, body),
    schedule: buildSchedule(input.participants, input.rounds, input.chair, 1),
  };
}

export interface AppendTurnInput {
  room_id: string;
  run_id: string;
  round: number;
  kind: RoomTurnKind;
  from: string;
  body: string;
  position?: string;
  finish_reason?: string;
  tokens_in?: number;
  tokens_out?: number;
  skill_version?: string;
  now?: () => Date;
  newUlid?: () => string;
}

export interface AppendedTurn {
  view: TurnView;
  row: RoomTurnRow;
  /** META after the write. */
  meta: RoomMetaRow;
  /** Conclusion only: true when the room's run moved on while the chair was
   *  writing, so META was NOT flipped to `concluded` (the turn is kept —
   *  it is a real artefact of its own run — but the newer run owns status). */
  superseded?: boolean;
}

/**
 * Append a turn. Writes (in order) the S3 body (if long) → the TURN row →
 * the META patch (`last_turn_at`, `turn_count` +1, `updated_at`). A
 * `conclusion` also sets `status: "concluded"`, `conclusion_turn_id` and
 * `conclusion_preview` — conditionally on META still being on the turn's
 * run. Throws if the room has no META row (never a dangling turn).
 */
export async function appendTurn(input: AppendTurnInput): Promise<AppendedTurn> {
  const existing = await getRoomMeta(input.room_id);
  if (!existing) throw new Error(`appendTurn: no room META for ${input.room_id}`);

  const agentTurn = input.kind === "statement" || input.kind === "conclusion";
  const body = validateTurnBody(input.body, agentTurn ? ROOM_AGENT_TURN_MAX_CHARS : ROOM_TURN_HARD_MAX_CHARS);
  const at = (input.now ?? (() => new Date()))().toISOString();
  const turnId = (input.newUlid ?? newUlid)();
  const preview = body.slice(0, ROOM_TURN_PREVIEW_MAX_CHARS);
  const bodyRef = await writeBody(input.room_id, turnId, body);

  const row: RoomTurnRow = {
    pk: roomPk(input.room_id),
    sk: turnSk(turnId),
    turn_id: turnId,
    room_id: input.room_id,
    run_id: input.run_id,
    round: input.round,
    kind: input.kind,
    from: input.from,
    at,
    ...(input.position !== undefined ? { position: input.position.slice(0, ROOM_POSITION_MAX_CHARS) } : {}),
    body_preview: preview,
    ...(bodyRef !== undefined ? { body_ref: bodyRef } : {}),
    ...(input.finish_reason !== undefined ? { finish_reason: input.finish_reason } : {}),
    ...(input.tokens_in !== undefined ? { tokens_in: input.tokens_in } : {}),
    ...(input.tokens_out !== undefined ? { tokens_out: input.tokens_out } : {}),
    ...(input.skill_version !== undefined ? { skill_version: input.skill_version } : {}),
  };
  await putItem(row);

  const counters = { increment: { turn_count: 1 } };
  if (input.kind === "conclusion") {
    try {
      const meta = await updateRoomMeta(
        input.room_id,
        {
          last_turn_at: at,
          status: "concluded",
          conclusion_turn_id: turnId,
          conclusion_preview: preview,
        },
        { ...counters, ifRunId: input.run_id },
      );
      return { view: toTurnView(row, body), row, meta };
    } catch (err) {
      if (!isConditionalFailure(err)) throw err;
      const meta = await updateRoomMeta(input.room_id, { last_turn_at: at }, counters);
      return { view: toTurnView(row, body), row, meta, superseded: true };
    }
  }
  const meta = await updateRoomMeta(input.room_id, { last_turn_at: at }, counters);
  return { view: toTurnView(row, body), row, meta };
}
