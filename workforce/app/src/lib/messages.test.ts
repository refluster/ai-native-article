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
  createThread,
  sendMessage,
  markThreadRead,
  setThreadStar,
  fetchThreadSummaries,
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

describe('createThread', () => {
  it('POSTs {participants:[slug], body} via signedFetch and returns thread_id', async () => {
    mockedSignedFetch.mockResolvedValueOnce(jsonResponse({ thread_id: '01THREAD' }, 201));

    const id = await createThread('maya', 'hello there');

    expect(id).toBe('01THREAD');
    expect(mockedAssertSigv4).toHaveBeenCalledTimes(1);

    const [url, init] = mockedSignedFetch.mock.calls[0];
    expect(url).toBe('https://agents.example/api/threads');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ participants: ['maya'], body: 'hello there' });
  });

  it('folds the handler error body into the thrown message', async () => {
    mockedSignedFetch.mockResolvedValueOnce(
      jsonResponse({ error: 'create_failed', detail: 'empty body' }, 400),
    );

    await expect(createThread('maya', '')).rejects.toThrow(/agents-api 400.*create_failed.*empty body/);
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
