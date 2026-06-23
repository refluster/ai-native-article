// Cumulative stacked-area chart (Epic-016). No chart-library dependency —
// hand-rolled SVG in the HeatStrip idiom. Series stack bottom→top in array
// order; the y-axis auto-scales to the largest per-day stack total. Fills
// come in as CSS-var references (e.g. 'var(--wf-svg-running)') so colour
// stays token-routed and lint:tokens stays green.
//
// The SVG uses a unit viewBox (x = point index, y = 0..100) with
// preserveAspectRatio="none" so it fills its container responsively; visual
// chrome (labels, legend) is plain DOM around it, not scaled SVG text.

export interface AreaSeries {
  /** Numeric key on each datum. */
  key: string;
  label: string;
  /** Fill value — a CSS var reference, e.g. 'var(--wf-svg-running)'. */
  fill: string;
}

interface Props {
  /** One object per day; carries `xKey` (a date string) + each series key. */
  data: Array<Record<string, number | string>>;
  xKey: string;
  /** Bottom→top stacking order. */
  series: AreaSeries[];
  /** Rendered SVG pixel height. Default 160. */
  height?: number;
  className?: string;
  ariaLabel?: string;
  /** Per-day tooltip line for the transparent hover columns. */
  tooltip?: (datum: Record<string, number | string>) => string;
}

const VH = 100;

export default function StackedAreaChart({
  data,
  xKey,
  series,
  height = 160,
  className = '',
  ariaLabel,
  tooltip,
}: Props) {
  if (data.length === 0) {
    return (
      <div className={`font-wfmono text-xs text-wf-on-surface-variant ${className}`}>
        no data in window
      </div>
    );
  }

  const n = data.length;
  // x maps point index → [0, VW]; guard n=1 so a single point still renders.
  const VW = Math.max(n - 1, 1);
  const num = (d: Record<string, number | string>, k: string): number => {
    const v = d[k];
    return typeof v === 'number' ? v : 0;
  };

  // y-scale: the largest per-day stack total across the window.
  const maxTotal = Math.max(
    1,
    ...data.map((d) => series.reduce((acc, s) => acc + num(d, s.key), 0)),
  );
  // x = point index (unit viewBox); y maps a stacked value → SVG y (0 at top).
  const y = (value: number) => VH - (value / maxTotal) * VH;

  // Stack: for each series compute its cumulative top edge per point.
  let lowerEdges = data.map(() => 0);
  const bands = series.map((s) => {
    const upperEdges = data.map((d, i) => lowerEdges[i] + num(d, s.key));
    // Polygon: along the top edge L→R, then back along the lower edge R→L.
    const top = upperEdges.map((v, i) => `${i},${y(v)}`);
    const bottom = lowerEdges.map((v, i) => `${i},${y(v)}`).reverse();
    const points = [...top, ...bottom].join(' ');
    lowerEdges = upperEdges;
    return { series: s, points };
  });

  return (
    <div className={className}>
      <div className="flex items-stretch">
        {/* Y-axis scale: max stack total (top) → 0 (bottom), so the absolute
            scale is readable without hovering (Epic-016 Phase 3). */}
        <div
          className="flex flex-col justify-between pr-1.5 text-right font-wfmono text-[10px] tabular-nums text-wf-on-surface-variant"
          style={{ height }}
          aria-hidden
        >
          <span>{maxTotal}</span>
          <span>0</span>
        </div>
        <div className="flex-1 min-w-0">
          <svg
            viewBox={`0 0 ${VW} ${VH}`}
            preserveAspectRatio="none"
            width="100%"
            height={height}
            role="img"
            aria-label={ariaLabel}
            style={{ display: 'block' }}
          >
            {/* Top gridline at the max, + baseline at 0. */}
            <line
              x1={0}
              y1={0}
              x2={VW}
              y2={0}
              stroke="var(--wf-svg-outline-variant)"
              strokeWidth={0.5}
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={0}
              y1={VH}
              x2={VW}
              y2={VH}
              stroke="var(--wf-svg-outline-variant)"
              strokeWidth={0.5}
              vectorEffect="non-scaling-stroke"
            />
            {bands.map((b) => (
              <polygon key={b.series.key} points={b.points} fill={b.series.fill} fillOpacity={0.85} />
            ))}
            {/* Transparent per-day hover columns carrying the breakdown title. */}
            {tooltip &&
              data.map((d, i) => (
                <rect
                  key={i}
                  x={Math.max(0, i - VW / n / 2)}
                  y={0}
                  width={VW / n}
                  height={VH}
                  fill="transparent"
                >
                  <title>{tooltip(d)}</title>
                </rect>
              ))}
          </svg>
          {/* x-axis: first → last value of xKey (the date range the area spans). */}
          <div className="mt-1 flex justify-between font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
            <span>{String(data[0][xKey])}</span>
            {data.length > 1 && <span>{String(data[data.length - 1][xKey])}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
