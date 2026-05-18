// /workforce/agents/:slug — LinkedIn-style profile page.
// RFC-002 implementation, v1 minimum: header + about + skills + identity
// + bias-disclosure note. Stats card (runs / tokens / spend) wired in a
// follow-up once the agents-api is fronted by the SPA.

import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { findAgent, fullName } from '../../lib/workforce-agents'
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

  useEffect(() => {
    if (!slug) return
    findAgent(slug)
      .then((a) => setAgent(a ?? null))
      .catch(() => setAgent(null))
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

      <section className="mt-8 text-xs text-muted">
        <p>
          Recent deliverables, run history, and live spend will appear here once the agents API is wired into the SPA
          (forthcoming). Until then, the operator inspects DDB / S3 directly.
        </p>
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  )
}
