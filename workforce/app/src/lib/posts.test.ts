// Ordering contract for the per-agent post stream.
//
// The bug (operator report, /agents/nadia?tab=posts): the tab listed a
// 63-day-old post, then a 60-day-old one, then one from minutes earlier.
// `GET /agents/{slug}/posts` ranges over the main table, whose sort key is
// the post ULID — so ordering follows ULID MINT time, not `posted_at`, and
// a post backfilled with an old `posted_at` but a fresh ULID sorts to the
// top. The loader trusted the API ("returns reverse-chronological already")
// and rendered whatever order it got.
//
// These pin the client-side guard. The server-side fix is pinned
// separately in workforce/lambdas/agents-api/feed-tests.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const API_BASE = 'https://api.example.test'

vi.mock('../config/api', () => ({
  WORKFORCE_AGENTS_API_BASE: 'https://api.example.test',
  WORKFORCE_CREDENTIALS_API_BASE: '',
}))

import { loadAgentPosts } from './posts'

/** The reported shape: ULID order and `posted_at` order disagree. */
const OUT_OF_ORDER = [
  { post_id: '01Z', agent_slug: 'nadia', posted_at: '2026-05-24T00:00:00.000Z', kind: 'reflection', body: '63 days old', body_preview: '', references: [] },
  { post_id: '01Y', agent_slug: 'nadia', posted_at: '2026-05-27T00:00:00.000Z', kind: 'friction', body: '60 days old', body_preview: '', references: [] },
  { post_id: '01A', agent_slug: 'nadia', posted_at: '2026-07-26T00:00:00.000Z', kind: 'observation', body: 'just now', body_preview: '', references: [] },
]

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ posts: OUT_OF_ORDER }) }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('loadAgentPosts', () => {
  it('returns newest-first even when the API hands back ULID order', async () => {
    const posts = await loadAgentPosts('nadia')
    expect(posts.map((p) => p.body)).toEqual(['just now', '60 days old', '63 days old'])
  })

  it('puts the most recent post first — the assertion the bug report makes', async () => {
    const posts = await loadAgentPosts('nadia')
    expect(posts[0]!.posted_at).toBe('2026-07-26T00:00:00.000Z')
  })

  it('requests the agent-scoped endpoint with the slug encoded', async () => {
    await loadAgentPosts('nadia')
    expect(fetch).toHaveBeenCalledWith(`${API_BASE}/agents/nadia/posts?page_size=25`)
  })

  it('keeps a correctly ordered response untouched', async () => {
    const sorted = [...OUT_OF_ORDER].sort((a, b) => Date.parse(b.posted_at) - Date.parse(a.posted_at))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ posts: sorted }) }))
    const posts = await loadAgentPosts('nadia')
    expect(posts.map((p) => p.body)).toEqual(['just now', '60 days old', '63 days old'])
  })

  it('throws on a failed response rather than rendering an empty stream', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    await expect(loadAgentPosts('nadia')).rejects.toThrow('feed api 503')
  })
})
