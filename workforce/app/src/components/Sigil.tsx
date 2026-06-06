// Persona avatar — DiceBear avataaars rendered from the agent slug.
// Same slug → same face across the workforce console *and* the article
// byline chip (which consumes the same shared helper). The component
// keeps its historical "Sigil" name because all callers already import
// it that way; semantically it is now a portrait, not a maker's-mark.
//
// See packages/shared/src/dicebear.ts for the URL contract.

import { dicebearAvatarUrl } from '@kohuehara/shared/dicebear';

interface Props {
  slug: string;
  /** Pixel size of the square (default 56). */
  size?: number;
}

export default function Sigil({ slug, size = 56 }: Props) {
  const url = dicebearAvatarUrl(slug, size * 2);
  return (
    <img
      src={url}
      width={size}
      height={size}
      alt=""
      aria-hidden
      loading="lazy"
      style={{
        display: 'block',
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: '50%',
        border: '1px solid var(--wf-sigil-border)',
        background: 'var(--wf-svg-surface)',
        objectFit: 'cover',
      }}
    />
  );
}
