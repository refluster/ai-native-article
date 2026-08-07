// Route-table tests.
//
// The route table is the one artefact in this app that `tsc` cannot check
// at all — a path typo compiles, ships a blank route, and CI stays green.
// Page-level render tests already exist beside this file
// (`pages/OrgChart.test.tsx`, `pages/SkillProfile.test.tsx`); only `App`
// was exempt, and the PR that retired `/org` was a route rewrite and
// nothing else, so the exemption had to go with it (wf:dario D1).
//
// `AuthBoundary` does not need to be *tested* here, only *mocked* — one
// `vi.mock`, no Cognito config. `App` mounts a real `BrowserRouter`, so
// jsdom's own history is the router's input and `pushState` before
// `render` is the whole setup. The test drives the real `App`, so deleting
// or mistyping a route turns it red.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('./components/AuthBoundary', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('@kohuehara/shared/analytics', () => ({ trackPageView: () => {} }))
vi.mock('./pages/OrgChart', () => ({ default: () => <div>ORG-CHART-MARKER</div> }))
vi.mock('./pages/Feed', () => ({ default: () => <div>FEED-MARKER</div> }))

import App from './App'

afterEach(() => {
  cleanup()
  window.history.pushState({}, '', '/')
})

describe('/org → /org/chart', () => {
  it('redirects, and replaces rather than stacking history', async () => {
    window.history.pushState({}, '', '/somewhere')
    window.history.pushState({}, '', '/org')
    render(<App />)

    expect(await screen.findByText('ORG-CHART-MARKER')).toBeInTheDocument()
    await waitFor(() => expect(window.location.pathname).toBe('/org/chart'))

    // `replace` means Back skips the retired path instead of bouncing
    // through it.
    window.history.back()
    await waitFor(() => expect(window.location.pathname).toBe('/somewhere'))
  })

  // Regression (wf:freya F1, #558): the redirect used to serve the path and drop
  // the state, so a bookmarked `/org?center=elena` landed on the whole
  // roster with nothing highlighted.
  it('carries ?center= across as the chart’s ?q= highlight', async () => {
    window.history.pushState({}, '', '/org?center=elena')
    render(<App />)

    expect(await screen.findByText('ORG-CHART-MARKER')).toBeInTheDocument()
    await waitFor(() => expect(window.location.pathname).toBe('/org/chart'))
    expect(window.location.search).toBe('?q=elena')
  })

  // Regression (wf:dario D7): dropping `encodeURIComponent` was the one
  // mutation the first version of this suite did not kill, and it is the
  // line that stops a crafted link smuggling a param the chart reads —
  // every other case uses a slug that encodes to itself.
  it('escapes the carried value so a crafted link cannot smuggle a second param', async () => {
    window.history.pushState({}, '', '/org?center=' + encodeURIComponent('a&density=detail'))
    render(<App />)

    await waitFor(() => expect(window.location.pathname).toBe('/org/chart'))
    const params = new URLSearchParams(window.location.search)
    expect(params.get('density')).toBeNull()
    expect(params.get('q')).toBe('a&density=detail')
  })

  it('redirects without a query when there is nothing to carry', async () => {
    window.history.pushState({}, '', '/org')
    render(<App />)

    await waitFor(() => expect(window.location.pathname).toBe('/org/chart'))
    expect(window.location.search).toBe('')
  })

  it('still serves /org/chart directly, without bouncing through the redirect', async () => {
    window.history.pushState({}, '', '/org/chart?q=maya')
    render(<App />)

    expect(await screen.findByText('ORG-CHART-MARKER')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/org/chart')
    expect(window.location.search).toBe('?q=maya')
  })
})
