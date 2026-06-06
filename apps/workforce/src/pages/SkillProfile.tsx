// /workforce/skills/:name — single-skill view. Hero with name + status,
// the SKILL.md description, the deliverable contract (when llm-prose), and the
// owners list as agent chips that link back to /agents/:slug.
//
// When the live agents-api is configured the page also surfaces
// invocations_this_month / last_invoked_at; otherwise those KPIs read
// "—".

import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import WorkforceLayout from '../components/WorkforceLayout'
import Typeplate from '../components/Typeplate'
import Sigil from '../components/Sigil'
import KPIReadout from '../components/KPIReadout'
import {
  apiConfigured,
  fetchSkillLive,
  findSkill,
  loadWorkforceSkillManifest,
} from '../lib/skills'
import { fullName, loadWorkforceManifest } from '../lib/agents'
import type { SkillFile, SkillLiveRecord, WorkforceSkill } from '../types/skill'
import type { WorkforceAgent } from '../types/agent'

function formatRelative(iso: string | undefined): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  const mins = Math.round((Date.now() - t) / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 48) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}

function statusTone(s: WorkforceSkill['status']): string {
  if (s === 'active')     return 'text-wf-primary border-wf-primary'
  if (s === 'deprecated') return 'text-wf-tertiary border-wf-tertiary'
  return 'text-wf-on-surface-variant border-wf-outline-variant'
}

export default function SkillProfile() {
  const { name } = useParams<{ name: string }>()
  const [skill, setSkill] = useState<WorkforceSkill | null | undefined>(undefined)
  const [roster, setRoster] = useState<WorkforceAgent[]>([])
  const [live, setLive] = useState<SkillLiveRecord | null | undefined>(undefined)
  const [liveError, setLiveError] = useState<string | null>(null)

  useEffect(() => {
    if (!name) return
    let cancelled = false
    Promise.all([findSkill(name), loadWorkforceSkillManifest(), loadWorkforceManifest()])
      .then(([s, _all, agents]) => {
        if (cancelled) return
        setSkill(s ?? null)
        setRoster(agents.agents)
        document.title = s ? `Workforce — Skill · ${s.name}` : 'Workforce — Skill not found'
      })
      .catch(() => {
        if (cancelled) return
        setSkill(null)
      })
    return () => {
      cancelled = true
    }
  }, [name])

  useEffect(() => {
    if (!name || !apiConfigured()) {
      setLive(null)
      return
    }
    let cancelled = false
    fetchSkillLive(name)
      .then((rec) => {
        if (cancelled) return
        setLive(rec ?? null)
      })
      .catch((err) => {
        if (cancelled) return
        setLive(null)
        setLiveError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [name])

  const ownersResolved = useMemo(() => {
    if (!skill) return []
    const bySlug = new Map(roster.map((a) => [a.slug, a]))
    return skill.owners.map((slug) => ({ slug, agent: bySlug.get(slug) }))
  }, [skill, roster])

  if (skill === undefined) {
    return (
      <WorkforceLayout>
        <div className="font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface-variant">Loading…</div>
      </WorkforceLayout>
    )
  }
  if (skill === null) {
    return (
      <WorkforceLayout>
        <div className="font-wfmono text-sm text-wf-tertiary">Skill not found: {name}</div>
        <Link to="/skills" className="font-wfmono text-xs uppercase tracking-[0.14em] underline text-wf-on-surface-variant">
          ← back to skill repository
        </Link>
      </WorkforceLayout>
    )
  }

  return (
    <WorkforceLayout>
      <section className="mb-6 sm:mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div className="min-w-0">
          <Typeplate label="SKILL" value={`v${skill.version} · ${skill.created_at}`} className="mb-3" />
          <h1 className="font-headline text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter leading-[1.04] text-wf-on-surface break-words">
            {skill.name}
          </h1>
        </div>
        <span
          className={`self-start md:self-auto font-wfmono text-[11px] uppercase tracking-[0.14em] px-2.5 py-1 border ${statusTone(skill.status)}`}
        >
          {skill.status}
        </span>
      </section>

      {/* Description */}
      <section className="mb-6">
        <p className="text-sm sm:text-base text-wf-on-surface-variant leading-relaxed">{skill.description}</p>
      </section>

      {/* KPI strip */}
      <KPIReadout
        className="mb-6"
        items={[
          {
            cap: 'DELIVERABLE',
            value: skill.deliverable?.type ?? 'none',
            sub: skill.deliverable
              ? skill.deliverable.publish_notion
                ? 'published to Notion'
                : 'S3 artefact'
              : 'no published artefact',
          },
          { cap: 'COST CLASS', value: skill.cost_class, sub: `@${skill.version}` },
          {
            cap: 'THIS MONTH',
            value: apiConfigured() ? (live?.invocations_this_month ?? 0).toString() : '—',
            sub: apiConfigured() ? 'invocations' : 'live API not configured',
          },
          {
            cap: 'LAST INVOKED',
            value: apiConfigured() ? formatRelative(live?.last_invoked_at) : '—',
            sub: apiConfigured()
              ? live?.last_invoked_at?.slice(0, 16).replace('T', ' ') ?? 'never'
              : 'live API not configured',
          },
        ]}
      />

      {liveError && (
        <p className="mb-4 font-wfmono text-xs text-wf-tertiary">live stats unavailable: {liveError}</p>
      )}

      {/* Deliverable (llm-prose only) */}
      {skill.deliverable && (
        <section className="mb-6 border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
          <div className="border-b border-wf-outline-variant px-4 py-3">
            <Typeplate label="CONTRACT" value="DELIVERABLE" />
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 p-4 text-sm">
            <div>
              <dt className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">TYPE</dt>
              <dd className="font-semibold text-wf-on-surface">{skill.deliverable.type}</dd>
            </div>
            <div>
              <dt className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">PUBLISH NOTION</dt>
              <dd className="font-semibold text-wf-on-surface">{skill.deliverable.publish_notion ? 'yes' : 'no'}</dd>
            </div>
          </dl>
        </section>
      )}

      {/* Source — SKILL.md + sibling files (file list + selected file viewer) */}
      <SkillSourceBrowser skill={skill} />

      {/* Owners */}
      <section className="mb-6 border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
        <div className="border-b border-wf-outline-variant px-4 py-3">
          <Typeplate label="OWNERS" value={`${skill.owners.length} AGENTS`} />
        </div>
        {ownersResolved.length === 0 ? (
          <div className="p-4 font-wfmono text-xs text-wf-on-surface-variant">no owners assigned.</div>
        ) : (
          <ul className="divide-y divide-wf-outline-variant">
            {ownersResolved.map(({ slug, agent }) => (
              <li key={slug}>
                <Link
                  to={`/agents/${slug}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-wf-surface-container-hi transition-colors"
                >
                  <Sigil slug={slug} size={36} />
                  <div className="min-w-0">
                    <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
                      {slug.toUpperCase()}{agent ? ` · L${agent.depth}` : ''}
                    </div>
                    <div className="font-semibold text-wf-on-surface truncate">
                      {agent ? fullName(agent) : slug}
                    </div>
                    {agent && (
                      <div className="text-xs text-wf-on-surface-variant">
                        {agent.role} · {agent.residence}
                      </div>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Metadata */}
      <section className="mb-8 border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
        <div className="border-b border-wf-outline-variant px-4 py-3">
          <Typeplate label="META" value="REPOSITORY FIELDS" />
        </div>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4 font-wfmono text-xs">
          <Fact label="IMPROVEMENT AGENT" value={(live?.improvement_agent_override ?? skill.improvement_agent) ?? '—'} />
          <Fact label="CREATED" value={skill.created_at} />
          <Fact label="VERSION" value={skill.version} />
        </dl>
      </section>

      <Link to="/skills" className="font-wfmono text-xs uppercase tracking-[0.14em] underline text-wf-on-surface-variant">
        ← all skills
      </Link>
    </WorkforceLayout>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">{label}</dt>
      <dd className="text-sm text-wf-on-surface mt-0.5">{value}</dd>
    </div>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// GitHub-style file browser: SKILL.md (rendered) by default, sibling files
// switch the viewer below. Markdown files render through react-markdown so
// links / lists / headings come out styled; everything else falls back to a
// monospace <pre> block so the source is readable without per-language
// highlighting (a workforce SPA is for ops, not browsing arbitrary code).
function SkillSourceBrowser({ skill }: { skill: WorkforceSkill }) {
  const files = skill.files ?? []
  const [selectedPath, setSelectedPath] = useState<string>(() => {
    const md = files.find((f) => f.path === 'SKILL.md')
    return (md ?? files[0])?.path ?? ''
  })

  if (files.length === 0) {
    return (
      <section className="mb-6 border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-4 font-wfmono text-xs text-wf-on-surface-variant">
        no source files indexed for this skill.
      </section>
    )
  }

  const selected = files.find((f) => f.path === selectedPath) ?? files[0]

  return (
    <section className="mb-6 border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3">
        <Typeplate label="SOURCE" value={`${files.length} FILE${files.length === 1 ? '' : 'S'}`} />
      </div>

      {/* File tree (top) + viewer (below). Stacks naturally on every viewport. */}
      <div className="grid grid-cols-1 md:grid-cols-[14rem_minmax(0,1fr)]">
        <nav
          className="border-b md:border-b-0 md:border-r border-wf-outline-variant"
          aria-label="skill files"
        >
          <ul className="divide-y divide-wf-outline-variant">
            {files.map((f) => {
              const active = f.path === selected.path
              return (
                <li key={f.path}>
                  <button
                    type="button"
                    onClick={() => setSelectedPath(f.path)}
                    className={`w-full text-left flex items-baseline justify-between gap-2 px-4 py-2 font-wfmono text-xs transition-colors ${
                      active
                        ? 'bg-wf-surface-container-hi text-wf-on-surface'
                        : 'text-wf-on-surface-variant hover:bg-wf-surface-container hover:text-wf-on-surface'
                    }`}
                  >
                    <span className="truncate">{f.path}</span>
                    <span className="text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant shrink-0">
                      {formatBytes(f.size)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-wf-outline-variant bg-wf-surface-container">
            <span className="font-wfmono text-xs text-wf-on-surface truncate">{selected.path}</span>
            <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant shrink-0">
              {selected.language} · {formatBytes(selected.size)}
            </span>
          </div>
          <SkillFileView file={selected} />
        </div>
      </div>
    </section>
  )
}

function SkillFileView({ file }: { file: SkillFile }) {
  if (file.contents === null) {
    return (
      <div className="p-4 font-wfmono text-xs text-wf-on-surface-variant">
        {file.binary
          ? 'binary file — open in repo to view.'
          : 'file too large to preview in the manifest — open in repo to view.'}
      </div>
    )
  }
  if (file.language === 'markdown') {
    return (
      <div className="p-4 sm:p-6 skill-md-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{file.contents}</ReactMarkdown>
      </div>
    )
  }
  return (
    <pre className="p-4 overflow-x-auto font-wfmono text-xs leading-relaxed text-wf-on-surface bg-wf-surface-container-lo whitespace-pre">
      <code>{file.contents}</code>
    </pre>
  )
}
