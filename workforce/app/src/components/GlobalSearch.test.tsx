// Component test for GlobalSearch — the nav typeahead wiring (Epic-014
// Story 3, raised as ren's R1). Covers what lib/search.test.ts can't: the
// grouped render, the agents-then-skills ordering the group header depends
// on, keyboard select, click-to-navigate, and Escape-to-close.

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const navigate = vi.fn()
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigate }
})

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
  { name: 'pr-route', description: 'Route a PR.', owners: ['nadia'], status: 'active' },
]

beforeEach(() => {
  navigate.mockReset()
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
