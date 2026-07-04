// /workforce/skills — Skill repository index. Lists every entry LIVE from
// the agents-api `GET /skills` (the authoritative DDB `SKILL#` store,
// ADR-0008 §7 — not the build-time workforce-skills.json snapshot), with
// the SKILL.md description and the agent owners as chips into /agents/:slug.
//
// Filter chips by status (ALL / ACTIVE / DEPRECATED / PAUSED) and a
// search box for name / description / owner. Pure client state.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import WorkforceLayout from '../components/WorkforceLayout'
import Typeplate from '../components/Typeplate'
import { loadWorkforceSkills } from '../lib/skills'
import { loadWorkforceManifest, fullName } from '../lib/agents'
import type { SkillStatus, WorkforceSkill } from '../types/skill'
import type { WorkforceAgentManifest } from '../types/agent'

type Filter = 'all' | SkillStatus

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all',        label: 'ALL' },
  { id: 'active',     label: 'ACTIVE' },
  { id: 'stale',      label: 'STALE' },
  { id: 'deprecated', label: 'DEPRECATED' },
]

function statusTone(s: SkillStatus): string {
  if (s === 'active')     return 'text-wf-primary border-wf-primary'
  if (s === 'deprecated') return 'text-wf-tertiary border-wf-tertiary'
  if (s === 'archived')   return 'text-wf-archived border-wf-archived'
  return 'text-wf-on-surface-variant border-wf-outline-variant'
}

export default function SkillDirectory() {
  const [skills, setSkills] = useState<WorkforceSkill[] | null>(null)
  const [agentManifest, setAgentManifest] = useState<WorkforceAgentManifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  // Archived skills are soft-deleted: hidden by default, revealed by the
  // checkbox (their EXEC/deliverable history stays reachable via the link).
  const [showArchived, setShowArchived] = useState(false)

  useEffect(() => {
    document.title = 'Workforce — Skills'
    Promise.all([loadWorkforceSkills({ includeArchived: showArchived }), loadWorkforceManifest()])
      .then(([s, a]) => {
        setSkills(s)
        setAgentManifest(a)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [showArchived])

  const agentBySlug = useMemo(() => {
    const m = new Map<string, WorkforceAgentManifest['agents'][number]>()
    agentManifest?.agents.forEach((a) => m.set(a.slug, a))
    return m
  }, [agentManifest])

  const rows = useMemo(() => {
    if (!skills) return []
    const q = query.trim().toLowerCase()
    return skills
      .filter((s) => (filter === 'all' ? true : s.status === filter))
      .filter((s) => {
        if (!q) return true
        return (
          s.name.includes(q) ||
          (s.display_name ?? '').toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.owners.some((o) => o.includes(q))
        )
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [skills, filter, query])

  if (error) {
    return (
      <WorkforceLayout>
        <div className="font-wfmono text-sm text-wf-tertiary">Could not load skill repository: {error}</div>
      </WorkforceLayout>
    )
  }
  if (!skills || !agentManifest) {
    return (
      <WorkforceLayout>
        <div className="font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface-variant">Loading…</div>
      </WorkforceLayout>
    )
  }

  return (
    <WorkforceLayout>
      <section className="mb-6 sm:mb-8">
        <Typeplate label="SKILLS" value={`SKILLS · ${skills.length} ENTRIES`} className="mb-3" />
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <h1 className="font-headline text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter leading-[1.04] text-wf-on-surface">
            The skill repository.
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`font-wfmono text-[10px] uppercase tracking-[0.14em] px-3 py-1.5 border transition-colors ${
                  filter === f.id
                    ? 'border-wf-tertiary text-wf-tertiary'
                    : 'border-wf-outline-variant text-wf-on-surface-variant hover:border-wf-on-surface-variant hover:text-wf-on-surface'
                }`}
              >
                {f.label}
              </button>
            ))}
            <label className="flex items-center gap-1.5 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="accent-wf-primary"
              />
              ARCHIVED
            </label>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="search name / description / owner"
              className="font-wfmono text-xs px-3 py-1.5 border border-wf-outline-variant bg-wf-surface-container-lo text-wf-on-surface placeholder:text-wf-on-surface-variant w-full md:w-64 focus:outline-none focus:border-wf-primary"
            />
          </div>
        </div>
      </section>

      <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {rows.map((s) => (
          <li key={s.name}>
            <Link
              to={`/skills/${s.name}`}
              className="block h-full border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-4 hover:bg-wf-surface-container-hi transition-colors"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
                    SKILL · v{s.version}
                  </div>
                  <div className="font-headline text-xl font-black tracking-tight text-wf-on-surface truncate">
                    {s.display_name ?? s.name}
                  </div>
                  {s.display_name && (
                    <div className="font-wfmono text-[10px] text-wf-on-surface-variant truncate">{s.name}</div>
                  )}
                </div>
                <span
                  className={`font-wfmono text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 border ${statusTone(s.status)}`}
                >
                  {s.status}
                </span>
              </div>
              <p className="text-sm text-wf-on-surface-variant line-clamp-3 mb-3">{s.description}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {s.owners.map((slug) => {
                  const a = agentBySlug.get(slug)
                  return (
                    <span
                      key={slug}
                      className="font-wfmono text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 border border-wf-outline-variant text-wf-on-surface bg-wf-surface-container"
                      title={a ? fullName(a) : slug}
                    >
                      {slug}
                    </span>
                  )
                })}
              </div>
              <div className="mt-3 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
                {s.cost_class} cost
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {rows.length === 0 && (
        <div className="mt-6 font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface-variant">
          no skills match.
        </div>
      )}
    </WorkforceLayout>
  )
}
