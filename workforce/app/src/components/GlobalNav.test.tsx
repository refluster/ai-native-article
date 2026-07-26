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
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
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

function renderNav(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <GlobalNav />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  document.body.style.overflow = ''
})
afterEach(cleanup)

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
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('surfaces the notification count on the collapsed hamburger', () => {
    renderNav()
    // The badge has to survive the collapse — otherwise a phone user loses
    // the only unread signal the header carries.
    expect(within(screen.getByRole('button', { name: 'Open menu' })).getByText('3')).toBeInTheDocument()
  })
})
