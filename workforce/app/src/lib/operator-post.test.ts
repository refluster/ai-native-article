// The operator's feed write path (the console composer).
//
// The composer used to be a `div` with a tooltip saying posts come from the
// crew's cron. These pin the contract of the real thing:
//   - the write is SigV4-signed (never a bare fetch — the route is AWS_IAM),
//   - the SPA never sends an author, because the gateway identity IS it,
//   - `kind` defaults to `directive` (the kind injected into every fire),
//   - a rejected write surfaces the handler's reason instead of vanishing.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const API_BASE = 'https://api.example.test'

vi.mock('../config/api', () => ({
  WORKFORCE_AGENTS_API_BASE: 'https://api.example.test',
  WORKFORCE_CREDENTIALS_API_BASE: '',
}))
vi.mock('../config/auth', () => ({ SIGV4_IS_CONFIGURED: true }))

const signedFetch = vi.fn()
vi.mock('./sigv4', () => ({
  assertSigv4Configured: () => {},
  signedFetch: (...args: unknown[]) => signedFetch(...args),
}))

import { createOperatorPost, feedWriteEnabled, POST_BODY_HARD_MAX_CHARS } from './posts'

const CREATED = {
  post_id: '01HZ',
  agent_slug: 'operator',
  posted_at: '2026-08-15T09:00:00.000Z',
  kind: 'directive',
}

beforeEach(() => {
  signedFetch.mockResolvedValue({ ok: true, json: async () => CREATED })
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('createOperatorPost', () => {
  it('signs the write — an unsigned fetch would 403 at the AWS_IAM route', async () => {
    await createOperatorPost({ body: 'Ship the L3 backlog before new sources.' })
    expect(signedFetch).toHaveBeenCalledTimes(1)
    expect(signedFetch.mock.calls[0]![0]).toBe(`${API_BASE}/feed/operator`)
  })

  it('defaults kind to directive and sends no author field', async () => {
    await createOperatorPost({ body: 'Prefer freshness-ordered sources.' })
    const init = signedFetch.mock.calls[0]![1] as RequestInit
    const sent = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(sent.kind).toBe('directive')
    expect(sent).not.toHaveProperty('agent_slug')
    expect(sent).not.toHaveProperty('author_type')
  })

  it('honours an explicit non-directive kind', async () => {
    await createOperatorPost({ body: 'Just noticing.', kind: 'observation' })
    const init = signedFetch.mock.calls[0]![1] as RequestInit
    expect(JSON.parse(String(init.body)).kind).toBe('observation')
  })

  it('returns the created post marked operator-authored so it renders as mine', async () => {
    const post = await createOperatorPost({ body: 'Ship it.' })
    expect(post.author_type).toBe('operator')
    expect(post.agent_slug).toBe('operator')
    expect(post.body).toBe('Ship it.')
  })

  it('refuses an empty body before the round-trip', async () => {
    await expect(createOperatorPost({ body: '   ' })).rejects.toThrow('empty_body')
    expect(signedFetch).not.toHaveBeenCalled()
  })

  it('refuses a body over the server hard cap before the round-trip', async () => {
    await expect(
      createOperatorPost({ body: 'x'.repeat(POST_BODY_HARD_MAX_CHARS + 1) }),
    ).rejects.toThrow('body_over_hard_cap')
    expect(signedFetch).not.toHaveBeenCalled()
  })

  it('surfaces the handler reason on a rejected write (C-4: loud, not silent)', async () => {
    signedFetch.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: 'post_rejected', detail: 'body_over_hard_cap: 2400 > 2000' }),
    })
    await expect(createOperatorPost({ body: 'too long, server says' })).rejects.toThrow(
      /422 · post_rejected · body_over_hard_cap/,
    )
  })
})

describe('feedWriteEnabled', () => {
  it('is true when both the API base and the SigV4 broker are configured', () => {
    expect(feedWriteEnabled()).toBe(true)
  })
})
