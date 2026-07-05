import { useEffect, useState } from 'react'
import type { Mermaid } from 'mermaid'

/**
 * Renders a ```mermaid fenced block from an article body as an inline figure.
 *
 * mermaid is ~1.5MB minified, so it is loaded on demand: articles without a
 * figure never pay for it (Vite code-splits the dynamic import into its own
 * chunk). The theme maps the Precision Editorial tokens (DESIGN.md /
 * tailwind.config.ts) onto mermaid's `base` theme — mermaid writes colors as
 * SVG attributes, so token values are repeated here rather than read from
 * Tailwind classes. Authoring rules live in newsletter/docs/ARTICLE-FIGURES.md.
 */

// Categorical palette, fixed order (never cycled): ink first, tertiary red as
// the second "surgical" accent, then grays by descending lightness. CVD
// separation validated at ΔE ≥ 17 for adjacent pairs; the two lightest slots
// are legal because pie always renders a legend and slice labels.
const CATEGORICAL = ['#2d3338', '#c1000a', '#757c81', '#acb3b8', '#dde3e9']

const INK = '#2d3338' // on-surface
const INK_VARIANT = '#596065' // on-surface-variant
const GRID = '#acb3b8' // outline-variant
const FIGURE_SURFACE = '#f2f4f6' // surface-container-low — the figure block

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
          background: FIGURE_SURFACE,
          fontFamily: 'Inter, sans-serif',
          fontSize: '14px',
          textColor: INK,
          lineColor: '#5e5e5e',
          // Node fills: stacked paper stocks, boundaries by tone, not lines.
          primaryColor: '#dde3e9',
          primaryTextColor: INK,
          primaryBorderColor: '#757c81',
          secondaryColor: '#f9f9fb',
          secondaryTextColor: INK,
          secondaryBorderColor: GRID,
          tertiaryColor: '#ffffff',
          tertiaryTextColor: INK,
          tertiaryBorderColor: GRID,
          noteBkgColor: '#dde3e9',
          noteTextColor: INK,
          noteBorderColor: GRID,
          // Pie: fixed categorical order; a 2px surface-colored stroke keeps
          // adjacent slices separated (the "gap between fills" mark rule).
          pie1: CATEGORICAL[0],
          pie2: CATEGORICAL[1],
          pie3: CATEGORICAL[2],
          pie4: CATEGORICAL[3],
          pie5: CATEGORICAL[4],
          pieStrokeColor: FIGURE_SURFACE,
          pieStrokeWidth: '2px',
          pieOuterStrokeWidth: '0px',
          pieTitleTextColor: INK,
          pieTitleTextSize: '16px',
          pieSectionTextColor: '#f8f8f8',
          pieSectionTextSize: '13px',
          pieLegendTextColor: INK,
          pieLegendTextSize: '13px',
          // XY chart (line / bar): recessive axes, ink-first series.
          xyChart: {
            backgroundColor: FIGURE_SURFACE,
            titleColor: INK,
            xAxisLabelColor: INK_VARIANT,
            xAxisTitleColor: INK_VARIANT,
            xAxisTickColor: GRID,
            xAxisLineColor: GRID,
            yAxisLabelColor: INK_VARIANT,
            yAxisTitleColor: INK_VARIANT,
            yAxisTickColor: GRID,
            yAxisLineColor: GRID,
            plotColorPalette: CATEGORICAL.join(','),
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
      <figure className="my-8 bg-surface-container-low p-6 min-h-[10rem] flex items-center justify-center">
        <span className="text-[10px] font-bold tracking-widest text-outline uppercase animate-pulse">
          RENDERING FIGURE...
        </span>
      </figure>
    )
  }

  return (
    <figure
      className="mermaid-figure my-8 bg-surface-container-low px-4 py-6 md:px-8 overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
