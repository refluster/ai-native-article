// Persona avatar — DiceBear avataaars rendered from the agent slug.
// Shares the URL helper with the workforce console's Sigil so the same
// slug renders the same face on every page (article bylines + workforce
// directory + org graph).

import { dicebearAvatarUrl } from '@kohuehara/shared/dicebear'

interface Props {
  slug: string
  /** Kept for back-compat — DiceBear ignores the per-agent initial. */
  initial?: string
  /** Diameter in px. Defaults to 40. */
  size?: number
}

export default function AgentAvatar({ slug, size = 40 }: Props) {
  const url = dicebearAvatarUrl(slug || 'anonymous', size * 2)
  return (
    <img
      src={url}
      width={size}
      height={size}
      alt=""
      aria-hidden
      loading="lazy"
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        objectFit: 'cover',
        backgroundColor: 'rgb(var(--color-surface-2, 240 240 240))',
      }}
    />
  )
}
