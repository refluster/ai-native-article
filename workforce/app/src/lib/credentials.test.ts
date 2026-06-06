// Unit tests for lib/credentials.ts. Three surfaces:
//   - credentialsApiConfigured — pure config gate.
//   - fetchCredentials         — global fetch (no SigV4).
//   - putCredential / deleteCredential — signedFetch (SigV4-mocked).
//
// We mock lib/sigv4 wholesale so these tests never touch real AWS or
// even attempt to read Cognito env vars.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/sigv4', () => ({
  signedFetch: vi.fn(),
  assertSigv4Configured: vi.fn(),
}));

// Mock the config module so credentialsApiConfigured can be flipped
// per-test by re-importing with a fresh module registry.
vi.mock('../config/api', () => ({
  WORKFORCE_AGENTS_API_BASE: 'https://agents.example/api',
  WORKFORCE_CREDENTIALS_API_BASE: 'https://creds.example/api',
}));

import { signedFetch, assertSigv4Configured } from '../lib/sigv4';
import {
  CREDENTIAL_TYPES,
  credentialsApiConfigured,
  fetchCredentials,
  putCredential,
  deleteCredential,
} from './credentials';

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

describe('CREDENTIAL_TYPES', () => {
  it('matches the 5 canonical types in declaration order', () => {
    expect([...CREDENTIAL_TYPES]).toEqual([
      'anthropic.api_key',
      'discord.bot_token',
      'github.token',
      'notion.integration_token',
      'voyage.api_key',
    ]);
  });
});

describe('credentialsApiConfigured', () => {
  it('returns true when the mocked base is set', () => {
    expect(credentialsApiConfigured()).toBe(true);
  });
});

describe('fetchCredentials', () => {
  it('GETs the right URL and returns items[]', async () => {
    const items = [
      { credential_type: 'github.token', name: 'wf/foo/github.token', secret_arn: 'arn:1' },
    ];
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(jsonResponse({ items }));

    const result = await fetchCredentials('foo', 'https://agents.example/api');

    expect(result).toEqual(items);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://agents.example/api/projects/foo/credentials',
    );
  });

  it('percent-encodes slash-bearing project ids', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(jsonResponse({ items: [] }));

    await fetchCredentials('self/ren', 'https://agents.example/api');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://agents.example/api/projects/self%2Fren/credentials',
    );
  });

  it('returns [] on 404 (project absent / no credentials yet)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response('', { status: 404 }));

    const result = await fetchCredentials('ghost', 'https://agents.example/api');

    expect(result).toEqual([]);
  });

  it('throws on 500', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response('boom', { status: 500 }));

    await expect(fetchCredentials('foo', 'https://agents.example/api')).rejects.toThrow(
      /agents-api 500/,
    );
  });
});

describe('putCredential', () => {
  it('sends {value:{...}} via signedFetch and returns parsed body', async () => {
    const responseBody = {
      project_id: 'foo',
      credential_type: 'github.token',
      name: 'wf/foo/github.token',
      secret_arn: 'arn:1',
      outcome: 'created' as const,
      last_changed_at: '2026-05-28T00:00:00Z',
    };
    mockedSignedFetch.mockResolvedValueOnce(jsonResponse(responseBody));

    const result = await putCredential(
      'foo',
      'github.token',
      { token: 'ghp_xxx' },
      'https://creds.example/api',
    );

    expect(result).toEqual(responseBody);
    expect(mockedAssertSigv4).toHaveBeenCalledTimes(1);

    const [url, init] = mockedSignedFetch.mock.calls[0];
    expect(url).toBe('https://creds.example/api/projects/foo/credentials/github.token');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(init?.body as string)).toEqual({ value: { token: 'ghp_xxx' } });
  });

  it('throws on non-2xx with error body folded into the message', async () => {
    mockedSignedFetch.mockResolvedValueOnce(
      jsonResponse({ error: 'ResourceExistsException' }, 409),
    );

    await expect(
      putCredential('foo', 'github.token', { token: 'x' }, 'https://creds.example/api'),
    ).rejects.toThrow(/credentials-api 409.*ResourceExistsException/);
  });
});

describe('deleteCredential', () => {
  it('DELETEs via signedFetch and returns parsed body', async () => {
    const responseBody = {
      project_id: 'foo',
      credential_type: 'github.token',
      name: 'wf/foo/github.token',
      secret_arn: 'arn:1',
      deletion_date: '2026-06-04T00:00:00Z',
      recovery_window_days: 7,
    };
    mockedSignedFetch.mockResolvedValueOnce(jsonResponse(responseBody));

    const result = await deleteCredential('foo', 'github.token', 'https://creds.example/api');

    expect(result).toEqual(responseBody);
    expect(mockedAssertSigv4).toHaveBeenCalledTimes(1);

    const [url, init] = mockedSignedFetch.mock.calls[0];
    expect(url).toBe('https://creds.example/api/projects/foo/credentials/github.token');
    expect(init?.method).toBe('DELETE');
  });
});
