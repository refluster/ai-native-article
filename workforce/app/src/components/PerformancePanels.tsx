// Loads one scope's PerformanceSeries and renders the two Epic-016 panels
// (agent lifecycle + PR automation). Shared by the workforce Dashboard
// (/performance) and the per-project Performance tab so the two scopes stay
// visually + behaviourally identical. Handles loading / error / empty-scope
// states and the "* mocked" advisory the rest of the console uses.
//
// Staleness is measured PER BLOCK, against the writer that owns it — not
// against the response's `generated_at`.
//
// The 2026-07-24 version of this panel checked `generated_at`, which the
// endpoint sets to its own clock on every request. That check could therefore
// never fire: it reported "live data as of <now>" every morning while the PR
// roll-up underneath sat frozen at its 2026-07-26 publish for 45 days
// (operator report, 2026-09-09). The two blocks on this panel have two
// different daily writers and so need two different reads:
//
//   lifecycle — wf-performance-reducer Lambda, EventBridge 02:00 UTC. Its
//               freshness tell is the last point's DATE (the reducer appends
//               one point per day unconditionally, so a gap is a missed run).
//   PR        — workforce-performance-refresh.yml, 05:33 UTC. Its tell is
//               `pr_updated_at`; the last pr_daily date is NOT usable, because
//               a genuinely quiet day merges no PRs and emits no point.

import { useEffect, useState } from 'react';
import AgentLifecyclePanel from './AgentLifecyclePanel';
import PrAutomationPanel from './PrAutomationPanel';
import { loadPerformance, type PerformanceScope } from '../lib/performance';
import type { PerformanceSeries } from '../types/performance';

// One daily cycle plus a generous buffer for a late or slow run. The two
// writers fire at 02:00 and 05:33 UTC, so a block older than this has missed
// at least one whole run.
const LIVE_STALE_HOURS = 30;

function hoursSince(iso: string | undefined, now: Date): number {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? (now.getTime() - t) / 3_600_000 : Infinity;
}

/** Age of the lifecycle funnel, from its last daily point. The reducer appends
 *  a point every day, so a last date behind today means it missed a run. */
function lifecycleStaleHours(series: PerformanceSeries, now: Date): number {
  const last = series.lifecycle[series.lifecycle.length - 1]?.date;
  // End-of-day: a point dated today is at most ~24h old, never "stale".
  return last ? hoursSince(`${last}T23:59:59Z`, now) : Infinity;
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

  const now = new Date();
  // An absent block reads as Infinity, i.e. stale — "we have never published
  // this" is an unknown, and an unknown is never rounded to fresh (the
  // PerfIdleRow consumer contract, applied here).
  const lcStale = source === 'live' && lifecycleStaleHours(series, now) > LIVE_STALE_HOURS;
  const prStale = source === 'live' && hoursSince(series.pr_updated_at, now) > LIVE_STALE_HOURS;
  const isLiveStale = lcStale || prStale;
  const staleBlocks = [lcStale ? 'agent lifecycle' : null, prStale ? 'PR automation' : null].filter(
    Boolean,
  ) as string[];
  const prStamp = series.pr_updated_at
    ? `${new Date(series.pr_updated_at).toISOString().slice(0, 16)}Z`
    : 'never published';

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
          * stale — {staleBlocks.join(' and ')} {staleBlocks.length > 1 ? 'have' : 'has'} not been
          refreshed in over {LIVE_STALE_HOURS}h. Lifecycle through{' '}
          {series.lifecycle[series.lifecycle.length - 1]?.date ?? 'never'} (wf-performance-reducer,
          02:00 UTC) · PR roll-up {prStamp} (workforce-performance-refresh.yml, 05:33 UTC). The
          charts plot the dates the backend actually published — they are not re-mapped to today —
          so a flat tail is missing data, not zero activity.
        </p>
      )}
      {source === 'live' && !isLiveStale && (
        <p className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          live · lifecycle through {series.lifecycle[series.lifecycle.length - 1]?.date} · PR roll-up{' '}
          {prStamp}
        </p>
      )}
    </div>
  );
}
