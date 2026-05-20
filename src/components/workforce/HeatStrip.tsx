// 30-day activity heat strip. Each column is one day; cell intensity is
// the run count for that day (0–5). When a single slug is passed, the
// strip is per-agent; with no slug the cells sum across the workforce.

import type { MockActivity } from '../../types/workforce-stats';

interface Props {
  activity: MockActivity;
  /** Restrict to one agent's row. Omit for workforce-wide totals. */
  slug?: string;
  className?: string;
  /** Pixel height of each cell. Default 18. */
  cellSize?: number;
}

// Exposed so the Dashboard legend can render swatches that match exactly.
// Classes are listed as full literals (no string interpolation) so Tailwind's
// content scanner can pick them up.
export function intensityClass(v: number): string {
  if (v <= 0) return 'bg-wf-surface-container border border-wf-outline-variant';
  if (v === 1) return 'bg-wf-primary/20';
  if (v === 2) return 'bg-wf-primary/40';
  if (v === 3) return 'bg-wf-primary/60';
  if (v === 4) return 'bg-wf-primary/80';
  return 'bg-wf-primary';
}

export default function HeatStrip({ activity, slug, className = '', cellSize = 18 }: Props) {
  const days = activity.days;
  const series: number[] = (() => {
    if (slug) return activity.by_slug[slug] ?? new Array(days.length).fill(0);
    // Workforce-wide totals: sum every slug's contribution per day.
    return days.map((_, i) =>
      Object.values(activity.by_slug).reduce((acc, row) => acc + (row[i] ?? 0), 0),
    );
  })();

  return (
    <div className={`overflow-x-auto ${className}`}>
      <div className="flex gap-[2px]" style={{ minWidth: days.length * (cellSize + 2) }}>
        {series.map((v, i) => (
          <div
            key={i}
            className={`shrink-0 ${intensityClass(v)}`}
            style={{ width: cellSize, height: cellSize }}
            title={`${days[i]} — ${v} run${v === 1 ? '' : 's'}`}
            aria-label={`${days[i]}: ${v} runs`}
          />
        ))}
      </div>
    </div>
  );
}
