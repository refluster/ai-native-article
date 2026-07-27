// The workforce brand mark, in React. Same geometry as public/favicon.svg
// (and the PNGs scripts/generate-icons.mjs renders from it), so the tab
// icon, the home-screen icon and the in-app wordmark are one mark rather
// than three lookalikes.
//
// Reading: one solid node above two open ones. Humans hold the
// constitutional layer and set direction (the filled steward node); agents
// carry execution beneath it (the open nodes); the edges are the delegation
// the org chart is made of — workforce/docs/mvv.md as a glyph.
//
// Colours come from tokens, not hex: the ground is `bg-wf-primary` on the
// wrapper and the figure paints in `currentColor`, so the mark re-themes
// with the palette (and lint:tokens stays green).

interface Props {
  /** Pixel size of the square mark. */
  size?: number
  className?: string
}

export default function BrandMark({ size = 32, className = '' }: Props) {
  return (
    <span
      aria-hidden
      className={`inline-flex items-center justify-center bg-wf-primary text-wf-on-primary rounded-wf-md shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 32 32" width={size * 0.78} height={size * 0.78} fill="none">
        <g stroke="currentColor" strokeWidth={1.9} strokeLinecap="round">
          <path d="M14.6 12.4 11.6 19.6" opacity={0.65} />
          <path d="M17.4 12.4 20.4 19.6" opacity={0.65} />
          <circle cx="10.4" cy="22.4" r="2.6" />
          <circle cx="21.6" cy="22.4" r="2.6" />
        </g>
        <circle cx="16" cy="9.6" r="3.1" fill="currentColor" />
      </svg>
    </span>
  )
}
