// Rooms — purpose-first deliberation (console client).
//
// A Room is opened FOR a question: the operator summons 2–6 agents from the
// roster, they deliberate in bounded rounds, and a chair writes the
// conclusion. A Messaging thread is participant-first (people exist, a
// conversation attaches); a Room is purpose-first (the question exists,
// people are gathered around it) and ends by construction.
//
// Wire shapes mirror the agents-api `/rooms` routes (rooms design contract
// §4). Reads are public on the CORS gate like `/threads` and go through
// plain `fetch`; writes are AWS_IAM at the gateway and go through
// `signedFetch` (lib/sigv4.ts) — the same posture as lib/messages.ts. The
// SPA never sends a `from`: the operator is the author at the gateway.
//
// The pure helpers at the bottom (merge, progress, grouping, language,
// stall / poll health) are what the pages derive their state from;
// lib/rooms.test.ts pins them.

import { WORKFORCE_AGENTS_API_BASE } from '../config/api';
import { SIGV4_IS_CONFIGURED } from '../config/auth';
import { apiConfigured } from './agents';
import { assertSigv4Configured, signedFetch } from './sigv4';

/** Mirror of the backend's `ROOM_OPERATOR_ID` (= MESSAGING_OPERATOR_ID). */
export const ROOM_OPERATOR_ID = 'operator';

export const ROOM_MIN_PARTICIPANTS = 2;
export const ROOM_MAX_PARTICIPANTS = 6;
export const ROOM_MAX_ROUNDS = 3;
export const ROOM_DEFAULT_ROUNDS = 2;
export const ROOM_TITLE_MAX_CHARS = 120;
export const ROOM_QUESTION_MAX_CHARS = 2000;
export const ROOM_CONTEXT_MAX_CHARS = 4000;
export const ROOM_TURN_HARD_MAX_CHARS = 6000;

// ── Wire types (contract §4) ────────────────────────────────────────────

export type RoomStatus = 'debating' | 'concluded';
export type TurnKind = 'opening' | 'statement' | 'steer' | 'conclusion';

/** `GET /rooms` list row. */
export interface RoomSummary {
  room_id: string;
  title: string;
  question: string;
  status: RoomStatus;
  /** Agent slugs, 2..6, chair included, in speaking order. */
  participants: string[];
  chair: string;
  /** Debate rounds per run (1..3). */
  rounds: number;
  /** Schedule runs so far: start = 1, each reopen +1. */
  run_count: number;
  created_at: string;
  last_turn_at: string;
  turn_count: number;
  conclusion_preview?: string;
  archived?: boolean;
}

/** `GET /rooms/{id}` → `room`. */
export interface RoomView extends RoomSummary {
  context?: string;
  /** ULID of the current/last schedule run. */
  run_id: string;
  /** First debate round of the current run (1 on the first run, the round
   *  after the existing statements on a reopen; for a conclusion-only run,
   *  the conclusion's round). Optional: derived from the turns when absent. */
  run_start_round?: number;
  /** Debate rounds in the current run (`rounds` first, 1 on a reopen, 0 on
   *  a conclusion-only "Conclude now" run). Optional, as above. */
  run_rounds?: number;
  conclusion_turn_id?: string;
  /** Last Lambda failure (W-4: visible, never silent). */
  last_error?: string;
}

/** One turn in a room. `round`: 0 = operator (opening / steer), 1..N =
 *  debate, N+1 = conclusion. */
export interface TurnView {
  turn_id: string;
  room_id: string;
  run_id: string;
  round: number;
  kind: TurnKind;
  /** Agent slug, or ROOM_OPERATOR_ID. */
  from: string;
  at: string;
  /** One-line stance on agent statements (absent if the model omitted it). */
  position?: string;
  body: string;
}

export interface RoomDetail {
  room: RoomView;
  turns: TurnView[];
}

export interface RoomsPage {
  rooms: RoomSummary[];
  cursor?: string;
}

export interface CreateRoomInput {
  title: string;
  question: string;
  context?: string;
  participants: string[];
  chair?: string;
  rounds?: number;
}

export interface SteerResult {
  turn_id: string;
  /** True when the steer landed on a concluded room and reopened it. */
  reopened: boolean;
}

export interface RoomPatch {
  archived?: boolean;
  title?: string;
}

// ── Reads (public) ──────────────────────────────────────────────────────

/** True when the operator write path is usable: live API base configured
 *  AND the SigV4 broker has its Identity-Pool config. Same gate as
 *  `messagingWriteEnabled()` — the create panel and composers hide without
 *  it. */
export function roomsWriteEnabled(): boolean {
  return apiConfigured() && SIGV4_IS_CONFIGURED;
}

/** List rooms, newest first. Returns an empty page when the live API is
 *  not configured (the mock origin has no rooms to show). */
export async function fetchRooms(opts: { pageSize?: number; cursor?: string } = {}): Promise<RoomsPage> {
  if (!apiConfigured()) return { rooms: [] };
  const params = new URLSearchParams();
  if (opts.pageSize !== undefined) params.set('page_size', String(opts.pageSize));
  if (opts.cursor) params.set('cursor', opts.cursor);
  const qs = params.size > 0 ? `?${params.toString()}` : '';
  const res = await fetch(`${WORKFORCE_AGENTS_API_BASE}/rooms${qs}`);
  if (!res.ok) throw new Error(`agents-api ${res.status}${await errorSuffix(res)}`);
  const data = (await res.json()) as { rooms?: RoomSummary[]; cursor?: string };
  return { rooms: data.rooms ?? [], ...(data.cursor ? { cursor: data.cursor } : {}) };
}

/** Fetch one room with its turns (chronological). With `after`, only turns
 *  newer than that turn id come back — the poll tail — but `room` is always
 *  present so a status flip (debating → concluded) is seen. Returns
 *  undefined on 404 / when the live API is not configured. */
export async function fetchRoom(id: string, opts: { after?: string } = {}): Promise<RoomDetail | undefined> {
  if (!apiConfigured()) return undefined;
  const qs = opts.after ? `?after=${encodeURIComponent(opts.after)}` : '';
  const res = await fetch(`${WORKFORCE_AGENTS_API_BASE}/rooms/${encodeURIComponent(id)}${qs}`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`agents-api ${res.status}${await errorSuffix(res)}`);
  const data = (await res.json()) as { room: RoomView; turns?: TurnView[] };
  return { room: data.room, turns: data.turns ?? [] };
}

// ── Writes (AWS_IAM via SigV4) ──────────────────────────────────────────

/** Best-effort error-body reader — surfaces the handler's `{error,detail}`
 *  for the operator banner without making JSON parsing its own failure
 *  mode (same as lib/messages.ts). */
async function readErrorBody(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string; detail?: string };
    return [data.error, data.detail].filter(Boolean).join(' · ');
  } catch {
    return '';
  }
}

async function errorSuffix(res: Response): Promise<string> {
  const detail = await readErrorBody(res);
  return detail ? ` · ${detail}` : '';
}

async function sendSigned(method: 'POST' | 'PATCH', path: string, body?: unknown): Promise<Response> {
  assertSigv4Configured();
  const init: RequestInit =
    body === undefined
      ? { method }
      : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const res = await signedFetch(`${WORKFORCE_AGENTS_API_BASE}${path}`, init);
  if (!res.ok) throw new Error(`agents-api ${res.status}${await errorSuffix(res)}`);
  return res;
}

/** Open a room. The backend writes the opening turn and dispatches the
 *  first speaker; this resolves with the new room id. */
export async function createRoom(input: CreateRoomInput): Promise<string> {
  const payload: CreateRoomInput = {
    title: input.title,
    question: input.question,
    participants: input.participants,
    ...(input.context ? { context: input.context } : {}),
    ...(input.chair ? { chair: input.chair } : {}),
    ...(input.rounds !== undefined ? { rounds: input.rounds } : {}),
  };
  const res = await sendSigned('POST', '/rooms', payload);
  const data = (await res.json()) as { room_id: string };
  return data.room_id;
}

/** Operator steer. On a debating room the remaining speakers read it; on a
 *  concluded room it reopens (one more round each + a fresh conclusion). */
export async function steerRoom(id: string, body: string): Promise<SteerResult> {
  const res = await sendSigned('POST', `/rooms/${encodeURIComponent(id)}/turns`, { body });
  const data = (await res.json()) as Partial<SteerResult>;
  return { turn_id: data.turn_id ?? '', reopened: data.reopened === true };
}

/** Cut the debate short (or retry a failed conclusion): the chair writes
 *  the conclusion under a new run. Resolves with that run id. */
export async function concludeRoom(id: string): Promise<string> {
  const res = await sendSigned('POST', `/rooms/${encodeURIComponent(id)}/conclude`);
  const data = (await res.json()) as { run_id?: string };
  return data.run_id ?? '';
}

/** Archive / unarchive or rename a room. */
export async function patchRoom(id: string, patch: RoomPatch): Promise<RoomView> {
  const res = await sendSigned('PATCH', `/rooms/${encodeURIComponent(id)}`, patch);
  const data = (await res.json()) as { room: RoomView };
  return data.room;
}

// ── Pure helpers ────────────────────────────────────────────────────────

function compareTurns(x: TurnView, y: TurnView): number {
  const d = Date.parse(x.at) - Date.parse(y.at);
  if (d !== 0 && !Number.isNaN(d)) return d;
  // ULIDs are time-ordered — tie-break same-instant turns by id.
  return x.turn_id < y.turn_id ? -1 : x.turn_id > y.turn_id ? 1 : 0;
}

/** Union two loaded slices of a room's turns into one chronological list,
 *  dropping duplicates by `turn_id` (a poll tail can overlap what is
 *  already on screen). Later copies win, so a re-fetched turn replaces the
 *  cached one. */
export function mergeTurns(a: ReadonlyArray<TurnView>, b: ReadonlyArray<TurnView>): TurnView[] {
  const byId = new Map<string, TurnView>();
  for (const t of [...a, ...b]) byId.set(t.turn_id, t);
  return [...byId.values()].sort(compareTurns);
}

/** The newest turn id — the `?after=` cursor for the poll tail. ULIDs sort
 *  lexicographically in time order, so the max id is the newest turn. */
export function lastTurnId(turns: ReadonlyArray<TurnView>): string | undefined {
  let max: string | undefined;
  for (const t of turns) if (max === undefined || t.turn_id > max) max = t.turn_id;
  return max;
}

/** How far behind the newest turn the poll cursor trails. */
export const POLL_OVERLAP_MS = 30_000;

/**
 * The `?after=` cursor for the poll tail — deliberately NOT the newest id.
 * A turn's ULID is minted before its body is stored, and two writers can
 * overlap (an operator steer while an agent turn is being written; "Conclude
 * now" racing an in-flight statement), so a turn with a smaller id can
 * become visible after a larger one was already polled. Polling after the
 * max id would skip it for good. The cursor is the newest turn at least
 * `overlapMs` older than the newest one (undefined → a full read; rooms are
 * bounded), and `mergeTurns` folds the re-read overlap in by `turn_id`.
 */
export function pollCursor(turns: ReadonlyArray<TurnView>, overlapMs = POLL_OVERLAP_MS): string | undefined {
  const newest = turns.reduce((m, t) => Math.max(m, Date.parse(t.at) || 0), 0);
  let cursor: TurnView | undefined;
  for (const t of turns) {
    const at = Date.parse(t.at);
    if (Number.isNaN(at) || at > newest - overlapMs) continue;
    if (!cursor || t.turn_id > cursor.turn_id) cursor = t;
  }
  return cursor?.turn_id;
}

/** A room is deliberating while its schedule is running: status
 *  `debating` and not archived (an archived room's Lambda skips). */
export function isDeliberating(room: Pick<RoomSummary, 'status' | 'archived'> | null | undefined): boolean {
  return !!room && room.status === 'debating' && room.archived !== true;
}

/** No new turn / room change for this long → the room reads as stalled. */
export const STALL_MS = 3 * 60_000;

/**
 * The page's liveness verdict: `idle` when nothing is deliberating (no
 * poll, no stall note), `stalled` once a deliberating room has not moved
 * for STALL_MS (the note + "Conclude now", and a slower poll), else `live`.
 */
export function stallState(
  now: number,
  lastProgressAt: number,
  room: Pick<RoomSummary, 'status' | 'archived'> | null | undefined,
): 'idle' | 'live' | 'stalled' {
  if (!isDeliberating(room)) return 'idle';
  return now - lastProgressAt >= STALL_MS ? 'stalled' : 'live';
}

/** Consecutive poll failures before the page shows the fetch error. One
 *  failed tick is noise; three in a row (≥ 12 s) is a read fault the
 *  operator must see before reading the stall as a stopped schedule. */
export const POLL_FAILURE_THRESHOLD = 3;

export interface PollHealth {
  /** Consecutive failed polls (0 after any success). */
  failures: number;
  /** The latest failure's message. */
  error?: string;
}

/** Fold one poll outcome into the health count: a success resets it. */
export function nextPollHealth(prev: PollHealth, outcome: { ok: true } | { ok: false; error: string }): PollHealth {
  return outcome.ok ? { failures: 0 } : { failures: prev.failures + 1, error: outcome.error };
}

/** The fetch error to show, once POLL_FAILURE_THRESHOLD polls in a row failed. */
export function pollErrorToShow(h: PollHealth): string | undefined {
  return h.failures >= POLL_FAILURE_THRESHOLD ? h.error : undefined;
}

const JA_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/;

/** The question's language — 'ja' if it carries any kana or CJK ideograph,
 *  else 'en'. The backend uses the same rule for the debate language. */
export function questionLanguage(q: string): 'ja' | 'en' {
  return JA_RE.test(q) ? 'ja' : 'en';
}

/** Collapse whitespace and clip to `n` characters (code points, so a
 *  Japanese question is never cut mid-surrogate), with an ellipsis. */
export function summarizeQuestion(q: string, n: number): string {
  const flat = q.replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  if (chars.length <= n) return flat;
  return `${chars.slice(0, Math.max(0, n - 1)).join('').trimEnd()}…`;
}

/**
 * The operator-facing ordinal of a debate round. Stored `round` numbers are
 * absolute and a conclusion takes one of its own (3 × 2 room: statements
 * 1, 2 → conclusion 3 → reopened statements 4 → conclusion 5), so every
 * LABEL counts debate rounds only: the number of distinct statement rounds
 * below `round`, plus one — stored round 4 above is "Round 3". A round
 * with no statement yet gets the ordinal it will have once it lands. Same
 * rule as the backend's prompt labels (lambdas/shared/room.ts).
 */
export function ordinalOfRound(turns: ReadonlyArray<Pick<TurnView, 'kind' | 'round'>>, round: number): number {
  const below = new Set<number>();
  for (const t of turns) if (t.kind === 'statement' && t.round < round) below.add(t.round);
  return below.size + 1;
}

/** Absolute round → ordinal, for every distinct statement round. */
export function debateRoundOrdinals(turns: ReadonlyArray<Pick<TurnView, 'kind' | 'round'>>): Map<number, number> {
  const rounds = [...new Set(turns.filter((t) => t.kind === 'statement').map((t) => t.round))].sort((a, b) => a - b);
  return new Map(rounds.map((r, i) => [r, i + 1]));
}

export type RoomPhase = 'debate' | 'conclusion' | 'done';

export interface RoundProgress {
  /** The debate round under way (or the last one, once concluded) — the
   *  stored, absolute round number. */
  round: number;
  /** The last scheduled debate round of the current run (absolute). */
  ofRounds: number;
  /** `round` / `ofRounds` as the operator reads them: ordinals among the
   *  debate rounds (see ordinalOfRound). Every label uses these. */
  roundOrdinal: number;
  ofRoundsOrdinal: number;
  /** Participants who have spoken in `round`, in speaking order. */
  spoken: string[];
  /** Participants still to speak in `round`, in speaking order. */
  pending: string[];
  /** Who is drafting now: the first pending speaker, or the chair while
   *  the conclusion is being written; absent once concluded. */
  nextSpeaker?: string;
  phase: RoomPhase;
}

/**
 * Where the current schedule run stands.
 *
 * The run's plan comes from `room.run_start_round` / `room.run_rounds` when
 * the API sends them (it does — they are what the backend scheduled). When
 * they are absent it is derived from the turns, keeping step with the
 * backend's `buildSchedule` (contract §3):
 * - Only turns of the current `room.run_id` count; steers / the opening
 *   (round 0) never do.
 * - The run's FIRST debate round = the lowest statement round in this run;
 *   if the run has no statement yet, (highest agent round — statement or
 *   conclusion — of any earlier run) + 1, or 1 for a fresh room.
 * - The run's LAST debate round (`ofRounds`): a first run (first round 1)
 *   schedules `room.rounds` rounds; a reopen (first round > 1) schedules
 *   exactly one more round, so `ofRounds = firstRound`.
 * A conclusion-only run (`run_rounds === 0`, or `opts.concluding` — the page
 * knows the run id "Conclude now" returned) schedules only the chair; its
 * band reports the last debate round that was reached (the highest
 * statement round — never `run_start_round - 1`, which can be the round of
 * an earlier conclusion).
 *
 * `round` = the highest statement round in this run (or the first round if
 * none). When everyone has spoken in it and it is not the last round, the
 * band moves on to the next round with nobody spoken yet — that is the
 * round the next speaker is drafting in. Phase: concluded (status, or a
 * conclusion turn in this run) → `done`; every round complete, or a
 * conclusion-only run → `conclusion`; otherwise `debate`.
 */
export function roundProgress(
  room: Pick<RoomView, 'participants' | 'chair' | 'rounds' | 'run_id' | 'status' | 'run_start_round' | 'run_rounds'>,
  turns: ReadonlyArray<TurnView>,
  opts: { concluding?: boolean } = {},
): RoundProgress {
  const participants = room.participants;
  const allStatements = turns.filter((t) => t.kind === 'statement');
  const run = turns.filter((t) => t.run_id === room.run_id);
  const statements = run.filter((t) => t.kind === 'statement');
  const priorMax = turns
    .filter((t) => t.run_id !== room.run_id && (t.kind === 'statement' || t.kind === 'conclusion'))
    .reduce((m, t) => Math.max(m, t.round), 0);
  const planned = room.run_start_round !== undefined && room.run_rounds !== undefined;
  const conclusionOnly = opts.concluding === true || (planned && room.run_rounds === 0);

  let firstRound: number;
  let ofRounds: number;
  if (conclusionOnly) {
    // Nothing more is debated: report the last round that was reached.
    const reached = allStatements.reduce((m, t) => Math.max(m, t.round), 0);
    firstRound = ofRounds = Math.max(1, reached);
  } else if (planned) {
    firstRound = Math.max(1, room.run_start_round as number);
    ofRounds = firstRound + Math.max(1, room.run_rounds as number) - 1;
  } else {
    firstRound = statements.length > 0 ? Math.min(...statements.map((t) => t.round)) : priorMax + 1;
    ofRounds = firstRound === 1 ? Math.max(1, room.rounds) : firstRound;
  }

  // A conclusion-only run has no statements of its own — count the round
  // it closes from every run's statements.
  const pool = conclusionOnly ? allStatements : statements;
  let round = conclusionOnly
    ? ofRounds
    : statements.length > 0
      ? Math.max(...statements.map((t) => t.round))
      : firstRound;
  const spokeIn = (r: number) => new Set(pool.filter((t) => t.round === r).map((t) => t.from));
  let said = spokeIn(round);
  if (!conclusionOnly && round < ofRounds && participants.every((p) => said.has(p))) {
    round += 1;
    said = spokeIn(round);
  }
  const spoken = participants.filter((p) => said.has(p));
  const pending = participants.filter((p) => !said.has(p));
  // Rounds of one run are contiguous, so the ordinals step with them.
  const roundOrdinal = ordinalOfRound(turns, round);
  const base = { round, ofRounds, roundOrdinal, ofRoundsOrdinal: roundOrdinal + (ofRounds - round), spoken, pending };

  const concluded = room.status === 'concluded' || run.some((t) => t.kind === 'conclusion');
  if (concluded) return { ...base, phase: 'done' };
  if (conclusionOnly || (pending.length === 0 && round >= ofRounds)) {
    return { ...base, nextSpeaker: room.chair, phase: 'conclusion' };
  }
  return { ...base, nextSpeaker: pending[0], phase: 'debate' };
}

/** True when the steer composer is closed: the room is deliberating but
 *  only the chair's conclusion is left — the chair read its transcript
 *  when it started, so a steer now would go unread (agents-api answers
 *  `409 room_concluding`). Reopen with a follow-up once it lands. */
export function steerLocked(
  room: Pick<RoomSummary, 'status' | 'archived'> | null | undefined,
  progress: Pick<RoundProgress, 'phase'> | null | undefined,
): boolean {
  return isDeliberating(room) && progress?.phase === 'conclusion';
}

/** The locked composer's note, in the question's language. */
export function steerLockedCopy(lang: 'ja' | 'en'): string {
  return lang === 'ja'
    ? '議長が結論を執筆中です — 結論が出たら、フォローアップで再開してください'
    : 'The chair is writing the conclusion — reopen with a follow-up once it lands';
}

/** The progress band's copy (round labels are ordinals, see ordinalOfRound). */
export function progressCopy(
  room: Pick<RoomView, 'participants' | 'chair' | 'archived' | 'turn_count'>,
  p: RoundProgress,
  lang: 'ja' | 'en',
  concluding: boolean,
  firstNameOf: (s: string) => string,
): { line: string; drafting?: string } {
  const n = room.participants.length;
  const chair = firstNameOf(room.chair);
  if (lang === 'ja') {
    if (room.archived) return { line: 'アーカイブ済み · 閲覧のみ' };
    if (p.phase === 'done') return { line: `結論が出ました · 第${p.roundOrdinal}ラウンドまで · ${room.turn_count}件の発言` };
    if (p.phase === 'conclusion')
      return { line: concluding ? '議論を打ち切って結論へ' : '全ラウンド終了', drafting: `議長の${chair}さんが結論を執筆中…` };
    return {
      line: `第${p.roundOrdinal}ラウンド / 全${p.ofRoundsOrdinal}ラウンド · ${n}人中${p.spoken.length}人が発言`,
      drafting: p.nextSpeaker ? `${firstNameOf(p.nextSpeaker)}さんが執筆中…` : undefined,
    };
  }
  if (room.archived) return { line: 'Archived · read-only' };
  if (p.phase === 'done') return { line: `Concluded after round ${p.roundOrdinal} · ${room.turn_count} turns` };
  if (p.phase === 'conclusion')
    return { line: concluding ? 'Concluding early' : 'All rounds done', drafting: `${chair} (chair) is writing the conclusion…` };
  return {
    line: `Round ${p.roundOrdinal} of ${p.ofRoundsOrdinal} · ${p.spoken.length}/${n} have spoken`,
    drafting: p.nextSpeaker ? `${firstNameOf(p.nextSpeaker)} is drafting…` : undefined,
  };
}

export interface TurnSection {
  /** Unique, stable React key. */
  key: string;
  label: string;
  kind: 'opening' | 'operator' | 'round' | 'conclusion';
  /** Debate round for `kind === 'round'` — stored (absolute); the label
   *  carries its ordinal. */
  round?: number;
  turns: TurnView[];
}

const SECTION_LABELS = {
  en: { opening: 'Opening', operator: 'Operator', round: (n: number) => `Round ${n}`, conclusion: 'Conclusion' },
  ja: { opening: '論点', operator: 'オペレーター', round: (n: number) => `第${n}ラウンド`, conclusion: '結論' },
} as const;

/** Section label for a debate round / phase in the given language. */
export function sectionLabel(kind: TurnSection['kind'], lang: 'ja' | 'en', round = 0): string {
  const l = SECTION_LABELS[lang];
  return kind === 'round' ? l.round(round) : l[kind];
}

/**
 * Group a room's turns into ordered sections for the timeline. Grouping is
 * by CONTIGUITY in chronological order, not a bucket per round: a steer
 * that lands mid-round sits where it happened (between that round's
 * statements), and a reopened room reads Conclusion → Operator → Round N+1
 * → Conclusion, top to bottom, the way it unfolded. Round labels are
 * ordinals (a reopened 3 × 2 room's stored round 4 reads "Round 3").
 */
export function groupTurnsByRound(turns: ReadonlyArray<TurnView>, lang: 'ja' | 'en' = 'en'): TurnSection[] {
  const ordinals = debateRoundOrdinals(turns);
  const sections: TurnSection[] = [];
  for (const t of [...turns].sort(compareTurns)) {
    const kind: TurnSection['kind'] =
      t.kind === 'opening' ? 'opening' : t.kind === 'steer' ? 'operator' : t.kind === 'conclusion' ? 'conclusion' : 'round';
    const id = kind === 'round' ? `round-${t.round}` : kind;
    const last = sections[sections.length - 1];
    if (last && last.key.split('@')[0] === id) {
      last.turns.push(t);
      continue;
    }
    sections.push({
      key: `${id}@${t.turn_id}`,
      label: sectionLabel(kind, lang, ordinals.get(t.round) ?? t.round),
      kind,
      ...(kind === 'round' ? { round: t.round } : {}),
      turns: [t],
    });
  }
  return sections;
}

/** Split a plain-text turn body into paragraphs (blank-line separated). */
export function paragraphsOf(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
