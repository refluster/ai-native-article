// PANEL · REPOSITORY PERFORMANCE (2026-07-24 operator request, requirement
// 5). Issues opened/closed, PR opened/closed, and code-line churn, summed
// across every workforce project's GitHub repo. Real GitHub data — built
// offline by workforce/scripts/build-repo-performance.mjs into
// public/workforce-mock-repo-activity.json (lib/repoActivity.ts loads it).
// Split into three charts (issues / PRs / churn) rather than one dense
// panel, since the metrics don't share a natural single axis.
//
// Distinct from PrAutomationPanel: that deck reads the autopilot-vs-human
// MERGE split for this repo from the live/mock PerformanceSeries; this one
// reads raw opened/closed counts (any close, not just merges) across ALL
// tracked repos.

import { useEffect, useState, type ReactNode } from 'react';
import Typeplate from './Typeplate';
import StackedBarChart, { type BarSeries } from './StackedBarChart';
import { loadRepoActivity, type RepoActivityResult } from '../lib/repoActivity';

const ISSUE_SERIES: BarSeries[] = [
  { key: 'opened', label: 'opened', fill: 'var(--wf-svg-primary)' },
  { key: 'closed', label: 'closed', fill: 'var(--wf-svg-running)' },
];
const PR_SERIES: BarSeries[] = [
  { key: 'opened', label: 'opened', fill: 'var(--wf-svg-primary)' },
  { key: 'closed', label: 'closed', fill: 'var(--wf-svg-running)' },
];
const CHURN_SERIES: BarSeries[] = [
  { key: 'additions', label: 'additions', fill: 'var(--wf-svg-running)' },
  { key: 'deletions', label: 'deletions', fill: 'var(--wf-svg-tertiary)' },
];

// The refresh Cadence fires daily; a live block older than one cycle plus a
// buffer means the refresh missed a run and the numbers below are not today's.
const STALE_HOURS = 30;

export default function RepoPerformancePanel() {
  const [result, setResult] = useState<RepoActivityResult | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadRepoActivity()
      .then((d) => {
        if (!cancelled) setResult(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <p className="font-wfmono text-xs text-wf-throwing">
        Failed to load repository performance: {error}
      </p>
    );
  }
  if (!result) {
    return (
      <p className="font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface-variant">
        Loading repository performance…
      </p>
    );
  }

  const w = result.workforce;
  const projectIds = result.repos;
  const stampedAt = new Date(result.generatedAt).toISOString().slice(0, 16);
  const ageHours = (Date.now() - Date.parse(result.generatedAt)) / 3_600_000;
  const isStale = result.source === 'live' && ageHours > STALE_HOURS;
  const degraded = w.degraded_signals ?? [];

  return (
    <div className="space-y-6 sm:space-y-8">
      <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
        <div className="border-b border-wf-outline-variant px-4 py-3 flex items-center justify-between">
          <Typeplate label="REPOSITORY PERFORMANCE" value={`${projectIds.length} PROJECTS COMBINED`} />
          <span className="hidden sm:inline font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
            {w.window.start} → {w.window.end}
          </span>
        </div>
        <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat cap="ISSUES" value={`+${w.summary.issues_opened} / −${w.summary.issues_closed}`} sub="opened / closed" />
          <Stat cap="PULL REQUESTS" value={`+${w.summary.prs_opened} / −${w.summary.prs_closed}`} sub="opened / closed" />
          <Stat
            cap="CODE CHURN"
            value={`+${w.summary.total_additions.toLocaleString()}`}
            sub={`−${w.summary.total_deletions.toLocaleString()} lines`}
          />
          <Stat cap="TRACKED REPOS" value={String(projectIds.length)} sub={projectIds.join(', ')} />
        </div>

        {/* Provenance + freshness, always rendered: the numbers above must
            never be readable without knowing how current they are. */}
        {result.source === 'live' ? (
          <p
            className={`px-4 pb-3 font-wfmono text-[10px] uppercase tracking-[0.14em] ${
              isStale ? 'text-wf-tertiary' : 'text-wf-on-surface-variant'
            }`}
          >
            * real GitHub data · refreshed daily · last run {stampedAt}Z
            {isStale && ' — over a day old; the performance-refresh cadence may have missed a run'}
          </p>
        ) : (
          <p className="px-4 pb-3 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-tertiary">
            * bundled snapshot @ {stampedAt}Z — the live daily refresh is unavailable, so these numbers
            are frozen at the last committed build
          </p>
        )}

        {degraded.length > 0 && (
          <p className="px-4 pb-3 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-tertiary">
            * degraded this run: {degraded.join(', ')} — those counts are undercounts, not real lows
          </p>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <ChartCard title="ISSUES" sub="opened vs closed · daily">
          <StackedBarChart
            data={w.issues_daily as unknown as Array<Record<string, number | string>>}
            xKey="date"
            series={ISSUE_SERIES}
            height={140}
            ariaLabel="Issues opened vs closed, stacked by day, summed across projects"
            tooltip={(d) => `${d.date} — opened ${d.opened} · closed ${d.closed}`}
          />
        </ChartCard>
        <ChartCard title="PULL REQUESTS" sub="opened vs closed · daily">
          <StackedBarChart
            data={w.prs_daily as unknown as Array<Record<string, number | string>>}
            xKey="date"
            series={PR_SERIES}
            height={140}
            ariaLabel="Pull requests opened vs closed, stacked by day, summed across projects"
            tooltip={(d) => `${d.date} — opened ${d.opened} · closed ${d.closed}`}
          />
        </ChartCard>
        <ChartCard title="CODE CHURN" sub="additions vs deletions · weekly">
          <StackedBarChart
            data={w.code_churn_weekly as unknown as Array<Record<string, number | string>>}
            xKey="week_start"
            series={CHURN_SERIES}
            height={140}
            ariaLabel="Code line additions vs deletions, stacked by week, summed across projects"
            tooltip={(d) => `week of ${d.week_start} — +${d.additions} / −${d.deletions}`}
          />
        </ChartCard>
      </div>
    </div>
  );
}

function ChartCard({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3">
        <Typeplate label={title} value={sub.toUpperCase()} />
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Stat({ cap, value, sub }: { cap: string; value: string; sub: string }) {
  return (
    <div>
      <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">{cap}</div>
      <div className="font-headline text-2xl font-black tracking-tighter leading-none text-wf-on-surface">
        {value}
      </div>
      <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant mt-0.5 truncate">
        {sub}
      </div>
    </div>
  );
}
