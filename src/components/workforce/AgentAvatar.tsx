// Procedural avatar — first letter on a slug-hash-derived HSL background.
// Per PR #28's resolution: no per-agent SVG asset, infinite scale.

import { slugHue } from '../../lib/workforce-agents'

interface Props {
  slug: string
  /** First letter shown inside the circle. Defaults to slug[0]. */
  initial?: string
  /** Diameter in px. Defaults to 40. */
  size?: number
}

export default function AgentAvatar({ slug, initial, size = 40 }: Props) {
  const hue = slugHue(slug)
  const letter = (initial ?? slug[0] ?? '?').toUpperCase()
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: `hsl(${hue} 60% 45%)`,
        color: 'white',
        fontWeight: 600,
        fontSize: Math.round(size * 0.45),
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {letter}
    </span>
  )
}
