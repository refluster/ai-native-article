// Render tests for /org/chart.
//
// jsdom has no layout, so the *packing* (balanced columns, zoom fit) can't
// be asserted here — what can, and what actually matters for correctness,
// is that every agent on the roster reaches the screen exactly once, that
// the controls change what is rendered, and that an unreachable node is
// surfaced rather than silently dropped.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { WorkforceAgent } from '../types/agent'

function agent(slug: string, reports_to: string[], depth: number, role: string, residence = 'Tokyo, JP'): WorkforceAgent {
  return {
    slug,
    first_name: slug[0].toUpperCase() + slug.slice(1),
    last_name: 'Test',
    residence,
    role,
    model: 'anthropic:claude-sonnet-4-6',
    prompt_version: '0.1.0',
    budget_monthly_usd: 5,
    default_project: 'workforce-self',
    streams: ['internal'],
    bindings: [],
    created_at: '2026-01-01',
    about: '',
    depth,
    reports_to,
    direct_reports: [],
    lateral: [],
  }
}

const ROSTER: WorkforceAgent[] = [
  agent('maya', [], 0, 'President'),
  agent('beatriz', ['maya'], 1, 'VP, Research'),
  agent('celeste', ['maya'], 1, 'VP, Marketing'),
  agent('sora', ['beatriz'], 2, 'Researcher / Analyst', 'Oslo, NO'),
  agent('rhys', ['celeste'], 2, 'Podcast Scriptwriter'),
  agent('odette', ['celeste'], 2, 'Podcast Producer'),
]

const loadWorkforceManifest = vi.fn()

vi.mock('../lib/agents', () => ({
  loadWorkforceManifest: () => loadWorkforceManifest(),
  fullName: (a: { first_name: string; last_name: string }) => `${a.first_name} ${a.last_name}`,
}))

import OrgChart from './OrgChart'

function renderChart() {
  return render(
    <MemoryRouter>
      <OrgChart />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  loadWorkforceManifest.mockResolvedValue({ generated_at: '', agents: ROSTER })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('OrgChart', () => {
  it('puts every agent on screen exactly once', async () => {
    renderChart()
    for (const a of ROSTER) {
      expect(await screen.findAllByText(`${a.first_name} ${a.last_name}`)).toHaveLength(1)
    }
  })

  it('renders the root in its own band and each root-child as a division', async () => {
    renderChart()
    expect(await screen.findByText('Maya Test')).toBeInTheDocument()
    expect(screen.getByText(/MAYA · L0 · ROOT/)).toBeInTheDocument()
    // celeste has two reports, beatriz one → head-count ordering.
    expect(screen.getByText(/CELESTE · L1 · 3 PPL/)).toBeInTheDocument()
    expect(screen.getByText(/BEATRIZ · L1 · 2 PPL/)).toBeInTheDocument()
  })

  it('nests a report under its own division, not under the root', async () => {
    renderChart()
    await screen.findByText('Sora Test')
    const division = screen
      .getAllByRole('article')
      .find((el) => within(el).queryByText('Beatriz Test'))!
    expect(within(division).getByText('Sora Test')).toBeInTheDocument()
    expect(within(division).queryByText('Rhys Test')).not.toBeInTheDocument()
  })

  it('reports the roster size and the per-level head-count', async () => {
    renderChart()
    expect(await screen.findByText('WHOLE WORKFORCE · 6 AGENTS')).toBeInTheDocument()
    const counts = screen.getByText('L2').parentElement
    expect(counts).toBeTruthy()
  })

  it('dims non-matching agents instead of removing them', async () => {
    renderChart()
    await screen.findByText('Sora Test')
    fireEvent.change(screen.getByLabelText('Highlight agents'), { target: { value: 'podcast' } })

    expect(await screen.findByText('2 of 6 highlighted')).toBeInTheDocument()
    // Still rendered — the org shape must not change as you type.
    expect(screen.getByText('Sora Test')).toBeInTheDocument()
    expect(screen.getByText('Sora Test').closest('a')).toHaveStyle({ opacity: '0.25' })
    expect(screen.getByText('Rhys Test').closest('a')).toHaveStyle({ opacity: '1' })
  })

  it('adds the mono slug caption and residence only in detail density', async () => {
    renderChart()
    await screen.findByText('Sora Test')
    expect(screen.queryByText('Oslo, NO')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'detail' }))
    expect(await screen.findByText('Oslo, NO')).toBeInTheDocument()
    expect(screen.getByText('SORA · L2')).toBeInTheDocument()
  })

  it('steps the zoom manually and turns FIT off when it does', async () => {
    renderChart()
    await screen.findByText('Sora Test')
    expect(screen.getByRole('button', { name: 'fit' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByLabelText('Zoom out'))
    expect(screen.getByText('96%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'fit' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByLabelText('Zoom in'))
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('surfaces agents unreachable from a root instead of dropping them', async () => {
    loadWorkforceManifest.mockResolvedValue({
      generated_at: '',
      agents: [...ROSTER, agent('loopa', ['loopb'], 0, 'Ghost A'), agent('loopb', ['loopa'], 0, 'Ghost B')],
    })
    renderChart()
    expect(await screen.findByText(/AGENTS UNREACHABLE FROM A ROOT/)).toBeInTheDocument()
    expect(screen.getByText('Loopa Test')).toBeInTheDocument()
    expect(screen.getByText('Loopb Test')).toBeInTheDocument()
  })

  it('names a second reporting line rather than drawing the node twice', async () => {
    loadWorkforceManifest.mockResolvedValue({
      generated_at: '',
      agents: [...ROSTER, agent('dual', ['sora', 'celeste'], 2, 'Dual Reporter')],
    })
    renderChart()
    expect(await screen.findAllByText('Dual Test')).toHaveLength(1)
    expect(screen.getByText('⇄ also reports to sora')).toBeInTheDocument()
  })

  it('fails loud when the roster cannot be loaded', async () => {
    loadWorkforceManifest.mockRejectedValue(new Error('live agent roster returned 0 agents'))
    renderChart()
    await waitFor(() =>
      expect(screen.getByText(/Could not load org: live agent roster returned 0 agents/)).toBeInTheDocument(),
    )
  })
})
