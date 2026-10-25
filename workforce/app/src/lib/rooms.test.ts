// Unit tests for lib/rooms — the pure helpers the Room pages derive their
// state from (merge, progress band + its copy, ordinal round labels,
// timeline grouping, language, the steer lock, stall / poll health), plus
// the read/write wire calls (plain fetch for reads, SigV4 for writes).
//
// Every fixture uses the backend's real round numbering (agents-api
// maxAgentRound + 1): a 3 × 2 room's statements sit at rounds 1, 2, its
// conclusion at 3, a reopen's statements at 4 and conclusion at 5, and a
// later Conclude now at 6.
//
// sigv4 is mocked wholesale so these never touch AWS or read Cognito env.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/sigv4', () => ({
  signedFetch: vi.fn(),
  assertSigv4Configured: vi.fn(),
}));

vi.mock('../config/api', () => ({
  WORKFORCE_AGENTS_API_BASE: 'https://agents.example/api',
}));

vi.mock('../config/auth', () => ({
  SIGV4_IS_CONFIGURED: true,
}));

import { signedFetch } from '../lib/sigv4';
import {
  freshTurns,
  followTail,
  typingInComposer,
  POLL_FAILURE_THRESHOLD,
  STALL_MS,
  concludeRoom,
  createRoom,
  debateRoundOrdinals,
  fetchRoom,
  fetchRooms,
  groupTurnsByRound,
  isDeliberating,
  lastTurnId,
  mergeTurns,
  nextPollHealth,
  ordinalOfRound,
  paragraphsOf,
  patchRoom,
  pollCursor,
  pollErrorToShow,
  progressCopy,
  questionLanguage,
  roomsWriteEnabled,
  roundProgress,
  stallState,
  steerLocked,
  steerLockedCopy,
  steerRoom,
  summarizeQuestion,
  type RoomView,
  type TurnView,
} from './rooms';

const mockedSignedFetch = vi.mocked(signedFetch);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  mockedSignedFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Fixtures: a 3-member × 2-round room ─────────────────────────────────

const RUN1 = '01RUN1';
const RUN2 = '01RUN2';
const MEMBERS = ['nadia', 'dario', 'freya'];

function room(over: Partial<RoomView> = {}): RoomView {
  return {
    room_id: '01ROOM',
    title: 'Pricing',
    question: 'Should we raise the price?',
    status: 'debating',
    participants: MEMBERS,
    chair: 'nadia',
    rounds: 2,
    run_count: 1,
    created_at: '2026-10-24T00:00:00.000Z',
    last_turn_at: '2026-10-24T00:00:00.000Z',
    turn_count: 1,
    run_id: RUN1,
    ...over,
  };
}

let seq = 0;
function turn(over: Partial<TurnView> & Pick<TurnView, 'kind' | 'from' | 'round'>): TurnView {
  seq += 1;
  const n = String(seq).padStart(4, '0');
  return {
    turn_id: `01T${n}`,
    room_id: '01ROOM',
    run_id: RUN1,
    at: `2026-10-24T00:${String(Math.floor(seq / 60)).padStart(2, '0')}:${String(seq % 60).padStart(2, '0')}.000Z`,
    body: `body ${n}`,
    ...over,
  };
}

function opening(): TurnView {
  return turn({ kind: 'opening', from: 'operator', round: 0, body: 'Should we raise the price?' });
}
function say(from: string, round: number, run_id = RUN1): TurnView {
  return turn({ kind: 'statement', from, round, run_id, position: `${from} holds a view` });
}

const RUN3 = '01RUN3';

/** A 3 × 2 room through its first conclusion (round 3) and a reopening
 *  steer on RUN2 — what the backend actually stores. */
function concludedThenReopened(): TurnView[] {
  return [
    opening(),
    ...[1, 2].flatMap((r) => MEMBERS.map((m) => say(m, r))),
    turn({ kind: 'conclusion', from: 'nadia', round: 3 }),
    turn({ kind: 'steer', from: 'operator', round: 0, run_id: RUN2 }),
  ];
}

beforeEach(() => {
  seq = 0;
});

// ── mergeTurns ──────────────────────────────────────────────────────────

describe('mergeTurns', () => {
  it('dedupes by turn_id and sorts chronologically', () => {
    const a = opening();
    const b = say('nadia', 1);
    const c = say('dario', 1);
    const merged = mergeTurns([c, a], [b, c]);
    expect(merged.map((t) => t.turn_id)).toEqual([a.turn_id, b.turn_id, c.turn_id]);
  });

  it('tie-breaks same-instant turns by id', () => {
    const at = '2026-10-24T01:00:00.000Z';
    const x = { ...say('nadia', 1), turn_id: '01B', at };
    const y = { ...say('dario', 1), turn_id: '01A', at };
    expect(mergeTurns([x], [y]).map((t) => t.turn_id)).toEqual(['01A', '01B']);
  });

  it('lets the later copy of a turn win', () => {
    const t = say('nadia', 1);
    const fresh = { ...t, body: 'edited' };
    expect(mergeTurns([t], [fresh])[0]!.body).toBe('edited');
  });

  it('lastTurnId is the max ULID', () => {
    expect(lastTurnId([])).toBeUndefined();
    expect(lastTurnId([{ ...opening(), turn_id: '01C' }, { ...opening(), turn_id: '01Z' }, { ...opening(), turn_id: '01A' }])).toBe('01Z');
  });

  it('pollCursor trails the newest turn by the overlap window, so a late-visible smaller id is not skipped', () => {
    const at = (s: number) => new Date(Date.UTC(2026, 9, 24, 0, 0, s)).toISOString();
    const a = { ...opening(), turn_id: '01A', at: at(0) };
    const b = { ...opening(), turn_id: '01B', at: at(20) };
    const steer = { ...opening(), turn_id: '01D', at: at(50) };
    // Young room: nothing is older than the window → full read.
    expect(pollCursor([a, b], 30_000)).toBeUndefined();
    // The cursor is the newest turn ≥ 30 s older than the newest (01B at
    // 20 s vs 01D at 50 s), so an agent turn 01C minted at 49 s but stored
    // after the steer was polled still comes back on the next tail …
    expect(pollCursor([a, b, steer], 30_000)).toBe('01B');
    const late = { ...opening(), turn_id: '01C', at: at(49) };
    expect('01C' > '01B').toBe(true);
    // … and the overlap re-read folds in without duplicates.
    expect(mergeTurns([a, b, steer], [steer, late]).map((t) => t.turn_id)).toEqual(['01A', '01B', '01C', '01D']);
    expect(pollCursor([])).toBeUndefined();
  });
});

// ── roundProgress ───────────────────────────────────────────────────────

describe('roundProgress', () => {
  it('starts at round 1 of 2 with the first member drafting', () => {
    const p = roundProgress(room(), [opening()]);
    expect(p).toMatchObject({ round: 1, ofRounds: 2, spoken: [], pending: MEMBERS, nextSpeaker: 'nadia', phase: 'debate' });
  });

  it('mid-way through round 2 (3 members × 2 rounds)', () => {
    const turns = [opening(), say('nadia', 1), say('dario', 1), say('freya', 1), say('nadia', 2)];
    const p = roundProgress(room(), turns);
    expect(p.round).toBe(2);
    expect(p.ofRounds).toBe(2);
    expect(p.spoken).toEqual(['nadia']);
    expect(p.pending).toEqual(['dario', 'freya']);
    expect(p.nextSpeaker).toBe('dario');
    expect(p.phase).toBe('debate');
  });

  it('moves on to the next round once a round is complete', () => {
    const turns = [opening(), say('nadia', 1), say('dario', 1), say('freya', 1)];
    const p = roundProgress(room(), turns);
    expect(p).toMatchObject({ round: 2, spoken: [], pending: MEMBERS, nextSpeaker: 'nadia' });
  });

  it('hands to the chair once every round is complete', () => {
    const turns = [opening(), ...[1, 2].flatMap((r) => MEMBERS.map((m) => say(m, r)))];
    const p = roundProgress(room(), turns);
    expect(p).toMatchObject({ round: 2, ofRounds: 2, pending: [], nextSpeaker: 'nadia', phase: 'conclusion' });
  });

  it('is done after the conclusion', () => {
    const turns = [
      opening(),
      ...[1, 2].flatMap((r) => MEMBERS.map((m) => say(m, r))),
      turn({ kind: 'conclusion', from: 'nadia', round: 3 }),
    ];
    const p = roundProgress(room({ status: 'concluded' }), turns);
    expect(p).toMatchObject({ round: 2, ofRounds: 2, spoken: MEMBERS, pending: [], phase: 'done' });
    expect(p.nextSpeaker).toBeUndefined();
  });

  it('after a reopen: stored round 4 (after the round-3 conclusion) reads as round 3 of 3, counted only from the new run', () => {
    const before = concludedThenReopened();
    // Derived from the turns alone (no run plan on the view).
    const reopened = room({ run_id: RUN2, run_count: 2 });
    const fresh = roundProgress(reopened, before);
    expect(fresh).toMatchObject({
      round: 4,
      ofRounds: 4,
      roundOrdinal: 3,
      ofRoundsOrdinal: 3,
      spoken: [],
      pending: MEMBERS,
      nextSpeaker: 'nadia',
      phase: 'debate',
    });

    const mid = roundProgress(reopened, [...before, say('nadia', 4, RUN2)]);
    expect(mid).toMatchObject({ round: 4, roundOrdinal: 3, ofRoundsOrdinal: 3, spoken: ['nadia'], pending: ['dario', 'freya'], nextSpeaker: 'dario' });

    // Same answer from the API's run plan.
    const planned = room({ run_id: RUN2, run_count: 2, run_start_round: 4, run_rounds: 1 });
    expect(roundProgress(planned, [...before, say('nadia', 4, RUN2)])).toMatchObject({ round: 4, roundOrdinal: 3, ofRoundsOrdinal: 3 });
    expect(progressCopy(planned, roundProgress(planned, before), false, (s) => s).line).toBe('Round 3 of 3 · 0/3 have spoken');
  });

  it('a later Conclude now (stored round 6) reports the last debate round reached — "Concluded after round 3"', () => {
    const turns = [
      ...concludedThenReopened(),
      ...MEMBERS.map((m) => say(m, 4, RUN2)),
      turn({ kind: 'conclusion', from: 'nadia', round: 5, run_id: RUN2 }),
    ];
    const concluding = room({ run_id: RUN3, run_count: 3, run_start_round: 6, run_rounds: 0 });
    const p = roundProgress(concluding, turns);
    expect(p).toMatchObject({ round: 4, roundOrdinal: 3, ofRoundsOrdinal: 3, spoken: MEMBERS, phase: 'conclusion', nextSpeaker: 'nadia' });
    const done = [...turns, turn({ kind: 'conclusion', from: 'nadia', round: 6, run_id: RUN3 })];
    const after = roundProgress({ ...concluding, status: 'concluded' }, done);
    expect(after.phase).toBe('done');
    expect(progressCopy({ ...concluding, turn_count: 18 }, after, true, (s) => s).line).toBe(
      'Concluded after round 3 · 18 turns',
    );
  });

  it('a "Conclude now" run goes straight to the chair', () => {
    const turns = [opening(), say('nadia', 1)];
    const p = roundProgress(room({ run_id: RUN2 }), turns, { concluding: true });
    expect(p).toMatchObject({ round: 1, ofRounds: 1, spoken: ['nadia'], phase: 'conclusion', nextSpeaker: 'nadia' });
    // Same from the API's run plan (run_rounds 0 = conclusion only).
    const planned = room({ run_id: RUN2, run_start_round: 2, run_rounds: 0 });
    expect(roundProgress(planned, turns)).toMatchObject({ round: 1, ofRounds: 1, phase: 'conclusion', nextSpeaker: 'nadia' });
  });

  it('prefers the API run plan (run_start_round / run_rounds) when present', () => {
    const reopened = room({ run_id: RUN2, run_count: 2, run_start_round: 4, run_rounds: 1 });
    expect(roundProgress(reopened, concludedThenReopened())).toMatchObject({ round: 4, ofRounds: 4, pending: MEMBERS, phase: 'debate' });
    const first = room({ rounds: 3, run_start_round: 1, run_rounds: 3 });
    expect(roundProgress(first, [opening(), say('nadia', 1)])).toMatchObject({
      round: 1,
      ofRounds: 3,
      roundOrdinal: 1,
      ofRoundsOrdinal: 3,
      spoken: ['nadia'],
    });
  });
});

// ── Ordinal round labels ────────────────────────────────────────────────

describe('ordinalOfRound / debateRoundOrdinals', () => {
  it('counts debate rounds only: stored 1, 2, 4 → 1, 2, 3 (the conclusions at 3, 5, 6 take no ordinal)', () => {
    const turns = [
      ...concludedThenReopened(),
      ...MEMBERS.map((m) => say(m, 4, RUN2)),
      turn({ kind: 'conclusion', from: 'nadia', round: 5, run_id: RUN2 }),
      turn({ kind: 'conclusion', from: 'nadia', round: 6, run_id: RUN3 }),
    ];
    expect([...debateRoundOrdinals(turns)]).toEqual([
      [1, 1],
      [2, 2],
      [4, 3],
    ]);
    expect(ordinalOfRound(turns, 4)).toBe(3);
    // Before any round-4 statement lands, round 4 already reads as the 3rd.
    expect(ordinalOfRound(concludedThenReopened(), 4)).toBe(3);
  });
});

// ── progressCopy (band wording — console chrome is English-only) ────────────────────────────────

describe('progressCopy', () => {
  const name = (s: string) => s;

  it('EN: round of rounds, spoken count, drafting line', () => {
    const p = roundProgress(room(), [opening(), say('nadia', 1), say('dario', 1), say('freya', 1), say('nadia', 2)]);
    expect(progressCopy(room(), p, false, name)).toEqual({
      line: 'Round 2 of 2 · 1/3 have spoken',
      drafting: 'dario is drafting…',
    });
  });

  it('stays English for a Japanese question (chrome is not localised; the body is)', () => {
    const r = room({ question: '値上げすべきか？' });
    const mid = roundProgress(r, [opening(), say('nadia', 1), say('dario', 1), say('freya', 1), say('nadia', 2)]);
    expect(progressCopy(r, mid, false, name).line).toBe('Round 2 of 2 · 1/3 have spoken');

    const all = [opening(), ...[1, 2].flatMap((x) => MEMBERS.map((m) => say(m, x)))];
    const done = roundProgress({ ...r, status: 'concluded' }, [...all, turn({ kind: 'conclusion', from: 'nadia', round: 3 })]);
    expect(progressCopy({ ...r, turn_count: 8 }, done, false, name).line).toBe('Concluded after round 2 · 8 turns');

    const early = roundProgress(room({ run_id: RUN2, run_start_round: 2, run_rounds: 0 }), [opening(), say('nadia', 1)]);
    expect(progressCopy(r, early, true, name).line).toBe('Concluding early');
    expect(progressCopy(r, roundProgress(r, all), false, name).line).toBe('All rounds done');

    // The reopened 3 × 2 room: stored round 4 is Round 3 of 3.
    const reopened = room({ question: '値上げすべきか？', run_id: RUN2, run_count: 2, run_start_round: 4, run_rounds: 1 });
    expect(progressCopy(reopened, roundProgress(reopened, concludedThenReopened()), false, name).line).toBe(
      'Round 3 of 3 · 0/3 have spoken',
    );
  });
});

// ── steerLocked (the composer while the chair concludes) ────────────────

describe('steerLocked', () => {
  it('locks the composer in the conclusion phase only', () => {
    const r = room();
    const all = [opening(), ...[1, 2].flatMap((x) => MEMBERS.map((m) => say(m, x)))];
    const concluding = roundProgress(r, all);
    expect(concluding.phase).toBe('conclusion');
    expect(steerLocked(r, concluding)).toBe(true);
    // Mid-debate a steer still has readers.
    const mid = roundProgress(r, all.slice(0, -1));
    expect(mid.phase).toBe('debate');
    expect(steerLocked(r, mid)).toBe(false);
    // A Conclude-now run is the conclusion phase too.
    const now = room({ run_id: RUN2, run_start_round: 2, run_rounds: 0 });
    expect(steerLocked(now, roundProgress(now, [opening(), say('nadia', 1)]))).toBe(true);
    // Concluded: the composer reopens instead.
    const concluded = room({ status: 'concluded' });
    expect(steerLocked(concluded, roundProgress(concluded, [...all, turn({ kind: 'conclusion', from: 'nadia', round: 3 })]))).toBe(false);
    expect(steerLocked(null, null)).toBe(false);
  });

  it('says why (English-only chrome)', () => {
    expect(steerLockedCopy()).toBe('The chair is writing the conclusion — reopen with a follow-up once it lands');
  });
});

// ── stallState / poll health ────────────────────────────────────────────

describe('stallState', () => {
  it('is idle unless deliberating, stalled after STALL_MS without progress, else live', () => {
    const t0 = Date.UTC(2026, 9, 24);
    expect(stallState(t0 + STALL_MS - 1, t0, room())).toBe('live');
    expect(stallState(t0 + STALL_MS, t0, room())).toBe('stalled');
    expect(stallState(t0 + 10 * STALL_MS, t0, room({ status: 'concluded' }))).toBe('idle');
    expect(stallState(t0 + 10 * STALL_MS, t0, room({ archived: true }))).toBe('idle');
    expect(stallState(t0, t0, null)).toBe('idle');
    expect(STALL_MS).toBe(180_000);
  });
});

describe('poll health', () => {
  it('shows the fetch error only after POLL_FAILURE_THRESHOLD consecutive failures; a success resets', () => {
    expect(POLL_FAILURE_THRESHOLD).toBe(3);
    let h = { failures: 0 };
    h = nextPollHealth(h, { ok: false, error: 'agents-api 502' });
    h = nextPollHealth(h, { ok: false, error: 'agents-api 504' });
    expect(pollErrorToShow(h)).toBeUndefined();
    h = nextPollHealth(h, { ok: false, error: 'Failed to fetch' });
    expect(pollErrorToShow(h)).toBe('Failed to fetch');
    h = nextPollHealth(h, { ok: true });
    expect(h).toEqual({ failures: 0 });
    expect(pollErrorToShow(h)).toBeUndefined();
  });
});

// ── isDeliberating / questionLanguage / summarizeQuestion ───────────────

describe('isDeliberating', () => {
  it('is true only for a debating, unarchived room', () => {
    expect(isDeliberating(room())).toBe(true);
    expect(isDeliberating(room({ status: 'concluded' }))).toBe(false);
    expect(isDeliberating(room({ archived: true }))).toBe(false);
    expect(isDeliberating(null)).toBe(false);
  });
});

describe('questionLanguage', () => {
  it('detects kana and kanji as Japanese', () => {
    expect(questionLanguage('価格を上げるべきか')).toBe('ja');
    expect(questionLanguage('Should we use カタカナ?')).toBe('ja');
    expect(questionLanguage('ひらがな')).toBe('ja');
    expect(questionLanguage('漢字')).toBe('ja');
  });
  it('defaults to English', () => {
    expect(questionLanguage('Should we raise the price?')).toBe('en');
    expect(questionLanguage('')).toBe('en');
  });
});

describe('summarizeQuestion', () => {
  it('collapses whitespace and clips with an ellipsis', () => {
    expect(summarizeQuestion('  a   b\n c ', 10)).toBe('a b c');
    expect(summarizeQuestion('abcdefghij', 5)).toBe('abcd…');
    expect(summarizeQuestion('価格を上げるべきか', 4)).toBe('価格を…');
  });
});

describe('paragraphsOf', () => {
  it('splits on blank lines', () => {
    expect(paragraphsOf('one\n\n two \n\n\nthree\nstill three')).toEqual(['one', 'two', 'three\nstill three']);
  });
});

// ── groupTurnsByRound ───────────────────────────────────────────────────

describe('groupTurnsByRound', () => {
  it('orders Opening → Round 1 → Operator → Round 1 → Round 2 → Conclusion', () => {
    const turns = [
      opening(),
      say('nadia', 1),
      turn({ kind: 'steer', from: 'operator', round: 0 }),
      say('dario', 1),
      say('nadia', 2),
      say('dario', 2),
      turn({ kind: 'conclusion', from: 'nadia', round: 3 }),
    ];
    const sections = groupTurnsByRound([...turns].reverse());
    expect(sections.map((s) => s.label)).toEqual(['Opening', 'Round 1', 'Operator', 'Round 1', 'Round 2', 'Conclusion']);
    expect(sections[4]!.turns.map((t) => t.from)).toEqual(['nadia', 'dario']);
    expect(sections[4]!.round).toBe(2);
    expect(new Set(sections.map((s) => s.key)).size).toBe(sections.length);
  });

  it('a reopened 3 × 2 room reads Round 1, Round 2, Conclusion, Operator, Round 3, Conclusion (stored rounds 1, 2, 3, 0, 4, 5)', () => {
    const turns = [
      ...concludedThenReopened(),
      ...MEMBERS.map((m) => say(m, 4, RUN2)),
      turn({ kind: 'conclusion', from: 'nadia', round: 5, run_id: RUN2 }),
    ];
    const sections = groupTurnsByRound(turns);
    expect(sections.map((s) => s.label)).toEqual(['Opening', 'Round 1', 'Round 2', 'Conclusion', 'Operator', 'Round 3', 'Conclusion']);
    // The section keeps the stored round; only the label is the ordinal.
    expect(sections[5]!.round).toBe(4);
  });

});

// ── Wire calls ──────────────────────────────────────────────────────────

describe('wire calls', () => {
  it('roomsWriteEnabled is true with an API base and SigV4', () => {
    expect(roomsWriteEnabled()).toBe(true);
  });

  it('fetchRooms reads /rooms with plain fetch', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ rooms: [room()], cursor: 'c1' }));
    const page = await fetchRooms({ pageSize: 50 });
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('https://agents.example/api/rooms?page_size=50');
    expect(page.rooms).toHaveLength(1);
    expect(page.cursor).toBe('c1');
  });

  it('fetchRoom passes ?after= and returns undefined on 404', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ room: room(), turns: [] }));
    const d = await fetchRoom('01ROOM', { after: '01T0003' });
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('https://agents.example/api/rooms/01ROOM?after=01T0003');
    expect(d?.room.room_id).toBe('01ROOM');
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: 'not_found' }, 404));
    expect(await fetchRoom('nope')).toBeUndefined();
  });

  it('createRoom POSTs signed and omits empty optionals', async () => {
    mockedSignedFetch.mockResolvedValueOnce(jsonResponse({ room_id: '01NEW' }, 201));
    const id = await createRoom({ title: 't', question: 'q', context: '', participants: ['a', 'b'], rounds: 2 });
    expect(id).toBe('01NEW');
    const [url, init] = mockedSignedFetch.mock.calls[0]!;
    expect(url).toBe('https://agents.example/api/rooms');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ title: 't', question: 'q', participants: ['a', 'b'], rounds: 2 });
  });

  it('steer / conclude / patch hit their routes', async () => {
    mockedSignedFetch
      .mockResolvedValueOnce(jsonResponse({ turn_id: '01S', reopened: true }, 201))
      .mockResolvedValueOnce(jsonResponse({ run_id: '01RUN9' }, 202))
      .mockResolvedValueOnce(jsonResponse({ room: room({ archived: true }) }));
    expect(await steerRoom('01ROOM', 'go deeper')).toEqual({ turn_id: '01S', reopened: true });
    expect(await concludeRoom('01ROOM')).toBe('01RUN9');
    expect((await patchRoom('01ROOM', { archived: true })).archived).toBe(true);
    const calls = mockedSignedFetch.mock.calls.map(([u, i]) => `${i?.method} ${String(u)}`);
    expect(calls).toEqual([
      'POST https://agents.example/api/rooms/01ROOM/turns',
      'POST https://agents.example/api/rooms/01ROOM/conclude',
      'PATCH https://agents.example/api/rooms/01ROOM',
    ]);
  });

  it('surfaces the error body on a failed write', async () => {
    mockedSignedFetch.mockResolvedValueOnce(jsonResponse({ error: 'room_archived' }, 409));
    await expect(steerRoom('01ROOM', 'x')).rejects.toThrow('agents-api 409 · room_archived');
  });
});

// ── freshTurns / followTail (the arrival rule, PR 854) ─────────────────────

describe('freshTurns', () => {
  it('returns only turns not yet seen, oldest → newest by compareTurns (never wire order)', () => {
    const a = say('nadia', 1);
    const b = say('dario', 1);
    const c = say('freya', 1);
    const seen = new Set([opening().turn_id, a.turn_id]);
    // The poll tail re-reads an overlap window: `a` comes back but is not fresh.
    expect(freshTurns([c, b, a], seen).map((t) => t.turn_id)).toEqual([b.turn_id, c.turn_id]);
  });
  it('is empty when everything in the tail is already on screen (overlap only)', () => {
    const a = say('nadia', 1);
    expect(freshTurns([a], new Set([a.turn_id]))).toEqual([]);
  });
});

describe('typingInComposer', () => {
  it('is typing only with focus AND a non-empty draft', () => {
    expect(typingInComposer({ id: 'room-steer', value: 'Consider cost' })).toBe(true);
    expect(typingInComposer({ id: 'room-steer', value: '  ' })).toBe(false); // sent with ⌘/Ctrl+Enter — keep following
    expect(typingInComposer({ id: 'room-steer' })).toBe(false);
    expect(typingInComposer({ id: 'search', value: 'x' })).toBe(false);
    expect(typingInComposer(null)).toBe(false);
  });
});

describe('followTail', () => {
  const near = { scrollTop: 1000, viewportHeight: 800, scrollHeight: 2200, composerFocused: false }; // 400px from the end
  it('follows when the reader is within a viewport of the end', () => {
    expect(followTail(near)).toBe(true);
    expect(followTail({ ...near, scrollTop: 600 })).toBe(true); // exactly one viewport
  });
  it('keeps the place of a reader who scrolled back', () => {
    expect(followTail({ ...near, scrollTop: 0 })).toBe(false);
  });
  it('never moves the page while the composer has focus', () => {
    expect(followTail({ ...near, composerFocused: true })).toBe(false);
  });
});
