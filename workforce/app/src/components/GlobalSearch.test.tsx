// Component test for GlobalSearch — the nav typeahead wiring (Epic-014
// Story 3, raised as ren's R1). Covers what lib/search.test.ts can't: the
// grouped render, the agents-then-skills ordering the group header depends
// on, keyboard select, click-to-navigate, and Escape-to-close.

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const navigate = vi.fn()
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigate }
})

const trackEvent = vi.fn()
vi.mock('@kohuehara/shared/analytics', () => ({ trackEvent: (e: unknown) => trackEvent(e) }))

vi.mock('../lib/agents', () => ({
  loadWorkforceManifest: vi.fn(),
  fullName: (a: { first_name: string; last_name: string }) => `${a.first_name} ${a.last_name}`,
}))
vi.mock('../lib/skills', () => ({
  loadWorkforceSkillManifest: vi.fn(),
}))

import { loadWorkforceManifest } from '../lib/agents'
import { loadWorkforceSkillManifest } from '../lib/skills'
import GlobalSearch from './GlobalSearch'

const AGENTS = [
  { slug: 'ren', first_name: 'Ren', last_name: 'Takahashi', role: 'Engineer', residence: 'Tokyo, JP', about: '' },
  { slug: 'aoi', first_name: 'Aoi', last_name: 'Mori', role: 'Designer', residence: 'Kyoto, JP', about: '' },
]
const SKILLS = [
  { name: 'pr-review', description: 'Review a PR.', owners: ['ren'], status: 'active' },
  { name: 'pr-autopilot', description: 'Route a PR.', owners: ['nadia'], status: 'active' },
]

// Must match SETTLE_MS in GlobalSearch.tsx — the pause that turns typing
// into "a search" for both the announcement and the telemetry.
const SETTLE_MS = 500

beforeEach(() => {
  navigate.mockReset()
  trackEvent.mockReset()
  ;(loadWorkforceManifest as Mock).mockResolvedValue({ generated_at: '', agents: AGENTS })
  ;(loadWorkforceSkillManifest as Mock).mockResolvedValue({ generated_at: '', skills: SKILLS })
})
afterEach(() => cleanup())

function renderSearch() {
  render(<MemoryRouter><GlobalSearch /></MemoryRouter>)
  return screen.getByRole('combobox') as HTMLInputElement
}

async function typeQuery(input: HTMLInputElement, q: string) {
  fireEvent.focus(input)
  // Let the lazy manifest loads resolve before the query drives the rows.
  await screen.findByRole('combobox')
  await Promise.resolve(); await Promise.resolve()
  fireEvent.change(input, { target: { value: q } })
}

describe('GlobalSearch', () => {
  it('shows grouped talent + skill results for a query', async () => {
    const input = renderSearch()
    await typeQuery(input, 'ren')
    // Ren matches on slug/name; pr-review matches on owner "ren".
    expect(await screen.findByText('Ren Takahashi')).toBeInTheDocument()
    expect(screen.getByText('pr-review')).toBeInTheDocument()
    expect(screen.getByText('Talent')).toBeInTheDocument()
    expect(screen.getByText('Skills')).toBeInTheDocument()
  })

  it('navigates to the agent when its row is clicked', async () => {
    const input = renderSearch()
    await typeQuery(input, 'ren')
    const row = await screen.findByText('Ren Takahashi')
    fireEvent.mouseDown(row)
    expect(navigate).toHaveBeenCalledWith('/agents/ren')
  })

  it('ArrowDown + Enter selects the highlighted (first) result', async () => {
    const input = renderSearch()
    await typeQuery(input, 'ren')
    await screen.findByText('Ren Takahashi')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.submit(input.closest('form')!)
    expect(navigate).toHaveBeenCalledWith('/agents/ren')
  })

  it('Enter with no highlighted row goes to the full /search page', async () => {
    const input = renderSearch()
    await typeQuery(input, 'ren')
    await screen.findByText('Ren Takahashi')
    fireEvent.submit(input.closest('form')!)
    expect(navigate).toHaveBeenCalledWith('/search?q=ren')
  })

  it('Escape closes the dropdown', async () => {
    const input = renderSearch()
    await typeQuery(input, 'ren')
    expect(await screen.findByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

// Issue 321 — A1 (aria-live result count) + F2 (search telemetry). Both hang off the
// same settle delay, so both are exercised through it.
describe('GlobalSearch — announcement + telemetry (issue 321)', () => {
  /** Let the debounce elapse so the query counts as settled. */
  const settle = async () => {
    await act(async () => { await new Promise((r) => setTimeout(r, SETTLE_MS + 20)) })
  }

  it('announces the result count in a polite live region once typing settles', async () => {
    const input = renderSearch()
    await typeQuery(input, 'ren')
    await screen.findByText('Ren Takahashi')

    const live = screen.getByRole('status')
    expect(live).toHaveAttribute('aria-live', 'polite')
    // Nothing is announced mid-keystroke — that is what makes it usable.
    expect(live).toHaveTextContent('')

    await settle()
    // "ren" matches agent Ren + skill pr-review (owner "ren") = 2 rows.
    expect(live).toHaveTextContent('2 results')
  })

  it('announces "No matches" rather than staying silent on a miss', async () => {
    const input = renderSearch()
    await typeQuery(input, 'zzzznotathing')
    await settle()
    expect(screen.getByRole('status')).toHaveTextContent('No matches')
  })

  it('singularises a one-result announcement', async () => {
    const input = renderSearch()
    await typeQuery(input, 'aoi') // matches only the agent
    await settle()
    expect(screen.getByRole('status')).toHaveTextContent('1 result')
  })

  it('logs one global_search event per settled query, not one per keystroke', async () => {
    const input = renderSearch()
    await typeQuery(input, 'r')
    fireEvent.change(input, { target: { value: 're' } })
    fireEvent.change(input, { target: { value: 'ren' } })
    // Three keystrokes, one pause.
    expect(trackEvent).not.toHaveBeenCalled()

    await settle()
    await waitFor(() => expect(trackEvent).toHaveBeenCalledTimes(1))
    expect(trackEvent).toHaveBeenCalledWith({
      name: 'global_search',
      params: { surface: 'nav', has_results: true },
    })
  })

  it('reports has_results:false when the settled query genuinely misses', async () => {
    const input = renderSearch()
    await typeQuery(input, 'zzzznotathing')
    await settle()
    await waitFor(() => expect(trackEvent).toHaveBeenCalledTimes(1))
    expect(trackEvent).toHaveBeenCalledWith({
      name: 'global_search',
      params: { surface: 'nav', has_results: false },
    })
  })

  it('does not announce or log a miss while the manifests are still unloaded', async () => {
    // A pending load is the state that would otherwise report zero results
    // for a query that was never actually run against the data.
    ;(loadWorkforceManifest as Mock).mockReturnValue(new Promise(() => {}))
    ;(loadWorkforceSkillManifest as Mock).mockReturnValue(new Promise(() => {}))

    const input = renderSearch()
    await typeQuery(input, 'ren')
    await settle()

    expect(screen.getByRole('status')).toHaveTextContent('')
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('does not re-log a query already counted', async () => {
    const input = renderSearch()
    await typeQuery(input, 'ren')
    await settle()
    await waitFor(() => expect(trackEvent).toHaveBeenCalledTimes(1))

    // Re-render churn (here: reopening the dropdown) must not double-count.
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.focus(input)
    await settle()
    expect(trackEvent).toHaveBeenCalledTimes(1)
  })
})
