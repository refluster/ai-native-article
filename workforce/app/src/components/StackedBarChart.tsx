// Stacked daily/weekly bar chart — extracted from PrAutomationPanel's inline
// bar-chart block (2026-07-24) so the new Repository Performance panels can
// reuse it instead of duplicating the div-based bar layout three times. No
// chart-library dependency, same idiom as StackedAreaChart / HeatStrip. Fills
// come in as CSS-var references so colour stays token-routed.

export interface BarSeries {
  /** Numeric key on each datum. */
  key: string;
  label: string;
  /** Fill value — a CSS var reference, e.g. 'var(--wf-svg-running)'. */
  fill: string;
}

interface Props {
  /** One object per bar; carries `xKey` + each series key. */
  data: Array<Record<string, number | string>>;
  xKey: string;
  /** Bottom→top stacking order (same convention as StackedAreaChart's AreaSeries). */
  series: BarSeries[];
  /** Rendered pixel height. Default 120. */
  height?: number;
  className?: string;
  ariaLabel?: string;
  /** Per-bar hover title. */
  tooltip?: (datum: Record<string, number | string>) => string;
}

export default function StackedBarChart({ data, xKey, series, height = 120, className = '', ariaLabel, tooltip }: Props) {
  if (data.length === 0) {
    return (
      <div className={`font-wfmono text-xs text-wf-on-surface-variant ${className}`}>
        no data in window
      </div>
    );
  }

  const num = (d: Record<string, number | string>, k: string): number => {
    const v = d[k];
    return typeof v === 'number' ? v : 0;
  };
  const total = (d: Record<string, number | string>) => series.reduce((acc, s) => acc + num(d, s.key), 0);
  const maxTotal = Math.max(1, ...data.map(total));
  // Render series bottom-first: reversing the (documented bottom→top) array
  // so the first-listed series ends up last in DOM — flex-col + justify-end
  // packs children toward the bottom in DOM order, so the last DOM child
  // sits lowest.
  const bottomFirst = [...series].reverse();

  return (
    <div className={className} role="img" aria-label={ariaLabel}>
      <div className="flex items-stretch">
        <div
          className="flex flex-col justify-between pr-1.5 text-right font-wfmono text-[10px] tabular-nums text-wf-on-surface-variant"
          style={{ height }}
          aria-hidden
        >
          <span>{maxTotal}</span>
          <span>0</span>
        </div>
        <div className="overflow-x-auto flex-1 min-w-0">
          <div className="flex items-end gap-[3px]" style={{ height, minWidth: data.length * 10 }}>
            {data.map((d, i) => {
              const t = total(d);
              const h = (t / maxTotal) * 100;
              return (
                <div
                  key={i}
                  className="flex-1 min-w-[6px] flex flex-col justify-end"
                  style={{ height: '100%' }}
                  title={tooltip ? tooltip(d) : undefined}
                >
                  <div style={{ height: `${h}%` }} className="flex flex-col justify-end">
                    {bottomFirst.map((s) => {
                      const v = num(d, s.key);
                      if (v <= 0 || t <= 0) return null;
                      return <div key={s.key} style={{ height: `${(v / t) * 100}%`, backgroundColor: s.fill }} />;
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-1 flex justify-between font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
        <span>{String(data[0][xKey])}</span>
        {data.length > 1 && <span>{String(data[data.length - 1][xKey])}</span>}
      </div>
    </div>
  );
}
