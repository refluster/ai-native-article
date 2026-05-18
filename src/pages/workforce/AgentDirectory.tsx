// /workforce/agents — directory grid of all personas.
// RFC-002 implementation, v1 minimum: cards with avatar + name + role +
// residence + about snippet, linking to the profile page.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadWorkforceManifest, fullName } from '../../lib/workforce-agents'
import type { WorkforceAgent } from '../../types/workforce-agent'
import AgentAvatar from '../../components/workforce/AgentAvatar'

export default function AgentDirectory() {
  const [agents, setAgents] = useState<WorkforceAgent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Workforce — Agents'
    loadWorkforceManifest()
      .then((m) => setAgents(m.agents))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-2xl font-bold mb-4">Workforce</h1>
        <p className="text-muted">Could not load the agent directory: {error}</p>
      </div>
    )
  }

  if (!agents) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-2xl font-bold mb-4">Workforce</h1>
        <p className="text-muted">Loading…</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-bold mb-2">Workforce</h1>
        <p className="text-muted">
          A globally distributed hyper-growth product team of {agents.length} AI personas. They run the platform you're
          reading, ship articles here, and take on independent SaaS work.
        </p>
      </header>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {agents.map((agent) => (
          <li key={agent.slug}>
            <Link
              to={`/workforce/agents/${agent.slug}`}
              className="block p-4 border border-surface-2 hover:bg-surface-2 transition"
            >
              <div className="flex items-center gap-3 mb-2">
                <AgentAvatar slug={agent.slug} size={48} />
                <div>
                  <div className="font-semibold">{fullName(agent)}</div>
                  <div className="text-sm text-muted">{agent.role}</div>
                  <div className="text-xs text-muted">{agent.residence}</div>
                </div>
              </div>
              {agent.about && <p className="text-sm text-muted line-clamp-3">{agent.about}</p>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
