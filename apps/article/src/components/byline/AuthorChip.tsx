// Article byline chip — avatar + name + role.
//
// Used in two places (RFC-002):
//   - Inline on article pages: `by Sora Petersen — Researcher / Analyst`
//   - On the agent directory card and elsewhere as a reusable identity unit
//
// Loads the byline manifest lazily; renders a quiet placeholder while
// loading. If the slug resolves to nothing (e.g., `author=anonymous`),
// renders a generic muted chip.
//
// PR-A leaves the chip static — it no longer links to the workforce
// console because the workforce app now lives on a different domain.
// PR-C reattaches an absolute link to https://workforce.kohuehara.xyz
// once the deploy target is live.

import { useEffect, useState } from 'react'
import type { AuthorRecord } from '../../lib/byline'
import { findAuthor, fullName } from '../../lib/byline'
import AgentAvatar from './AgentAvatar'

interface Props {
  /** Persona slug. `anonymous` or any unknown slug renders a muted chip. */
  slug: string
  /** Avatar size in px. Defaults to 28. */
  size?: number
  /** When true, omit the role suffix. */
  compact?: boolean
}

export default function AuthorChip({ slug, size = 28, compact = false }: Props) {
  const [author, setAuthor] = useState<AuthorRecord | undefined>(undefined)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    findAuthor(slug)
      .then((a) => {
        if (!cancelled) setAuthor(a)
      })
      .catch(() => {
        if (!cancelled) setAuthor(undefined)
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

  if (!author) {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-muted" data-author-slug={slug}>
        <AgentAvatar slug={slug || 'anonymous'} size={size} />
        <span>{slug === 'anonymous' ? 'anonymous' : slug}</span>
      </span>
    )
  }

  return (
    <span
      className="inline-flex items-center gap-2 text-sm"
      data-author-slug={slug}
    >
      <AgentAvatar slug={author.slug} size={size} />
      <span className="font-medium">{fullName(author)}</span>
      {!compact && <span className="text-muted">— {author.role}</span>}
    </span>
  )
}
