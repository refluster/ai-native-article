// The feed card's 👍 like bar.
//
// Pins: the 👍 is always rendered — un-pressed (outline, "Like 0") on a
// post nobody liked, not hidden until hover; pressed when the operator is
// among the likers; the toggle SigV4-signs operator-like and reconciles to
// the server's likers; a failed write rolls back and says why (C-4); the
// operator's own post shows its count but is not pressable.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../config/api', () => ({
  WORKFORCE_AGENTS_API_BASE: 'https://api.example.test',
  WORKFORCE_CREDENTIALS_API_BASE: '',
}))
vi.mock('../config/auth', () => ({ SIGV4_IS_CONFIGURED: true }))
const signedFetch = vi.fn()
vi.mock('../lib/sigv4', () => ({
  assertSigv4Configured: () => {},
  signedFetch: (...args: unknown[]) => signedFetch(...args),
}))

import PostCard from './PostCard'
import type { Post } from '../types/post'

const base: Post = {
  post_id: '01POST',
  agent_slug: 'maya',
  posted_at: '2026-11-10T00:00:00.000Z',
  kind: 'observation',
  body: 'A post.',
}
const renderCard = (post: Post) =>
  render(
    <MemoryRouter>
      <PostCard post={post} agent={undefined} />
    </MemoryRouter>,
  )
const likeButton = () => screen.getByRole('button', { name: /like/i })

beforeEach(() => {
  cleanup()
  signedFetch.mockReset()
})

describe('PostCard like bar', () => {
  it('renders an un-pressed 👍 with a zero count when nobody liked', () => {
    renderCard(base)
    const btn = likeButton()
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    expect(btn.textContent).toContain('Like')
    expect(btn.textContent).toContain('0')
  })

  it('renders pressed when the operator is among the likers', () => {
    renderCard({ ...base, likers: ['dario', 'operator'] })
    const btn = likeButton()
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    expect(btn.textContent).toContain('2')
    expect(screen.getByText(/dario, you/)).toBeTruthy()
  })

  it('presses via a signed operator-like and reconciles to the server', async () => {
    signedFetch.mockResolvedValue({ ok: true, json: async () => ({ likers: ['operator', 'ren'] }) })
    renderCard({ ...base, likers: ['ren'] })
    fireEvent.click(likeButton())
    await waitFor(() => expect(likeButton().getAttribute('aria-pressed')).toBe('true'))
    const [url, init] = signedFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.example.test/feed/01POST/operator-like?agent_slug=maya')
    expect(JSON.parse(String(init.body))).toEqual({ liked: true })
    expect(likeButton().textContent).toContain('2')
  })

  it('rolls back and shows the reason when the write fails', async () => {
    signedFetch.mockResolvedValue({ ok: false, status: 422, json: async () => ({ error: 'like_rejected', detail: 'post_hidden' }) })
    renderCard(base)
    fireEvent.click(likeButton())
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('post_hidden'))
    expect(likeButton().getAttribute('aria-pressed')).toBe('false')
  })

  it("does not let the operator like their own post", () => {
    renderCard({ ...base, agent_slug: 'operator', author_type: 'operator', likers: ['maya'] })
    const btn = likeButton() as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.textContent).toContain('1')
  })
})
