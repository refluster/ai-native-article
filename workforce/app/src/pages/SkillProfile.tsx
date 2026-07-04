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
  fetchSkillExecutions,
  fetchSkillLive,
  findSkill,
  loadWorkforceSkillManifest,
  patchSkillConfig,
} from '../lib/skills'
import { fullName, loadWorkforceManifest } from '../lib/agents'
import { SIGV4_IS_CONFIGURED } from '../config/auth'
import StatusBadge from '../components/StatusBadge'
import type { SkillExecution, SkillFile, SkillLiveRecord, WorkforceSkill } from '../types/skill'
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
  if (s === 'archived')   return 'text-wf-archived border-wf-archived'
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

  // Agents still bound to this skill (any trigger). Archive does NOT unbind —
  // existing bindings keep firing (ADR-0017) — so the archive confirm must
  // say exactly who keeps running it, not leave the operator to guess.
  const boundAgents = useMemo(() => {
    if (!skill) return []
    return roster.filter((a) => a.bindings?.some((b) => b.skill === skill.name)).map((a) => a.slug)
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
          <Typeplate label="SKILL" value={`v${live?.version ?? skill.version} · ${skill.created_at}`} className="mb-3" />
          <h1 className="font-headline text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter leading-[1.04] text-wf-on-surface break-words">
            {live?.display_name ?? skill.display_name ?? skill.name}
          </h1>
          {(live?.display_name ?? skill.display_name) && (
            <div className="mt-1 font-wfmono text-xs text-wf-on-surface-variant">{skill.name}</div>
          )}
        </div>
        <div className="flex items-center gap-2 self-start md:self-auto">
          <span
            className={`font-wfmono text-[11px] uppercase tracking-[0.14em] px-2.5 py-1 border ${statusTone(live?.status ?? skill.status)}`}
          >
            {live?.status ?? skill.status}
          </span>
          <SkillLifecycleControls
            name={skill.name}
            displayName={live?.display_name ?? skill.display_name ?? undefined}
            status={live?.status ?? skill.status}
            boundAgents={boundAgents}
            onChanged={(next) => setLive((prev) => (prev ? { ...prev, ...next } : prev))}
          />
        </div>
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

      {/* Executions — the per-skill run ledger (ADR-0017 observability):
          who ran this skill, when, with what outcome. Filterable by agent
          + status; each row links agent + project for the drill-down. */}
      <SkillExecutionsPanel name={skill.name} />

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

// SKILL.md (and any Agent-Skills markdown) opens with a YAML frontmatter
// block (`---\nname: …\ndescription: …\n---`). react-markdown has no
// frontmatter plugin, so it parsed that block as body: the closing `---`
// became a setext heading underline and collapsed name+description into one
// giant bold line. Split the block out and render it as a legible key/value
// card instead, then hand the real body to react-markdown.
export function splitFrontmatter(src: string): {
  frontmatter: Array<[string, string]> | null
  body: string
} {
  const m = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(src)
  if (!m) return { frontmatter: null, body: src }

  const fields: Array<[string, string]> = []
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim()) continue
    // A new key starts flush-left as `key:`; anything indented is a folded
    // continuation of the previous value (YAML block/wrapped scalar).
    const keyMatch = /^([^\s:][^:]*):[ \t]*(.*)$/.exec(line)
    if (!keyMatch) {
      if (fields.length) fields[fields.length - 1][1] = `${fields[fields.length - 1][1]} ${line.trim()}`.trim()
      continue
    }
    let value = keyMatch[2].trim()
    if (value.length >= 2 && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")))) {
      value = value.slice(1, -1)
    }
    fields.push([keyMatch[1].trim(), value])
  }

  return { frontmatter: fields.length ? fields : null, body: src.slice(m[0].length) }
}

function FrontmatterCard({ fields }: { fields: Array<[string, string]> }) {
  return (
    <div className="skill-md-frontmatter">
      <div className="skill-md-frontmatter-cap">FRONTMATTER</div>
      <dl>
        {fields.map(([k, v]) => (
          <div key={k} className="skill-md-frontmatter-row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
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
    const { frontmatter, body } = splitFrontmatter(file.contents)
    return (
      <div className="p-4 sm:p-6 skill-md-body">
        {frontmatter && <FrontmatterCard fields={frontmatter} />}
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
      </div>
    )
  }
  return (
    <pre className="p-4 overflow-x-auto font-wfmono text-xs leading-relaxed text-wf-on-surface bg-wf-surface-container-lo whitespace-pre">
      <code>{file.contents}</code>
    </pre>
  )
}

// Archive is a LIST-side soft delete, not a kill switch: existing bindings
// keep firing until unbound (ADR-0017 documents this deliberately). The
// confirm dialog must therefore name the agents that will keep running the
// skill, or the operator's mental model of "archive = stopped" ships a
// silent surprise.
export function archiveConfirmMessage(name: string, boundAgents: string[]): string {
  const bindingWarning =
    boundAgents.length > 0
      ? `⚠ Still bound to ${boundAgents.length} agent${boundAgents.length === 1 ? '' : 's'} (${boundAgents.join(', ')}) — archiving does NOT stop execution. Unbind to stop the runs.`
      : 'No agents are currently bound to this skill.'
  return `Archive skill "${name}"? It disappears from the default list and new bindings are rejected; its run/deliverable history stays intact.\n\n${bindingWarning}`
}

// ─── Lifecycle controls: rename display label + archive/unarchive ─────────
// SigV4-gated (same affordance pattern as ProjectRenameButton /
// ProjectArchiveButton). The slug never changes — rename touches only the
// display label; archive is the ADR-0017 soft delete.
function SkillLifecycleControls({
  name,
  displayName,
  status,
  boundAgents,
  onChanged,
}: {
  name: string
  displayName?: string
  status: WorkforceSkill['status']
  /** Slugs of agents whose bindings still reference this skill — archive
   *  does not unbind them, so the confirm dialog names them explicitly. */
  boundAgents: string[]
  onChanged: (next: Partial<SkillLiveRecord>) => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sigv4Ready = SIGV4_IS_CONFIGURED

  async function rename() {
    const next = window.prompt(
      `Display name for "${name}" (the slug/URL never changes; 1–120 chars, any script):`,
      displayName ?? '',
    )
    if (next === null) return
    const trimmed = next.trim()
    if (trimmed.length === 0 || trimmed.length > 120) return
    setPending(true)
    setError(null)
    try {
      const updated = await patchSkillConfig(name, { display_name: trimmed })
      onChanged({ display_name: updated.display_name })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  async function flipArchive() {
    const target = status === 'archived' ? 'active' : 'archived'
    const ok = window.confirm(
      target === 'archived'
        ? archiveConfirmMessage(name, boundAgents)
        : `Restore skill "${name}" to active?`,
    )
    if (!ok) return
    setPending(true)
    setError(null)
    try {
      const updated = await patchSkillConfig(name, { status: target })
      onChanged({ status: updated.status })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  const btn =
    'font-wfmono text-[10px] uppercase tracking-[0.14em] px-2 py-1 border border-wf-outline-variant rounded-wf-sm text-wf-on-surface hover:text-wf-primary hover:border-wf-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const title = sigv4Ready ? undefined : 'sigv4 broker not configured — wire VITE_COGNITO_IDENTITY_POOL_ID'

  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={rename} disabled={!sigv4Ready || pending} title={title} className={btn}>
        ✎ RENAME
      </button>
      <button type="button" onClick={flipArchive} disabled={!sigv4Ready || pending} title={title} className={btn}>
        {status === 'archived' ? '● UNARCHIVE' : '● ARCHIVE'}
      </button>
      {error && (
        <span role="alert" className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-throwing">
          {error.slice(0, 80)}
        </span>
      )}
    </div>
  )
}

// ─── Per-skill run ledger (ADR-0017 observability) ─────────────────────────
function SkillExecutionsPanel({ name }: { name: string }) {
  const [execs, setExecs] = useState<SkillExecution[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [agentFilter, setAgentFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    fetchSkillExecutions(name, { limit: 50 })
      .then((items) => {
        if (!cancelled) setExecs(items)
      })
      .catch((err) => {
        if (!cancelled) {
          setExecs([])
          setError(err instanceof Error ? err.message : String(err))
        }
      })
    return () => {
      cancelled = true
    }
  }, [name])

  const agents = useMemo(() => [...new Set((execs ?? []).map((e) => e.agent_slug))].sort(), [execs])
  const rows = (execs ?? [])
    .filter((e) => !agentFilter || e.agent_slug === agentFilter)
    .filter((e) => !statusFilter || e.status === statusFilter)

  return (
    <section className="mb-6 border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3 flex flex-wrap items-center justify-between gap-2">
        <Typeplate label="EXECUTIONS" value={execs ? `LAST ${rows.length} RUNS` : '—'} />
        <div className="flex items-center gap-2">
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="font-wfmono text-[10px] uppercase tracking-[0.14em] px-2 py-1 border border-wf-outline-variant bg-wf-surface-container-lo text-wf-on-surface-variant focus:outline-none"
            aria-label="filter by agent"
          >
            <option value="">ALL AGENTS</option>
            {agents.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="font-wfmono text-[10px] uppercase tracking-[0.14em] px-2 py-1 border border-wf-outline-variant bg-wf-surface-container-lo text-wf-on-surface-variant focus:outline-none"
            aria-label="filter by status"
          >
            <option value="">ALL STATUS</option>
            {['ok', 'throw', 'skipped', 'failed_artefact_redaction'].map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
        </div>
      </div>
      {execs === null ? (
        <p className="px-4 py-4 font-wfmono text-xs text-wf-on-surface-variant">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-wf-on-surface-variant leading-relaxed">
          {error ? `run ledger unavailable: ${error}` : 'No executions recorded for this skill yet.'}
        </p>
      ) : (
        <ul className="divide-y divide-wf-outline-variant">
          {rows.map((e) => (
            <li key={e.exec_ulid} className="px-4 py-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-wfmono text-xs text-wf-on-surface-variant whitespace-nowrap">
                {e.started_at.slice(0, 16).replace('T', ' ')}
              </span>
              <Link to={`/agents/${e.agent_slug}`} className="font-wfmono text-xs text-wf-on-surface hover:text-wf-primary">
                {e.agent_slug}
              </Link>
              <Link
                to={`/projects/${encodeURIComponent(e.project_id)}`}
                className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant hover:text-wf-primary"
              >
                {e.project_id}
              </Link>
              <StatusBadge status={e.status} error={e.error} />
              <span className="basis-full text-sm text-wf-on-surface-variant truncate" title={e.artifact_ref?.uri}>
                {e.summary ?? e.artifact_ref?.summary ?? (e.error ? e.error.slice(0, 80) : '—')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
