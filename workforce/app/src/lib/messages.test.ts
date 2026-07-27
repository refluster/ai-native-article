// Unit tests for the lib/messages write path (Epic-013 Story 2b).
//   - messagingWriteEnabled — pure config gate.
//   - createThread / sendMessage / markThreadRead / setThreadStar —
//     signedFetch (SigV4-mocked), AWS_IAM routes (PR 266).
//   - fetchThreadSummaries — global fetch (public read, no SigV4).
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

import { signedFetch, assertSigv4Configured } from '../lib/sigv4';
import {
  messagingWriteEnabled,
  isAwaitingReply,
  createThread,
  sendMessage,
  markThreadRead,
  setThreadStar,
  fetchThreadSummaries,
  fetchThreadDetail,
  mergeMessages,
  type ChatMessage,
  type Conversation,
} from './messages';

const mockedSignedFetch = vi.mocked(signedFetch);
const mockedAssertSigv4 = vi.mocked(assertSigv4Configured);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  mockedSignedFetch.mockReset();
  mockedAssertSigv4.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('messagingWriteEnabled', () => {
  it('is true when the API base is set AND SigV4 is configured', () => {
    expect(messagingWriteEnabled()).toBe(true);
  });
});

describe('isAwaitingReply', () => {
  const conv = (
    over: Partial<Conversation> & { messages: Conversation['messages'] },
  ): Conversation => ({
    id: '01THREAD',
    participants: ['maya'],
    group: false,
    starred: false,
    unread: 0,
    ...over,
  });
  const NOW = 1_000_000;

  it('is true on a 1:1 thread whose last message is the operator and within the window', () => {
    const c = conv({ messages: [{ from: 'operator', at: 'x', body: 'ping' }] });
    expect(isAwaitingReply(c, NOW + 5000, NOW)).toBe(true);
  });

  it('is false once the window has expired', () => {
    const c = conv({ messages: [{ from: 'operator', at: 'x', body: 'ping' }] });
    expect(isAwaitingReply(c, NOW - 1, NOW)).toBe(false);
  });

  it('is false when the last message is already a talent reply', () => {
    const c = conv({
      messages: [
        { from: 'operator', at: 'x', body: 'ping' },
        { from: 'maya', at: 'y', body: 'pong' },
      ],
    });
    expect(isAwaitingReply(c, NOW + 5000, NOW)).toBe(false);
  });

  it('is false for group threads, undefined until, or undefined conv', () => {
    const g = conv({ group: true, messages: [{ from: 'operator', at: 'x', body: 'ping' }] });
    expect(isAwaitingReply(g, NOW + 5000, NOW)).toBe(false);
    const c = conv({ messages: [{ from: 'operator', at: 'x', body: 'ping' }] });
    expect(isAwaitingReply(c, undefined, NOW)).toBe(false);
    expect(isAwaitingReply(undefined, NOW + 5000, NOW)).toBe(false);
  });
});

describe('createThread', () => {
  it('POSTs {participants:[slug], body} via signedFetch and returns thread_id', async () => {
    mockedSignedFetch.mockResolvedValueOnce(jsonResponse({ thread_id: '01THREAD' }, 201));

    const id = await createThread(['maya'], 'hello there');

    expect(id).toBe('01THREAD');
    expect(mockedAssertSigv4).toHaveBeenCalledTimes(1);

    const [url, init] = mockedSignedFetch.mock.calls[0];
    expect(url).toBe('https://agents.example/api/threads');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ participants: ['maya'], body: 'hello there' });
  });

  it('POSTs multiple participants (group thread) and the optional label', async () => {
    mockedSignedFetch.mockResolvedValueOnce(jsonResponse({ thread_id: '01GROUP' }, 201));

    const id = await createThread(['elena', 'aoi', 'kai'], 'settling it here', 'Elena + reports');

    expect(id).toBe('01GROUP');
    const [, init] = mockedSignedFetch.mock.calls[0];
    expect(JSON.parse(init?.body as string)).toEqual({
      participants: ['elena', 'aoi', 'kai'],
      body: 'settling it here',
      group_label: 'Elena + reports',
    });
  });

  it('folds the handler error body into the thrown message', async () => {
    mockedSignedFetch.mockResolvedValueOnce(
      jsonResponse({ error: 'create_failed', detail: 'empty body' }, 400),
    );

    await expect(createThread(['maya'], '')).rejects.toThrow(/agents-api 400.*create_failed.*empty body/);
  });
});

describe('sendMessage', () => {
  it('POSTs {body} to /threads/{id}/messages', async () => {
    mockedSignedFetch.mockResolvedValueOnce(jsonResponse({ message_id: '01MSG' }, 201));

    await sendMessage('01THREAD', 'a reply');

    const [url, init] = mockedSignedFetch.mock.calls[0];
    expect(url).toBe('https://agents.example/api/threads/01THREAD/messages');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ body: 'a reply' });
  });

  it('percent-encodes the thread id', async () => {
    mockedSignedFetch.mockResolvedValueOnce(jsonResponse({}, 201));
    await sendMessage('a/b', 'x');
    expect(mockedSignedFetch.mock.calls[0][0]).toBe('https://agents.example/api/threads/a%2Fb/messages');
  });
});

describe('markThreadRead', () => {
  it('POSTs to /threads/{id}/read with no body', async () => {
    mockedSignedFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await markThreadRead('01THREAD');

    const [url, init] = mockedSignedFetch.mock.calls[0];
    expect(url).toBe('https://agents.example/api/threads/01THREAD/read');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
  });
});

describe('setThreadStar', () => {
  it('POSTs {starred} to /threads/{id}/star', async () => {
    mockedSignedFetch.mockResolvedValueOnce(jsonResponse({ ok: true, starred: true }));

    await setThreadStar('01THREAD', true);

    const [url, init] = mockedSignedFetch.mock.calls[0];
    expect(url).toBe('https://agents.example/api/threads/01THREAD/star');
    expect(JSON.parse(init?.body as string)).toEqual({ starred: true });
  });
});

describe('fetchThreadDetail (Epic-024 paging)', () => {
  const detailDto = {
    thread_id: '01THREAD',
    participants: ['maya'],
    group: false,
    starred: false,
    created_by: 'operator',
    created_at: '2026-07-01T00:00:00Z',
    messages: [
      { message_id: '01A', from: 'operator', at: '2026-07-01T00:01:00Z', body: 'ping' },
      { message_id: '01B', from: 'maya', at: '2026-07-01T00:02:00Z', body: 'pong' },
    ],
    older_cursor: 'CURSOR1',
  };

  it('GETs the latest page with no query params by default', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(jsonResponse(detailDto));

    const conv = await fetchThreadDetail('01THREAD');

    expect(globalThis.fetch).toHaveBeenCalledWith('https://agents.example/api/threads/01THREAD');
    expect(conv?.messages.map((m) => m.id)).toEqual(['01A', '01B']);
    expect(conv?.olderCursor).toBe('CURSOR1');
  });

  it('passes cursor and page_size through as query params', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse({ ...detailDto, older_cursor: undefined }),
    );

    const conv = await fetchThreadDetail('01THREAD', { cursor: 'CURSOR1', pageSize: 30 });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://agents.example/api/threads/01THREAD?cursor=CURSOR1&page_size=30',
    );
    expect(conv?.olderCursor).toBeUndefined();
  });
});

describe('mergeMessages', () => {
  const msg = (id: string, at: string): ChatMessage => ({ id, from: 'maya', at, body: `m-${id}` });

  it('prepends an older page ahead of the loaded history, chronologically', () => {
    const loaded = [msg('01C', '2026-07-01T00:03:00Z'), msg('01D', '2026-07-01T00:04:00Z')];
    const older = [msg('01A', '2026-07-01T00:01:00Z'), msg('01B', '2026-07-01T00:02:00Z')];
    expect(mergeMessages(older, loaded).map((m) => m.id)).toEqual(['01A', '01B', '01C', '01D']);
  });

  it('drops duplicates when a re-fetched newest page overlaps loaded history', () => {
    const loaded = [msg('01A', '2026-07-01T00:01:00Z'), msg('01B', '2026-07-01T00:02:00Z')];
    const fresh = [msg('01B', '2026-07-01T00:02:00Z'), msg('01C', '2026-07-01T00:03:00Z')];
    expect(mergeMessages(loaded, fresh).map((m) => m.id)).toEqual(['01A', '01B', '01C']);
  });

  it('tie-breaks same-timestamp messages by ULID order', () => {
    const at = '2026-07-01T00:01:00Z';
    expect(mergeMessages([msg('01B', at)], [msg('01A', at)]).map((m) => m.id)).toEqual(['01A', '01B']);
  });

  it('de-dupes id-less (mock/summary) messages by content', () => {
    const m: ChatMessage = { from: 'maya', at: '2026-07-01T00:01:00Z', body: 'hi' };
    expect(mergeMessages([m], [{ ...m }])).toHaveLength(1);
  });
});

describe('fetchThreadSummaries', () => {
  it('GETs /threads via plain fetch (no SigV4) and maps summaries', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse({
        threads: [
          {
            thread_id: '01THREAD',
            participants: ['maya'],
            group: false,
            starred: true,
            unread: 2,
            last_message: { from: 'maya', at: '2026-06-02T09:10:00Z', preview: 'hi' },
          },
        ],
      }),
    );

    const out = await fetchThreadSummaries();

    expect(globalThis.fetch).toHaveBeenCalledWith('https://agents.example/api/threads');
    expect(mockedSignedFetch).not.toHaveBeenCalled();
    expect(out).toEqual([
      {
        id: '01THREAD',
        participants: ['maya'],
        group: false,
        groupLabel: undefined,
        starred: true,
        unread: 2,
        messages: [{ from: 'maya', at: '2026-06-02T09:10:00Z', body: 'hi' }],
      },
    ]);
  });
});
