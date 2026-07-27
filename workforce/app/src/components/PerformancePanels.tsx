// Loads one scope's PerformanceSeries and renders the two Epic-016 panels
// (agent lifecycle + PR automation). Shared by the workforce Dashboard
// (/performance) and the per-project Performance tab so the two scopes stay
// visually + behaviourally identical. Handles loading / error / empty-scope
// states and the "* mocked" advisory the rest of the console uses.
//
// pr-autopilot cycle-1 finding (`wf:tomas`, 2026-07-24): reaxis() relabels a
// live series' dates to a window ending today without touching
// `generated_at` — cosmetically resolving "the axis never updates" while
// deleting the one visible tell that the Epic-016 backend refresh (daily,
// 02:00 UTC) has actually stalled. So this panel now always renders
// `generated_at`, and flags it when it's suspiciously old for a live source.

import { useEffect, useState } from 'react';
import AgentLifecyclePanel from './AgentLifecyclePanel';
import PrAutomationPanel from './PrAutomationPanel';
import { loadPerformance, type PerformanceScope } from '../lib/performance';
import type { PerformanceSeries } from '../types/performance';

// The reducer refreshes daily at 02:00 UTC (Epic-016 Phase 2); a live
// snapshot older than one refresh cycle plus a generous buffer means the
// backend missed at least one run.
const LIVE_STALE_HOURS = 26;

function hoursSince(iso: string, now: Date): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (now.getTime() - t) / 3_600_000 : Infinity;
}

export default function PerformancePanels({ scope }: { scope: PerformanceScope }) {
  const [series, setSeries] = useState<PerformanceSeries | undefined>(undefined);
  const [source, setSource] = useState<'live' | 'mock'>('mock');
  const [error, setError] = useState<string | null>(null);

  // Re-fetch whenever the scope identity changes. For a project scope that is
  // its id; for workforce it is the constant 'workforce'.
  const scopeKey = scope.kind === 'workforce' ? 'workforce' : `project:${scope.id}`;

  useEffect(() => {
    let cancelled = false;
    setSeries(undefined);
    setError(null);
    loadPerformance(scope)
      .then((r) => {
        if (cancelled) return;
        setSeries(r.series);
        setSource(r.source);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // scope is recreated each render; key on the stable identity instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  if (error) {
    return (
      <p className="font-wfmono text-xs text-wf-throwing">
        Failed to load performance: {error}
      </p>
    );
  }
  if (series === undefined) {
    return (
      <p className="font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface-variant">
        Loading performance…
      </p>
    );
  }

  const staleHours = hoursSince(series.generated_at, new Date());
  const isLiveStale = source === 'live' && staleHours > LIVE_STALE_HOURS;

  return (
    <div className="space-y-6 sm:space-y-8">
      <AgentLifecyclePanel series={series} />
      <PrAutomationPanel series={series} />
      {source === 'mock' && (
        <p className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          * illustrative — the live performance roll-up endpoint is not deployed yet (Epic-016 Phase 2)
        </p>
      )}
      {source === 'live' && isLiveStale && (
        <p className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-tertiary">
          * live data last refreshed {new Date(series.generated_at).toISOString().slice(0, 16)}Z — over{' '}
          {LIVE_STALE_HOURS}h old; the Epic-016 backend refresh may be behind (OP-011/OP-012). The date axis
          above is re-mapped to end today, but the underlying values may not be current.
        </p>
      )}
      {source === 'live' && !isLiveStale && (
        <p className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          live data as of {new Date(series.generated_at).toISOString().slice(0, 16)}Z
        </p>
      )}
    </div>
  );
}
