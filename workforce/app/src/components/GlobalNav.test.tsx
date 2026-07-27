// Component test for GlobalNav's responsive shape (2026-07-26).
//
// The bug this guards: nine header destinations overflowed a phone
// viewport. The fix collapses them into a drawer below `md`, and the risk
// that introduces is DRIFT — a destination added to the desktop row but
// forgotten in the drawer (or vice versa). These tests assert the two are
// built from the same list, plus the drawer's open/close contract.
//
// jsdom has no layout, so `hidden md:flex` can't be observed as visibility;
// what IS observable — and what actually matters — is that every
// destination appears in both surfaces and that the drawer mounts/unmounts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../lib/agents', () => ({
  loadWorkforceManifest: vi.fn().mockResolvedValue({ generated_at: '', agents: [] }),
  fullName: (a: { first_name: string; last_name: string }) => `${a.first_name} ${a.last_name}`,
}))
vi.mock('../lib/skills', () => ({
  loadWorkforceSkillManifest: vi.fn().mockResolvedValue({ generated_at: '', skills: [] }),
}))

import GlobalNav from './GlobalNav'

/** Every destination the console exposes from the header. */
const DESTINATIONS = [
  'Home',
  'My Network',
  'Projects',
  'Skills',
  'Reports',
  'Messaging',
  'Notifications',
  'Performance',
]

/** Matches MENU_ANIM_MS in GlobalNav.tsx. */
const ANIM_MS = 200

function renderNav(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <GlobalNav />
    </MemoryRouter>,
  )
}

/** The drawer stays mounted through its exit transition, so every close
 *  assertion has to let that transition finish first. */
function flushExit() {
  act(() => {
    vi.advanceTimersByTime(ANIM_MS)
  })
}

beforeEach(() => {
  document.body.style.overflow = ''
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('GlobalNav', () => {
  it('renders every destination in the desktop row', () => {
    renderNav()
    const nav = screen.getByRole('navigation')
    for (const label of DESTINATIONS) {
      expect(within(nav).getByText(label)).toBeInTheDocument()
    }
    expect(within(nav).getByText('Me')).toBeInTheDocument()
  })

  it('keeps the drawer closed until the hamburger is pressed', () => {
    renderNav()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(screen.getByRole('dialog', { name: 'Menu' })).toBeInTheDocument()
  })

  it('offers the same destinations in the drawer as in the desktop row', () => {
    renderNav()
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    const drawer = screen.getByRole('dialog', { name: 'Menu' })
    for (const label of DESTINATIONS) {
      expect(within(drawer).getByText(label)).toBeInTheDocument()
    }
    // "Me" is the operator card at the top of the drawer rather than a row.
    expect(within(drawer).getByText('Koh Uehara')).toBeInTheDocument()
  })

  it('closes on Escape and restores body scrolling', () => {
    renderNav()
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(document, { key: 'Escape' })
    flushExit()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  it('closes when the backdrop is clicked', () => {
    renderNav()
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    // Two "Close menu" controls: the backdrop and the ✕ in the header.
    const closers = screen.getAllByRole('button', { name: 'Close menu' })
    expect(closers.length).toBe(2)
    fireEvent.click(closers[0])
    flushExit()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  // ── Open/close animation ────────────────────────────────────────────
  // The drawer slides; the risk that introduces is a drawer that never
  // finishes leaving (stuck mounted over the page) or one that unmounts
  // instantly (no exit transition to see). Both are asserted here.

  it('keeps the scroll lock held while the exit transition plays', () => {
    renderNav()
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    fireEvent.keyDown(document, { key: 'Escape' })

    // Mid-flight: still mounted, page still locked — otherwise the page
    // lurches under a drawer that is visibly still on screen.
    act(() => {
      vi.advanceTimersByTime(ANIM_MS / 2)
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')

    flushExit()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('animates in from off-screen rather than appearing', () => {
    renderNav()
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    const panel = screen.getByRole('dialog').lastElementChild as HTMLElement

    // The panel must paint off-screen for one frame, or the browser has
    // no start value to interpolate from and the drawer just pops in.
    expect(panel.className).toContain('translate-x-full')
    expect(panel.className).toContain('transition-transform')

    act(() => {
      vi.advanceTimersByTime(50) // let the queued rAF run
    })
    expect(panel.className).toContain('translate-x-0')
  })

  it('slides back out before unmounting', () => {
    renderNav()
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    act(() => {
      vi.advanceTimersByTime(50)
    })
    const panel = screen.getByRole('dialog').lastElementChild as HTMLElement
    expect(panel.className).toContain('translate-x-0')

    fireEvent.keyDown(document, { key: 'Escape' })
    // Still mounted, but already travelling back off-screen.
    expect(panel.className).toContain('translate-x-full')
    flushExit()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('surfaces the notification count on the collapsed hamburger', () => {
    renderNav()
    // The badge has to survive the collapse — otherwise a phone user loses
    // the only unread signal the header carries.
    expect(within(screen.getByRole('button', { name: 'Open menu' })).getByText('3')).toBeInTheDocument()
  })
})
