// Procedural 6x6 maker's-mark sigil — deterministic from the slug.
// Replaces the circular AgentAvatar inside the /workforce/* console, which
// keeps the existing AgentAvatar component available for the article-site
// byline chip. See workforce/DESIGN.md for the design rationale.
//
// Cell colours: a 36-bit hash of the slug picks which cells of a 6x6 grid
// are "ink" (filled). The same slug always produces the same pattern, so
// the sigil functions as an identity mark without a hand-drawn asset.

interface Props {
  slug: string;
  /** Pixel size of the square (default 56). Cells scale to fit. */
  size?: number;
  /** Optional accent colour for ink cells. Defaults to wf-on-surface (#0b0b14). */
  ink?: string;
  /** Background colour. Defaults to a slug-derived pale tint. */
  bg?: string;
  /** Border colour. Defaults to wf-outline. */
  border?: string;
}

const GRID = 6;
const TOTAL = GRID * GRID;

function hash(slug: string): number {
  // 32-bit FNV-1a; deterministic and cheap.
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

function bitPattern(slug: string): boolean[] {
  // We need 36 bits but a 32-bit hash only gives us 32. Mix in a second
  // round with a salt so the right edge isn't always sparse.
  const h1 = hash(slug);
  const h2 = hash(slug + ':2');
  const cells: boolean[] = new Array(TOTAL);
  for (let i = 0; i < TOTAL; i++) {
    const source = i < 32 ? h1 : h2;
    const bit = i < 32 ? i : i - 32;
    // Mirror horizontally so the sigil has reflective symmetry — feels
    // intentional rather than random noise. Right half is derived from
    // the left half's bit.
    const col = i % GRID;
    if (col >= GRID / 2) {
      const mirrorCol = GRID - 1 - col;
      const mirrorIdx = Math.floor(i / GRID) * GRID + mirrorCol;
      cells[i] = cells[mirrorIdx];
    } else {
      cells[i] = ((source >>> bit) & 1) === 1;
    }
  }
  return cells;
}

function slugTint(slug: string): string {
  // Pale wash background derived from the slug — keeps each sigil tied
  // to the agent without screaming. Hue is the same one slugHue produces
  // for the legacy circle avatar, so cross-section identity holds.
  let h = 7;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 70% 94%)`;
}

export default function Sigil({ slug, size = 56, ink = '#0b0b14', bg, border = '#c8c4d4' }: Props) {
  const cells = bitPattern(slug);
  const fill = bg ?? slugTint(slug);
  const cell = size / GRID;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Sigil for ${slug}`}
      style={{ display: 'block', flexShrink: 0 }}
    >
      <rect x="0" y="0" width={size} height={size} fill={fill} stroke={border} strokeWidth="1" />
      {cells.map((on, i) => {
        if (!on) return null;
        const cx = (i % GRID) * cell;
        const cy = Math.floor(i / GRID) * cell;
        return <rect key={i} x={cx} y={cy} width={cell} height={cell} fill={ink} />;
      })}
    </svg>
  );
}
