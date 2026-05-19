// /workforce/agents/:slug — LinkedIn-style profile page.
// RFC-002 implementation, v1 minimum: header + about + skills + identity
// + bias-disclosure note. Stats card (runs / tokens / spend) wired in a
// follow-up once the agents-api is fronted by the SPA.

import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  apiConfigured,
  fetchAgentDeliverables,
  fetchAgentLive,
  findAgent,
  fullName,
  type AgentDeliverable,
  type AgentLiveRecord,
} from '../../lib/workforce-agents'
import type { WorkforceAgent } from '../../types/workforce-agent'
import AgentAvatar from '../../components/workforce/AgentAvatar'

const STREAM_LABEL: Record<WorkforceAgent['streams'][number], string> = {
  internal: 'workforce',
  client: 'client work',
  editorial: 'editorial',
}

export default function AgentProfile() {
  const { slug } = useParams<{ slug: string }>()
  const [agent, setAgent] = useState<WorkforceAgent | null | undefined>(undefined)
  const [live, setLive] = useState<AgentLiveRecord | null | undefined>(undefined)
  const [delivs, setDelivs] = useState<AgentDeliverable[] | null>(null)
  const [liveError, setLiveError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    findAgent(slug)
      .then((a) => setAgent(a ?? null))
      .catch(() => setAgent(null))
  }, [slug])

  useEffect(() => {
    if (!slug || !apiConfigured()) {
      setLive(null)
      setDelivs([])
      return
    }
    let cancelled = false
    Promise.all([fetchAgentLive(slug), fetchAgentDeliverables(slug, 20)])
      .then(([l, d]) => {
        if (cancelled) return
        setLive(l ?? null)
        setDelivs(d)
      })
      .catch((err) => {
        if (cancelled) return
        setLive(null)
        setDelivs([])
        setLiveError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  useEffect(() => {
    if (agent) document.title = `${fullName(agent)} — Workforce`
  }, [agent])

  if (agent === undefined) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <p className="text-muted">Loading…</p>
      </div>
    )
  }

  if (agent === null) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-2xl font-bold mb-4">Not found</h1>
        <p className="text-muted">
          No agent named "{slug}". <Link to="/workforce/agents" className="underline">Back to the directory</Link>.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <Link to="/workforce/agents" className="text-sm text-muted hover:underline">
        ← Workforce
      </Link>

      <header className="mt-4 flex items-start gap-4">
        <AgentAvatar slug={agent.slug} size={80} />
        <div className="flex-1">
          <h1 className="text-3xl font-bold">{fullName(agent)}</h1>
          <p className="text-lg text-muted">{agent.role}</p>
          <p className="text-sm text-muted">
            {agent.residence} · {agent.default_project}
          </p>
        </div>
      </header>

      {agent.about && (
        <section className="mt-6">
          <h2 className="sr-only">About</h2>
          <p className="text-base">{agent.about}</p>
        </section>
      )}

      <section className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
        <Stat label="Model" value={agent.model} />
        <Stat label="Monthly budget" value={`USD ${agent.budget_monthly_usd}`} />
        <Stat label="Cadence" value={agent.schedule_note} />
        <Stat label="Prompt version" value={`v${agent.prompt_version}`} />
        <Stat label="Primary deliverable" value={`${agent.primary_deliverable_type} (${agent.primary_deliverable_kind})`} />
        <Stat
          label="Streams"
          value={agent.streams.map((s) => STREAM_LABEL[s]).join(', ')}
        />
        {agent.code_execution === 'claude-code-routine-on-gha' && (
          <Stat
            label="Code execution"
            value="Claude Code routine on GitHub Actions (R-N1 exception)"
          />
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2">Skills</h2>
        <ul className="flex flex-wrap gap-2">
          {agent.skills.map((skill) => (
            <li
              key={skill}
              className="px-2 py-1 text-xs border border-surface-2 text-muted"
            >
              {skill}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 text-sm text-muted">
        <p>
          {fullName(agent)} is an LLM-driven persona on the Workforce platform. Articles bylined to{' '}
          {agent.first_name} are produced by an Anthropic Claude model running on AWS Lambda;{' '}
          the persona's voice, biases, and limitations are described in their{' '}
          <a
            href={`https://github.com/refluster/ai-native-article/blob/main/workforce/agents/${agent.slug}/system.md`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            system prompt
          </a>{' '}
          and acknowledged in every article footer.
        </p>
      </section>

      <LiveSection live={live} delivs={delivs} liveError={liveError} agent={agent} />
    </div>
  )
}

function LiveSection({
  live,
  delivs,
  liveError,
  agent,
}: {
  live: AgentLiveRecord | null | undefined
  delivs: AgentDeliverable[] | null
  liveError: string | null
  agent: WorkforceAgent
}) {
  if (!apiConfigured()) {
    return (
      <section className="mt-8 text-xs text-muted">
        <p>
          Live runs, spend, and deliverables would appear here once the operator wires the workforce agents-api URL
          into <code>src/config/workforce.ts</code>.
        </p>
      </section>
    )
  }
  if (liveError) {
    return (
      <section className="mt-8 text-xs text-muted">
        <p>Could not reach the agents API: {liveError}</p>
      </section>
    )
  }
  if (live === undefined || delivs === null) {
    return (
      <section className="mt-8 text-xs text-muted">
        <p>Loading live data…</p>
      </section>
    )
  }

  const monthBudget = agent.budget_monthly_usd
  const spend = live?.cost_this_month_usd ?? 0
  const spendPct = monthBudget > 0 ? Math.min(100, Math.round((spend / monthBudget) * 100)) : 0

  return (
    <>
      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-3">This month</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <LiveStat label="Runs" value={live ? String(live.runs_this_month) : '—'} />
          <LiveStat
            label="Spend"
            value={live ? `$${spend.toFixed(2)} / $${monthBudget}` : '—'}
            hint={live ? `${spendPct}% of cap` : undefined}
          />
          <LiveStat
            label="Last run"
            value={live?.last_run_at ? formatRelative(live.last_run_at) : '—'}
            hint={live?.last_run_status}
          />
          <LiveStat label="Status" value={statusLabel(live)} />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-3">Recent deliverables</h2>
        {delivs.length === 0 ? (
          <p className="text-sm text-muted">No deliverables yet. Either the persona hasn't fired since deploy or the
          orchestrator tick is still disabled.</p>
        ) : (
          <ul className="divide-y divide-surface-2">
            {delivs.map((d) => {
              const id = d.sk.replace(/^DELIV#/, '')
              const link = d.pr_url ?? (d.notion_page_id ? `https://www.notion.so/${d.notion_page_id.replace(/-/g, '')}` : undefined)
              return (
                <li key={id} className="py-3 flex items-baseline gap-3 text-sm">
                  <span className="text-xs text-muted shrink-0 w-28">{d.created_at?.slice(0, 10)}</span>
                  <span className="text-xs uppercase tracking-wide text-muted shrink-0 w-24">{d.type}</span>
                  <span className="flex-1">
                    {link ? (
                      <a href={link} target="_blank" rel="noopener noreferrer" className="underline">
                        {d.kind} · {id.slice(0, 8)}
                      </a>
                    ) : (
                      <>{d.kind} · {id.slice(0, 8)}</>
                    )}
                    {d.skill_name && (
                      <span className="ml-2 text-xs text-muted">via {d.skill_name}@{d.skill_version}</span>
                    )}
                    {d.status === 'pending' && <span className="ml-2 text-xs text-muted">(pending)</span>}
                    {d.status === 'timeout' && <span className="ml-2 text-xs text-muted">(timeout)</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}

function LiveStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="font-medium">{value}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  )
}

function statusLabel(live: AgentLiveRecord | null): string {
  if (!live) return '—'
  if (live.archived) return 'archived'
  if (live.paused) return 'paused'
  return 'active'
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  const mins = Math.round((Date.now() - t) / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 48) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  )
}
