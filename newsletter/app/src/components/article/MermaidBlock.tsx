import { useEffect, useState } from 'react'
import type { Mermaid } from 'mermaid'
import { FIGURE_CATEGORICAL, FIGURE_TOKENS as T } from '../../config/site'

/**
 * Renders a ```mermaid fenced block from an article body as an inline figure.
 *
 * mermaid is ~1.5MB minified, so it is loaded on demand: articles without a
 * figure never pay for it (Vite code-splits the dynamic import into its own
 * chunk). The theme maps the Precision Editorial tokens (DESIGN.md, via
 * FIGURE_TOKENS in config/site.ts) onto mermaid's `base` theme — mermaid
 * writes colors as SVG attributes, out of Tailwind's reach. Authoring rules
 * live in newsletter/docs/ARTICLE-FIGURES.md.
 */

let mermaidPromise: Promise<Mermaid> | null = null

function loadMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    // Force Inter to load before the first render: mermaid measures label
    // widths at render time, and metrics taken with the fallback font clip
    // once Inter swaps in. `fonts.ready` is not enough — Inter is fetched
    // lazily on first use, so it must be requested explicitly.
    const fontsReady =
      typeof document.fonts?.load === 'function'
        ? Promise.allSettled([
            document.fonts.load('14px Inter'),
            document.fonts.load('700 14px Inter'),
          ])
        : Promise.resolve()
    mermaidPromise = Promise.all([import('mermaid'), fontsReady]).then(([{ default: mermaid }]) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        // A parse error must surface as our own visible failure block, not
        // mermaid's injected "bomb" SVG.
        suppressErrorRendering: true,
        fontFamily: 'Inter, sans-serif',
        theme: 'base',
        themeVariables: {
          background: T.surface,
          fontFamily: 'Inter, sans-serif',
          fontSize: '14px',
          textColor: T.ink,
          lineColor: T.line,
          // Node fills: stacked paper stocks, boundaries by tone, not lines.
          primaryColor: T.raised,
          primaryTextColor: T.ink,
          primaryBorderColor: T.gridStrong,
          secondaryColor: T.surface,
          secondaryTextColor: T.ink,
          secondaryBorderColor: T.grid,
          tertiaryColor: T.lowest,
          tertiaryTextColor: T.ink,
          tertiaryBorderColor: T.grid,
          noteBkgColor: T.raised,
          noteTextColor: T.ink,
          noteBorderColor: T.grid,
          // Pie: fixed categorical order; a 2px surface-colored stroke keeps
          // adjacent slices separated (the "gap between fills" mark rule).
          pie1: FIGURE_CATEGORICAL[0],
          pie2: FIGURE_CATEGORICAL[1],
          pie3: FIGURE_CATEGORICAL[2],
          pie4: FIGURE_CATEGORICAL[3],
          pie5: FIGURE_CATEGORICAL[4],
          pieStrokeColor: T.surface,
          pieStrokeWidth: '2px',
          pieOuterStrokeWidth: '0px',
          pieTitleTextColor: T.ink,
          pieTitleTextSize: '16px',
          pieSectionTextColor: T.onDark,
          pieSectionTextSize: '13px',
          pieLegendTextColor: T.ink,
          pieLegendTextSize: '13px',
          // XY chart (line / bar): recessive axes, ink-first series.
          xyChart: {
            backgroundColor: 'transparent',
            titleColor: T.ink,
            xAxisLabelColor: T.inkVariant,
            xAxisTitleColor: T.inkVariant,
            xAxisTickColor: T.grid,
            xAxisLineColor: T.grid,
            yAxisLabelColor: T.inkVariant,
            yAxisTitleColor: T.inkVariant,
            yAxisTickColor: T.grid,
            yAxisLineColor: T.grid,
            plotColorPalette: FIGURE_CATEGORICAL.join(','),
          },
        },
      })
      return mermaid
    })
  }
  return mermaidPromise
}

let figureSeq = 0

export default function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setSvg(null)
    setFailed(false)
    loadMermaid()
      .then(mermaid => mermaid.render(`article-figure-${++figureSeq}`, code))
      .then(({ svg: rendered }) => {
        if (!cancelled) setSvg(rendered)
      })
      .catch((err: unknown) => {
        // C-4: fail loud. A broken figure renders as an explicit failure
        // block (with its source, so the operator can fix the Notion block),
        // never as silent whitespace.
        console.error('[MermaidBlock] render failed:', err)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [code])

  if (failed) {
    return (
      <figure className="my-8 bg-surface-container-low p-6">
        <span className="block mb-3 text-[10px] font-bold tracking-widest uppercase text-error">
          FIGURE FAILED TO RENDER
        </span>
        <pre className="!bg-transparent !p-0 !my-0 whitespace-pre-wrap">
          <code className="!bg-transparent !text-on-surface-variant text-xs">{code}</code>
        </pre>
      </figure>
    )
  }

  if (svg === null) {
    return (
      <figure className="my-10 min-h-[10rem] flex items-center justify-center">
        <span className="text-[10px] font-bold tracking-widest text-outline uppercase animate-pulse">
          RENDERING FIGURE...
        </span>
      </figure>
    )
  }

  // The figure sits directly on the article surface (no tonal block), so the
  // chart reads as part of the text column; vertical margin alone carries the
  // separation (whitespace as a content element, DESIGN.md §1).
  return (
    <figure
      className="mermaid-figure my-10 overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
