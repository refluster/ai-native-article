// Render tests for /org/chart.
//
// Two groups. The first renders the page normally and asserts what the
// operator can see: every agent on screen exactly once, the controls
// changing what is rendered, and a data fault surfacing rather than
// vanishing.
//
// The second stubs layout. jsdom has no layout *by default*, but the three
// surfaces this component measures through — ResizeObserver, offsetHeight /
// clientWidth, and getBoundingClientRect — are all stubbable, and the FIT
// convergence is the load-bearing claim of the whole feature. Leaving it
// uncovered meant the termination guard could be deleted and the suite
// stayed green (wf:owen O6), and it let a scroll-dependent measurement bug
// ship undetected (wf:dario D1). Packing width genuinely can't be asserted
// here; zoom convergence can.

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

  it('renders the roster size and the per-level head-count', async () => {
    renderChart()
    expect(await screen.findByText('WHOLE WORKFORCE · 6 AGENTS')).toBeInTheDocument()
    // The rendered numbers, not just the presence of a container — the old
    // assertion passed even with levelCounts zeroed (wf:owen O8).
    const band = screen.getByLabelText('Org summary')
    expect(band.textContent).toContain('L0 1')
    expect(band.textContent).toContain('L1 2')
    expect(band.textContent).toContain('L2 3')
    expect(band.textContent).toContain('divisions 2')
  })

  it('discloses that it shows structure only, not run health', async () => {
    renderChart()
    expect(await screen.findByText(/run health on the crew index/)).toBeInTheDocument()
    expect(screen.getByText(/run health on the crew index/).closest('a')).toHaveAttribute(
      'href',
      '/agents',
    )
  })

  it('dims non-matching agents instead of removing them', async () => {
    renderChart()
    await screen.findByText('Sora Test')
    fireEvent.change(screen.getByLabelText('Highlight agents'), { target: { value: 'podcast' } })

    expect(await screen.findByText(/2 of 6 highlighted/)).toBeInTheDocument()
    // Still rendered — the org shape must not change as you type.
    expect(screen.getByText('Sora Test')).toBeInTheDocument()
    expect(screen.getByText('Sora Test').closest('a')).toHaveStyle({ opacity: '0.45' })
    expect(screen.getByText('Rhys Test').closest('a')).toHaveStyle({ opacity: '1' })
  })

  it('drops a dimmed row out of the tab order but keeps it readable', async () => {
    renderChart()
    await screen.findByText('Sora Test')
    fireEvent.change(screen.getByLabelText('Highlight agents'), { target: { value: 'podcast' } })
    await screen.findByText(/2 of 6 highlighted/)

    expect(screen.getByText('Sora Test').closest('a')).toHaveAttribute('tabindex', '-1')
    expect(screen.getByText('Rhys Test').closest('a')).not.toHaveAttribute('tabindex')
  })

  // Regression (wf:aoi A4 / wf:freya F2 / wf:owen O7): the lead used to stay
  // lit whenever any member matched, so one opacity meant "matched" on
  // member rows and "contains a match" on lead rows. Containment now has
  // its own signal.
  it('dims a division lead by its own match state and counts hits separately', async () => {
    renderChart()
    await screen.findByText('Celeste Test')
    fireEvent.change(screen.getByLabelText('Highlight agents'), { target: { value: 'podcast' } })
    await screen.findByText(/2 of 6 highlighted/)

    // celeste's role does not match, so the lead dims like any other row…
    expect(screen.getByText('Celeste Test').closest('a')).toHaveStyle({ opacity: '0.45' })
    // …and the containment signal is the HITS chip, not full opacity.
    expect(screen.getByText(/2 HITS/)).toBeInTheDocument()
    // A division with nothing matching gets no chip at all.
    const beatriz = screen
      .getAllByRole('article')
      .find((el) => within(el).queryByText('Beatriz Test'))!
    expect(within(beatriz).queryByText(/HITS/)).not.toBeInTheDocument()
  })

  // Regression (wf:aoi A5 / wf:freya F3): compact density hid the slug and
  // residence — two of the three fields the query matches — so a highlight
  // lit rows with no visible reason.
  it('reveals the matched fields while searching, whatever the density', async () => {
    renderChart()
    await screen.findByText('Sora Test')
    expect(screen.queryByText('Oslo, NO')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Highlight agents'), { target: { value: 'oslo' } })
    expect(await screen.findByText('Oslo, NO')).toBeInTheDocument()
    expect(screen.getByText('SORA · L2')).toBeInTheDocument()
  })

  it('adds the mono slug caption and residence in detail density', async () => {
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

  // Regression (wf:aoi A6): stepZoom used to clear `fit` before clamping,
  // so a press that changed nothing silently changed a mode.
  it('disables a zoom button at its end of the ladder rather than no-opping', async () => {
    renderChart()
    await screen.findByText('Sora Test')
    expect(screen.getByLabelText('Zoom in')).toBeDisabled()

    fireEvent.click(screen.getByLabelText('Zoom in'))
    expect(screen.getByRole('button', { name: 'fit' })).toHaveAttribute('aria-pressed', 'true')
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
    // …and the fault is named in the top stat band too, not only at the
    // bottom of a chart that may be scaled down (wf:freya F8).
    expect(screen.getByLabelText('Org summary').textContent).toContain('unplaced 2')
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

// ── FIT convergence, with layout stubbed ───────────────────────────────
describe('OrgChart FIT', () => {
  const VIEWPORT_H = 800
  /** Document-relative top of the chart container in every case below. */
  const DOC_TOP = 200

  let chartHeight = 0
  let originalRect: typeof HTMLElement.prototype.getBoundingClientRect

  /** Stub the three surfaces the component measures through. `rectTop` and
   *  `scrollY` are varied independently so a scroll-dependent measurement
   *  is observable: docTop = rectTop + scrollY is held at DOC_TOP. */
  function stubLayout({ height, rectTop, scrollY }: { height: number; rectTop: number; scrollY: number }) {
    chartHeight = height
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: VIEWPORT_H })
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1440 })
    Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: scrollY })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        return chartHeight
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return 1344
      },
    })
    HTMLElement.prototype.getBoundingClientRect = function () {
      return { top: rectTop, bottom: 0, left: 0, right: 0, width: 1344, height: chartHeight, x: 0, y: rectTop, toJSON: () => ({}) } as DOMRect
    }
  }

  beforeEach(() => {
    loadWorkforceManifest.mockResolvedValue({ generated_at: '', agents: ROSTER })
    originalRect = HTMLElement.prototype.getBoundingClientRect
    // A no-op observer: the component's own re-renders drive re-measurement,
    // and jsdom fires no layout events anyway.
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    HTMLElement.prototype.getBoundingClientRect = originalRect
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
    delete (globalThis as unknown as Record<string, unknown>).ResizeObserver
  })

  const zoomReadout = () => screen.getByText(/^\d+%$/).textContent

  it('leaves the zoom at 100% when the chart already clears the fold', async () => {
    stubLayout({ height: 300, rectTop: DOC_TOP, scrollY: 0 })
    renderChart()
    await screen.findByText('Sora Test')
    await waitFor(() => expect(zoomReadout()).toBe('100%'))
  })

  // The guard `zoomIdx < FIT_FLOOR_IDX` is what stops this: without it the
  // pass runs off the end of the ladder. An unsatisfiable height must land
  // on the readable floor and STAY there (wf:owen O6).
  it('converges to the readable-zoom floor for a chart that can never fit', async () => {
    stubLayout({ height: 5000, rectTop: DOC_TOP, scrollY: 0 })
    renderChart()
    await screen.findByText('Sora Test')
    await waitFor(() => expect(zoomReadout()).toBe('84%'))
    // Stable: re-assert after further render passes rather than catching it
    // mid-descent.
    await waitFor(() => expect(zoomReadout()).toBe('84%'))
    expect(screen.getByRole('button', { name: 'fit' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('says why when it bottoms out with the chart still overflowing', async () => {
    stubLayout({ height: 5000, rectTop: DOC_TOP, scrollY: 0 })
    renderChart()
    await screen.findByText('Sora Test')
    expect(await screen.findByText(/at readable-zoom floor · largest division celeste is 3 rows/)).toBeInTheDocument()
  })

  // Regression (wf:dario D1): `available` was measured from
  // getBoundingClientRect().top alone, which is viewport-relative. Once the
  // operator had scrolled, top went negative, available inflated by exactly
  // the scroll offset, and FIT concluded an overflowing chart fit.
  it('converges to the same zoom whether or not the page is scrolled', async () => {
    stubLayout({ height: 1500, rectTop: DOC_TOP, scrollY: 0 })
    renderChart()
    await screen.findByText('Sora Test')
    await waitFor(() => expect(zoomReadout()).toBe('84%'))
    const unscrolled = zoomReadout()
    cleanup()

    // Same chart, same document position — only the scroll offset differs.
    stubLayout({ height: 1500, rectTop: DOC_TOP - 1000, scrollY: 1000 })
    renderChart()
    await screen.findByText('Sora Test')
    await waitFor(() => expect(zoomReadout()).toBe(unscrolled))
  })
})
