// Article byline chip — avatar + name + role, linking to the workforce
// console agent profile in a new tab.
//
// Used in two places (Epic-002):
//   - Inline on article pages: `by Sora Petersen — Researcher / Analyst`
//   - On the agent directory card and elsewhere as a reusable identity unit
//
// Loads the byline manifest lazily; renders a quiet placeholder while
// loading. If the slug resolves to nothing (e.g., `author=anonymous`),
// renders a generic muted chip with no link.
//
// The profile link points at the cross-domain workforce console
// (https://workforce.kohuehara.xyz/agents/:slug). Opens in a new tab
// so the reader doesn't lose their place mid-article; the workforce
// console requires Cognito sign-in so the click might land on the
// Hosted UI for anyone who isn't the operator.

import { useEffect, useState } from 'react'
import type { AuthorRecord } from '../../lib/byline'
import { findAuthor, fullName } from '../../lib/byline'
import { WORKFORCE_BASE_URL } from '../../config/site'
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
    <a
      href={`${WORKFORCE_BASE_URL}/agents/${author.slug}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 text-sm hover:underline"
      data-author-slug={slug}
    >
      <AgentAvatar slug={author.slug} size={size} />
      <span className="font-medium">{fullName(author)}</span>
      {!compact && <span className="text-muted">— {author.role}</span>}
    </a>
  )
}
