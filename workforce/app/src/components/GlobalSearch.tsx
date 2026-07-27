// The GlobalNav search box (Epic-014 Story 3). A LinkedIn-style combobox:
// type to see a live typeahead of top talent + skill hits; Enter (or "See
// all results") goes to the full /search page; click a row to jump
// straight to that agent/skill.
//
// Ranking comes from lib/search (shared with the /search page, so the
// dropdown and the page never disagree). The roster + skill manifests are
// fetched once via the cached loaders on first interaction — no cost on
// pages the operator never searches from.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadWorkforceManifest, fullName } from '../lib/agents'
import { loadWorkforceSkillManifest } from '../lib/skills'
import { searchAgents, searchSkills } from '../lib/search'
import type { WorkforceAgent } from '../types/agent'
import type { WorkforceSkill } from '../types/skill'

const TYPEAHEAD_LIMIT = 5 // per group

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" strokeLinecap="round" />
    </svg>
  )
}

/** One row in the flat keyboard-navigable result list. */
type Row =
  | { kind: 'agent'; agent: WorkforceAgent; to: string }
  | { kind: 'skill'; skill: WorkforceSkill; to: string }

export default function GlobalSearch() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1) // index into the flat `rows`
  const [agents, setAgents] = useState<WorkforceAgent[]>([])
  const [skills, setSkills] = useState<WorkforceSkill[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()

  // Lazy-load both manifests on first focus. Cached loaders make repeat
  // focuses free; a load failure degrades to "Enter still works" (the
  // /search page re-attempts and surfaces the real error there).
  const loadedRef = useRef(false)
  const ensureLoaded = () => {
    if (loadedRef.current) return
    loadedRef.current = true
    // A degraded typeahead must be diagnosable (W-4 fail-loud): warn on
    // each failed load and reset the latch so a re-focus retries. The
    // /search page (Enter) re-attempts and surfaces the real error to the
    // user; the warn is for the bug report when the dropdown looks empty.
    loadWorkforceManifest()
      .then((m) => setAgents(m.agents))
      .catch((err) => {
        loadedRef.current = false
        console.warn('GlobalSearch: agent roster load failed — typeahead degraded, Enter still works', err)
      })
    loadWorkforceSkillManifest()
      .then((m) => setSkills(m.skills))
      .catch((err) => {
        loadedRef.current = false
        console.warn('GlobalSearch: skill manifest load failed — typeahead degraded, Enter still works', err)
      })
  }

  const rows = useMemo<Row[]>(() => {
    const q = query.trim()
    if (!q) return []
    const a: Row[] = searchAgents(agents, q)
      .slice(0, TYPEAHEAD_LIMIT)
      .map((h) => ({ kind: 'agent', agent: h.agent, to: `/agents/${h.agent.slug}` }))
    const s: Row[] = searchSkills(skills, q)
      .slice(0, TYPEAHEAD_LIMIT)
      .map((h) => ({ kind: 'skill', skill: h.skill, to: `/skills/${h.skill.name}` }))
    return [...a, ...s]
  }, [query, agents, skills])

  // Reset the active row whenever the result set changes.
  useEffect(() => { setActive(-1) }, [query])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const go = (to: string) => {
    setOpen(false)
    setQuery('')
    navigate(to)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    // If a row is highlighted, jump to it; otherwise go to the full page.
    if (active >= 0 && active < rows.length) { go(rows[active].to); return }
    const q = query.trim()
    if (q) go(`/search?q=${encodeURIComponent(q)}`)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return }
    if (rows.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => (i + 1) % rows.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => (i <= 0 ? rows.length - 1 : i - 1))
    }
  }

  const showDropdown = open && query.trim().length > 0
  const agentRows = rows.filter((r) => r.kind === 'agent')
  const skillRows = rows.filter((r) => r.kind === 'skill')

  return (
    // Phones get the search too (it used to be `hidden sm:block`): with the
    // destinations collapsed behind the hamburger there is room for it, and
    // search is the only way to reach a specific persona in one hop.
    <div ref={rootRef} className="relative flex-1 min-w-0 sm:flex-none sm:w-44 md:w-64">
      <form
        onSubmit={submit}
        className="flex items-center gap-2 bg-wf-surface-container rounded-wf-sm px-3 h-9 focus-within:ring-1 focus-within:ring-wf-primary"
        role="search"
      >
        <SearchIcon className="w-4 h-4 text-wf-on-surface-variant shrink-0" />
        <input
          type="search"
          aria-label="Search talent and skills"
          placeholder="Search talent, skills…"
          value={query}
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listboxId}-opt-${active}` : undefined}
          onFocus={() => { ensureLoaded(); setOpen(true) }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onKeyDown={onKeyDown}
          className="bg-transparent text-sm text-wf-on-surface placeholder:text-wf-on-surface-variant w-full focus:outline-none"
        />
      </form>

      {/* On phones the panel spans the (flexible) field rather than a fixed
          18rem, which would overflow the viewport's right edge. */}
      {showDropdown && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Search results"
          className="absolute left-0 right-0 mt-1 max-h-[70vh] overflow-y-auto bg-wf-surface border border-wf-outline-variant rounded-wf-sm shadow-lg z-40 py-1 w-auto sm:w-[18rem] md:w-[22rem]"
        >
          {rows.length === 0 ? (
            <div className="px-3 py-2 text-xs text-wf-on-surface-variant">
              No matches. Press Enter to search anyway.
            </div>
          ) : (
            <>
              {agentRows.length > 0 && (
                <div className="px-3 pt-1 pb-0.5 font-wfmono text-[9px] uppercase tracking-[0.18em] text-wf-on-surface-variant">
                  Talent
                </div>
              )}
              {rows.map((row, i) => {
                const isActive = i === active
                const base =
                  `flex items-center gap-2 px-3 py-2 cursor-pointer text-sm ${
                    isActive ? 'bg-wf-surface-container-hi' : 'hover:bg-wf-surface-container'
                  }`
                // Render the "Skills" group header before the first skill row.
                const header =
                  row.kind === 'skill' && i === agentRows.length && skillRows.length > 0 ? (
                    <div
                      key="skills-header"
                      className="px-3 pt-2 pb-0.5 font-wfmono text-[9px] uppercase tracking-[0.18em] text-wf-on-surface-variant"
                    >
                      Skills
                    </div>
                  ) : null
                const item =
                  row.kind === 'agent' ? (
                    <div
                      key={`a-${row.agent.slug}`}
                      id={`${listboxId}-opt-${i}`}
                      role="option"
                      aria-selected={isActive}
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={(e) => { e.preventDefault(); go(row.to) }}
                      className={base}
                    >
                      <span className="font-medium text-wf-on-surface truncate">{fullName(row.agent)}</span>
                      <span className="text-xs text-wf-on-surface-variant truncate">· {row.agent.role}</span>
                    </div>
                  ) : (
                    <div
                      key={`s-${row.skill.name}`}
                      id={`${listboxId}-opt-${i}`}
                      role="option"
                      aria-selected={isActive}
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={(e) => { e.preventDefault(); go(row.to) }}
                      className={base}
                    >
                      <span className="font-wfmono text-wf-on-surface truncate">{row.skill.name}</span>
                      <span className="text-xs text-wf-on-surface-variant truncate">· skill</span>
                    </div>
                  )
                return header ? [header, item] : item
              })}
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); go(`/search?q=${encodeURIComponent(query.trim())}`) }}
                className="w-full text-left px-3 py-2 mt-1 border-t border-wf-outline-variant font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-primary hover:bg-wf-surface-container"
              >
                See all results for “{query.trim()}”
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
