// Article byline chip — avatar + name + role, links to the agent profile.
//
// Used in two places (RFC-002):
//   - Inline on article pages: `by Sora Petersen — Researcher / Analyst`
//   - On the agent directory card and elsewhere as a reusable identity unit
//
// Loads the workforce manifest lazily; renders a quiet placeholder while
// loading. If the slug resolves to nothing (e.g., `author=anonymous`),
// renders a generic muted chip so we never link to a 404 profile.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { WorkforceAgent } from '../../types/workforce-agent'
import { findAgent, fullName } from '../../lib/workforce-agents'
import AgentAvatar from './AgentAvatar'

interface Props {
  /** Persona slug. `anonymous` or any unknown slug renders a non-linked muted chip. */
  slug: string
  /** Avatar size in px. Defaults to 28. */
  size?: number
  /** When true, omit the role suffix. */
  compact?: boolean
}

export default function AuthorChip({ slug, size = 28, compact = false }: Props) {
  const [agent, setAgent] = useState<WorkforceAgent | undefined>(undefined)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    findAgent(slug)
      .then((a) => {
        if (!cancelled) setAgent(a)
      })
      .catch(() => {
        if (!cancelled) setAgent(undefined)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  if (loading) {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-muted">
        <span
          aria-hidden
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            backgroundColor: 'rgb(var(--color-surface-2, 200 200 200))',
            display: 'inline-block',
          }}
        />
      </span>
    )
  }

  if (!agent) {
    // Unknown / anonymous author — show a quiet placeholder, no link.
    return (
      <span className="inline-flex items-center gap-2 text-sm text-muted" data-author-slug={slug}>
        <AgentAvatar slug={slug || 'anonymous'} size={size} />
        <span>{slug === 'anonymous' ? 'anonymous' : slug}</span>
      </span>
    )
  }

  return (
    <Link
      to={`/workforce/agents/${agent.slug}`}
      className="inline-flex items-center gap-2 text-sm hover:underline"
      data-author-slug={slug}
    >
      <AgentAvatar slug={agent.slug} size={size} />
      <span className="font-medium">{fullName(agent)}</span>
      {!compact && <span className="text-muted">— {agent.role}</span>}
    </Link>
  )
}
