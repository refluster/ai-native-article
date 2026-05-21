// /workforce/skills — Skill repository index. Lists every entry from
// workforce-skills.json, with the SKILL.md description and the agent
// owners as chips back into /agents/:slug.
//
// Filter chips by status (ALL / ACTIVE / DEPRECATED / PAUSED) and a
// search box for name / description / owner. Pure client state.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import WorkforceLayout from '../components/WorkforceLayout'
import Typeplate from '../components/Typeplate'
import { loadWorkforceSkillManifest } from '../lib/skills'
import { loadWorkforceManifest, fullName } from '../lib/agents'
import type { SkillStatus, WorkforceSkill, WorkforceSkillManifest } from '../types/skill'
import type { WorkforceAgentManifest } from '../types/agent'

type Filter = 'all' | SkillStatus

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all',        label: 'ALL' },
  { id: 'active',     label: 'ACTIVE' },
  { id: 'deprecated', label: 'DEPRECATED' },
  { id: 'paused',     label: 'PAUSED' },
]

function statusTone(s: SkillStatus): string {
  if (s === 'active')     return 'text-wf-primary border-wf-primary'
  if (s === 'deprecated') return 'text-wf-tertiary border-wf-tertiary'
  return 'text-wf-on-surface-variant border-wf-outline-variant'
}

export default function SkillDirectory() {
  const [skillManifest, setSkillManifest] = useState<WorkforceSkillManifest | null>(null)
  const [agentManifest, setAgentManifest] = useState<WorkforceAgentManifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  useEffect(() => {
    document.title = 'Workforce — Skills'
    Promise.all([loadWorkforceSkillManifest(), loadWorkforceManifest()])
      .then(([s, a]) => {
        setSkillManifest(s)
        setAgentManifest(a)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  const agentBySlug = useMemo(() => {
    const m = new Map<string, WorkforceAgentManifest['agents'][number]>()
    agentManifest?.agents.forEach((a) => m.set(a.slug, a))
    return m
  }, [agentManifest])

  const rows = useMemo(() => {
    if (!skillManifest) return []
    const q = query.trim().toLowerCase()
    return skillManifest.skills
      .filter((s) => (filter === 'all' ? true : s.status === filter))
      .filter((s) => {
        if (!q) return true
        return (
          s.name.includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.owners.some((o) => o.includes(q))
        )
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [skillManifest, filter, query])

  if (error) {
    return (
      <WorkforceLayout>
        <div className="font-wfmono text-sm text-wf-tertiary">Could not load skill repository: {error}</div>
      </WorkforceLayout>
    )
  }
  if (!skillManifest || !agentManifest) {
    return (
      <WorkforceLayout>
        <div className="font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface-variant">Loading…</div>
      </WorkforceLayout>
    )
  }

  return (
    <WorkforceLayout>
      <section className="mb-6 sm:mb-8">
        <Typeplate label="DECK 03" value={`SKILLS · ${skillManifest.skills.length} ENTRIES`} className="mb-3" />
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
                    {s.name}
                  </div>
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
                {s.trigger_class} · {s.cost_class} cost
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
