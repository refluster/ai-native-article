// Unit tests for lib/boards.ts — the pure helpers behind the /boards/:id
// page (post merging, mention splitting, the @-completion probe, the
// roster ranking, guest initials) and the fetch wrappers' auth + error
// contract. fetch is stubbed; nothing here touches the network.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/api', () => ({
  WORKFORCE_AGENTS_API_BASE: 'https://agents.example/api',
}));

import {
  BoardApiError,
  applyMention,
  cascadeRootOf,
  clearBoardSession,
  pendingDelegates,
  createPost,
  enterBoard,
  fetchPostsAfter,
  initialsOf,
  loadBoardSession,
  mergePosts,
  probeMention,
  rankAgents,
  saveBoardSession,
  splitMentions,
  type BoardAgent,
  type BoardPost,
} from './boards';

function post(id: string, extra: Partial<BoardPost> = {}): BoardPost {
  return { post_id: id, author_kind: 'human', author: 'Hana', at: 't', body: id, hop: 0, mentions: [], ...extra };
}

describe('mergePosts', () => {
  it('unions by post id and orders by id (ULID order)', () => {
    const merged = mergePosts([post('01B'), post('01A')], [post('01C'), post('01B', { body: 'newer copy' })]);
    expect(merged.map((p) => p.post_id)).toEqual(['01A', '01B', '01C']);
    expect(merged[1].body).toBe('newer copy');
  });
});

describe('cascadeRootOf / pendingDelegates', () => {
  const roster = new Set(['maya', 'dario', 'ren']);
  const guest = post('01A', { body: 'Q @maya', mentions: ['maya'] });
  const answer = post('01B', { author_kind: 'agent', author: 'maya', hop: 1, reply_to: '01A', mentions: ['dario', 'ren'], body: 'ask @dario' });

  it('walks reply links up to the guest post', () => {
    const byId = new Map([guest, answer].map((p) => [p.post_id, p]));
    expect(cascadeRootOf(answer, byId).post_id).toBe('01A');
    expect(cascadeRootOf(guest, byId).post_id).toBe('01A');
  });

  it('names the first roster colleague a hop-1 answer hands over to', () => {
    expect(pendingDelegates(answer, [guest, answer], roster)).toEqual(['dario']);
  });

  it('is empty for human posts, hop-2 answers, self-mentions and colleagues who already answered', () => {
    expect(pendingDelegates(guest, [guest], roster)).toEqual([]);
    expect(pendingDelegates({ ...answer, hop: 2 }, [guest, answer], roster)).toEqual([]);
    expect(pendingDelegates({ ...answer, mentions: ['maya'] }, [guest, answer], roster)).toEqual([]);
    const dariosEarlier = post('01C', { author_kind: 'agent', author: 'dario', hop: 1, reply_to: '01A', mentions: [] });
    expect(pendingDelegates(answer, [guest, dariosEarlier, answer], roster)).toEqual(['ren']);
    expect(pendingDelegates({ ...answer, mentions: ['nobody'] }, [guest, answer], roster)).toEqual([]);
  });
});

describe('splitMentions', () => {
  const known = new Set(['maya', 'dario']);

  it('marks roster mentions and leaves unknown handles as text', () => {
    expect(splitMentions('Hi @Maya, ask @nobody or @dario.', known)).toEqual([
      { kind: 'text', text: 'Hi ' },
      { kind: 'mention', slug: 'maya', text: '@Maya' },
      { kind: 'text', text: ', ask @nobody or ' },
      { kind: 'mention', slug: 'dario', text: '@dario' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('returns one text segment when nothing matches', () => {
    expect(splitMentions('plain', known)).toEqual([{ kind: 'text', text: 'plain' }]);
    expect(splitMentions('mail@maya.example', known)).toEqual([{ kind: 'text', text: 'mail@maya.example' }]);
  });
});

describe('probeMention / applyMention', () => {
  it('detects an @handle under the caret and replaces it', () => {
    const text = 'Ask @ma about it';
    const probe = probeMention(text, 7);
    expect(probe).toEqual({ start: 4, query: 'ma' });
    expect(applyMention(text, probe!, 'maya')).toEqual({ text: 'Ask @maya  about it', caret: 10 });
  });

  it('is inert outside a handle, after a space, or glued to a word', () => {
    expect(probeMention('Ask maya', 8)).toBeUndefined();
    expect(probeMention('Ask @maya ', 10)).toBeUndefined();
    expect(probeMention('mail@ma', 7)).toBeUndefined();
    expect(probeMention('@', 1)).toEqual({ start: 0, query: '' });
  });
});

describe('rankAgents', () => {
  const agents: BoardAgent[] = [
    { slug: 'maya', name: 'Maya Ishikawa', role: 'Product manager' },
    { slug: 'mateo', name: 'Mateo Ruiz', role: 'Platform' },
    { slug: 'dario', name: 'Dario Bianchi', role: 'Governance architect' },
    { slug: 'ren', name: 'Ren Sato', role: 'Engineer' },
  ];

  it('puts slug-prefix hits first, then name/role substring hits, capped', () => {
    expect(rankAgents(agents, 'ma').map((a) => a.slug)).toEqual(['maya', 'mateo']);
    expect(rankAgents(agents, 'gov').map((a) => a.slug)).toEqual(['dario']);
    expect(rankAgents(agents, '', 2).map((a) => a.slug)).toEqual(['maya', 'mateo']);
  });
});

describe('initialsOf', () => {
  it('handles latin, single, and CJK names', () => {
    expect(initialsOf('Hana Sato')).toBe('HS');
    expect(initialsOf('hana')).toBe('HA');
    expect(initialsOf('上原')).toBe('上');
    expect(initialsOf('  ')).toBe('?');
  });
});

describe('session storage', () => {
  beforeEach(() => window.localStorage.clear());

  it('round-trips, drops expired, and clears', () => {
    saveBoardSession('demo', { token: 't', nickname: 'Hana', expires_at: new Date(Date.now() + 60_000).toISOString() });
    expect(loadBoardSession('demo')?.nickname).toBe('Hana');
    saveBoardSession('old', { token: 't', nickname: 'Hana', expires_at: new Date(Date.now() - 1).toISOString() });
    expect(loadBoardSession('old')).toBeUndefined();
    clearBoardSession('demo');
    expect(loadBoardSession('demo')).toBeUndefined();
  });
});

describe('API wrappers', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function ok(body: unknown, status = 200) {
    return { ok: status < 400, status, json: async () => body } as unknown as Response;
  }

  it('enterBoard posts password + nickname and returns the session + board', async () => {
    fetchMock.mockResolvedValueOnce(ok({ token: 'tok', nickname: 'Hana', expires_at: 'x', board: { board_id: 'demo', name: 'D', created_at: 't', agents: [] } }));
    const res = await enterBoard('demo', 'pw', 'Hana');
    expect(res.session).toEqual({ token: 'tok', nickname: 'Hana', expires_at: 'x' });
    expect(res.board.name).toBe('D');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://agents.example/api/boards/demo/enter');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ password: 'pw', nickname: 'Hana' });
  });

  it('sends the board token as a Bearer header on gated calls', async () => {
    fetchMock.mockResolvedValueOnce(ok({ posts: [] }));
    await fetchPostsAfter('demo', 'tok', '01A');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://agents.example/api/boards/demo/posts?after=01A');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('surfaces the API error code + status as BoardApiError', async () => {
    fetchMock.mockResolvedValueOnce(ok({ error: 'invalid_token' }, 401));
    await expect(createPost('demo', 'tok', 'hi')).rejects.toMatchObject({ status: 401, code: 'invalid_token' });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => { throw new Error('nope'); } } as unknown as Response);
    await expect(createPost('demo', 'tok', 'hi')).rejects.toBeInstanceOf(BoardApiError);
  });
});
