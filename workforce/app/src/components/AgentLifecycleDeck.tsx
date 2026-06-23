// DECK · AGENT LIFECYCLE (Epic-016 Metric 2). A cumulative stacked-area
// funnel of the active cohort partitioned by furthest reached state —
// registered → assigned → delivered — over the window, with the
// delivered-share headline the whole deck exists to surface.
//
// Renders at two scopes (workforce-wide on /performance; per-project on
// /projects/{id}/performance) from the same PerformanceSeries shape.

import Typeplate from './Typeplate';
import StackedAreaChart, { type AreaSeries } from './StackedAreaChart';
import type { PerformanceSeries } from '../types/performance';

// Bottom→top: registered (base, muted) → assigned (in-flight, blue) →
// delivered (the outcome, green). The green band growing to dominate is the
// thesis the deck visualises.
const SERIES: AreaSeries[] = [
  { key: 'registered', label: 'registered', fill: 'var(--wf-svg-archived)' },
  { key: 'assigned', label: 'assigned', fill: 'var(--wf-svg-primary)' },
  { key: 'delivered', label: 'delivered', fill: 'var(--wf-svg-running)' },
];

export default function AgentLifecycleDeck({ series }: { series: PerformanceSeries }) {
  const points = series.lifecycle;
  const last = points[points.length - 1];
  const first = points[0];
  // Q2 (operator, 2026-06-22): the headline is the ABSOLUTE delivered count —
  // the number of personas that have shipped an artefact — not a share/rate.
  const deliveredNow = last ? last.delivered : 0;
  const deliveredThen = first ? first.delivered : 0;
  const delta = deliveredNow - deliveredThen;
  const cohortNow = last ? last.registered + last.assigned + last.delivered : 0;

  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3 flex items-center justify-between">
        <Typeplate label="DECK 03 · AGENT LIFECYCLE" value="REGISTERED → ASSIGNED → DELIVERED" />
        <span className="hidden sm:inline font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          {series.window.start} → {series.window.end}
        </span>
      </div>

      <div className="p-4">
        {/* Delivered-count headline — the read the deck exists for (Q2). */}
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2 mb-4">
          <div>
            <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
              delivered
            </div>
            <div className="font-headline text-3xl font-black tracking-tighter text-wf-on-surface leading-none">
              {deliveredNow}
            </div>
          </div>
          <div
            className={`font-wfmono text-xs ${delta >= 0 ? 'text-wf-running' : 'text-wf-throwing'}`}
            title="change in delivered count across the window"
          >
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}
          </div>
          <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
            cohort {cohortNow}
          </div>
        </div>

        <StackedAreaChart
          data={points as unknown as Array<Record<string, number | string>>}
          xKey="date"
          series={SERIES}
          height={170}
          ariaLabel="Agent lifecycle funnel: registered, assigned, delivered, stacked by day"
          tooltip={(d) =>
            `${d.date} — registered ${d.registered} · assigned ${d.assigned} · delivered ${d.delivered}`
          }
        />

        {/* Legend + latest band values. */}
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-3"
                style={{ backgroundColor: s.fill }}
                aria-hidden
              />
              {s.label}
              <span className="text-wf-on-surface">{last ? (last[s.key as keyof typeof last] as number) : 0}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
