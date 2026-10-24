// Unit tests for lib/rooms — the pure helpers the Room pages derive their
// state from (merge, progress band, timeline grouping, language), plus the
// read/write wire calls (plain fetch for reads, SigV4 for writes).
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
  concludeRoom,
  createRoom,
  fetchRoom,
  fetchRooms,
  groupTurnsByRound,
  isDeliberating,
  lastTurnId,
  mergeTurns,
  paragraphsOf,
  patchRoom,
  questionLanguage,
  roomsWriteEnabled,
  roundProgress,
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

  it('after a reopen: one more round (3 of 3), counted only from the new run', () => {
    const before = [
      opening(),
      ...[1, 2].flatMap((r) => MEMBERS.map((m) => say(m, r))),
      turn({ kind: 'conclusion', from: 'nadia', round: 3 }),
      turn({ kind: 'steer', from: 'operator', round: 0, run_id: RUN2 }),
    ];
    const reopened = room({ run_id: RUN2, run_count: 2 });
    const fresh = roundProgress(reopened, before);
    expect(fresh).toMatchObject({ round: 3, ofRounds: 3, spoken: [], pending: MEMBERS, nextSpeaker: 'nadia', phase: 'debate' });

    const mid = roundProgress(reopened, [...before, say('nadia', 3, RUN2)]);
    expect(mid).toMatchObject({ round: 3, ofRounds: 3, spoken: ['nadia'], pending: ['dario', 'freya'], nextSpeaker: 'dario' });

    // Same answer if the backend stores rounds=1 on META for the reopen.
    expect(roundProgress({ ...reopened, rounds: 1 }, [...before, say('nadia', 3, RUN2)])).toMatchObject({ round: 3, ofRounds: 3 });
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
    const before = [opening(), ...[1, 2].flatMap((r) => MEMBERS.map((m) => say(m, r)))];
    const reopened = room({ run_id: RUN2, run_count: 2, run_start_round: 3, run_rounds: 1 });
    expect(roundProgress(reopened, before)).toMatchObject({ round: 3, ofRounds: 3, pending: MEMBERS, phase: 'debate' });
    const first = room({ run_start_round: 1, run_rounds: 3 });
    expect(roundProgress(first, [opening(), say('nadia', 1)])).toMatchObject({ round: 1, ofRounds: 3, spoken: ['nadia'] });
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

  it('uses Japanese labels for a Japanese question', () => {
    const turns = [opening(), turn({ kind: 'steer', from: 'operator', round: 0 }), say('nadia', 2), turn({ kind: 'conclusion', from: 'nadia', round: 3 })];
    expect(groupTurnsByRound(turns, 'ja').map((s) => s.label)).toEqual(['論点', 'オペレーター', '第2回', '結論']);
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
