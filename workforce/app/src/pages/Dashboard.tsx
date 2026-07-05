// /workforce — the console landing page. Hero KPI readout, 30-day heat
// strip, live trace ribbon, and a per-agent row table. Responsive: stacks
// vertically on mobile, switches to a two-column layout from md+.
//
// Data sources:
//   - workforce-agents.json  → roster + metadata (authoritative for the
//     hero copy, persona count, cron-binding count, and the per-agent
//     budget envelope; recomputed at render time so a new persona shows
//     up immediately).
//   - agents-api GET /stats  → real EXEC-ledger roll-up: per-agent runs /
//     deliverables MTD, the 30-day heat strip, the live-trace ribbon, and
//     run-duration figures. Falls back to the static
//     workforce-mock-stats.json only when the API base is unconfigured
//     (local dev / bare gh-pages). The Dashboard re-aggregates totals from
//     the per-agent rows (rather than reading the response's `totals`
//     block) so a persona the ledger hasn't logged yet still registers as
//     paused-zero in the headline KPIs.
//   - The 4th KPI is run DURATION, not spend: per-run token/cost usage is
//     not observable from the CCR execution path, so the dashboard reports
//     the real compute proxy it CAN derive instead of a fabricated dollar
//     figure.
//   - The 30-day heat-strip date axis is the 30 days ending today (the
//     /stats endpoint emits this window directly; the mock fallback is
//     re-axised at render time so it never shows a stale date window).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import WorkforceLayout from '../components/WorkforceLayout';
import Typeplate from '../components/Typeplate';
import Sigil from '../components/Sigil';
import StatusPill, { deriveStatus } from '../components/StatusPill';
import KPIReadout from '../components/KPIReadout';
import HeatStrip, { intensityClass } from '../components/HeatStrip';
import LiveTrace from '../components/LiveTrace';
import PerformancePanels from '../components/PerformancePanels';
import { WORKFORCE_SCOPE } from '../lib/performance';
import { loadWorkforceManifest, loadWorkforceStats, fullName } from '../lib/agents';
import { fmtDuration, fmtCompute } from '../lib/duration';
import { SITE_DISPLAY_NAME } from '../config/site';
import type { WorkforceAgentManifest } from '../types/agent';
import type { AgentMockStats, WorkforceMockStats } from '../types/stats';

// Zero-stats stand-in for personas the mock JSON hasn't been backfilled
// for. Matches the synthesised placeholder used in the Crew table below so
// totals and rows stay consistent.
const PAUSED_PLACEHOLDER: AgentMockStats = {
  paused: true,
  archived: false,
  last_run_at: '',
  last_run_status: 'ok',
  runs_this_month: 0,
  deliv_this_month: 0,
  avg_duration_s: 0,
  compute_seconds_this_month: 0,
};

function lastNDaysUTC(n: number): string[] {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

export default function Dashboard() {
  const [manifest, setManifest] = useState<WorkforceAgentManifest | null>(null);
  const [stats, setStats] = useState<WorkforceMockStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = `${SITE_DISPLAY_NAME} — Performance`;
    Promise.all([loadWorkforceManifest(), loadWorkforceStats()])
      .then(([m, s]) => {
        setManifest(m);
        setStats(s);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  if (error) {
    return (
      <WorkforceLayout>
        <div className="font-wfmono text-sm text-wf-tertiary">Failed to load dashboard: {error}</div>
      </WorkforceLayout>
    );
  }
  if (!manifest || !stats) {
    return (
      <WorkforceLayout>
        <div className="font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface-variant">Loading…</div>
      </WorkforceLayout>
    );
  }

  // Per-agent rollup that synthesises paused-zero rows for personas the
  // ledger hasn't logged yet. Totals are re-aggregated from this so new
  // agents flip CREW LIVE / RUNS · MTD / AVG DUR immediately.
  const rollup = manifest.agents.map((a) => {
    const s = stats.agents[a.slug] ?? PAUSED_PLACEHOLDER;
    const status = deriveStatus({ paused: s.paused, archived: s.archived, last_run_status: s.last_run_status });
    return { agent: a, stats: s, status };
  });

  const personaCount = manifest.agents.length;
  const cronCount = manifest.agents.reduce(
    (acc, a) =>
      acc + a.bindings.filter((b) => b.trigger.scheduler === 'eventbridge' && b.trigger.cron).length,
    0,
  );
  const currentMonth = new Date().toISOString().slice(0, 7);

  const computedTotals = {
    agents_running: rollup.filter((r) => r.status === 'running').length,
    agents_paused: rollup.filter((r) => r.status === 'paused').length,
    agents_throwing: rollup.filter((r) => r.status === 'throwing').length,
    runs_this_month: rollup.reduce((acc, r) => acc + r.stats.runs_this_month, 0),
    compute_seconds_this_month: rollup.reduce((acc, r) => acc + (r.stats.compute_seconds_this_month ?? 0), 0),
    deliv_this_month: rollup.reduce((acc, r) => acc + (r.stats.deliv_this_month ?? 0), 0),
  };
  const t = computedTotals;
  // Prefer the per-agent rollup (so an agent the ledger hasn't logged still
  // counts) when agents carry the MTD deliv field; the static-mock fallback
  // has no per-agent breakdown, so fall back to the totals block there.
  const delivMTD = rollup.some((r) => r.stats.deliv_this_month !== undefined)
    ? t.deliv_this_month
    : stats.totals.deliv_count_this_month;
  // AVG DUR is the spend-proxy KPI: real run duration, not a fabricated
  // token/dollar figure (per-run usage isn't observable from the CCR path).
  const avgDurMTD = t.runs_this_month > 0 ? t.compute_seconds_this_month / t.runs_this_month : 0;

  const kpis = [
    { cap: 'CREW LIVE',    value: String(t.agents_running),    sub: `${t.agents_paused} paused · ${t.agents_throwing} throwing` },
    { cap: 'RUNS · MTD',   value: String(t.runs_this_month),   sub: `${currentMonth} · ${personaCount} agents` },
    { cap: 'AVG DUR · MTD',value: fmtDuration(avgDurMTD),      sub: `${fmtCompute(t.compute_seconds_this_month)} compute · ${t.runs_this_month} runs` },
    { cap: 'DELIV · MTD',  value: String(delivMTD),            sub: 'across all streams' },
  ];

  const subnavRight = (
    <span className="hidden sm:inline-flex items-center gap-2 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
      <span className="inline-block w-1.5 h-1.5 bg-wf-running animate-pulse" />
      cron · {cronCount} schedules
    </span>
  );

  // 30-day window ending today. Bars stay illustrative until the live
  // activity endpoint exists; only the date axis is "real".
  const activity = { ...stats.activity, days: lastNDaysUTC(stats.activity.days.length) };

  return (
    <WorkforceLayout subnavRight={subnavRight}>
      {/* HERO ---------------------------------------------------------- */}
      <section className="mb-8 sm:mb-10">
        <Typeplate label="OVERVIEW" value="PERFORMANCE · OVERVIEW" className="mb-4" />
        <h1 className="font-headline text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter leading-[1.02] mb-3 text-wf-on-surface">
          {personaCount} personas. One pipeline.<br className="hidden sm:block" /> Run state on a single readout.
        </h1>
        <p className="text-wf-on-surface-variant max-w-prose text-sm sm:text-base leading-relaxed">
          The crew is on individual cron schedules. {t.agents_throwing > 0 && (
            <>
              {t.agents_throwing === 1 ? 'One agent is' : `${t.agents_throwing} agents are`} currently{' '}
              <span className="text-wf-tertiary font-semibold">throwing</span> — see the live trace below.
            </>
          )}
        </p>
      </section>

      {/* KPIs ---------------------------------------------------------- */}
      <section className="mb-8 sm:mb-10">
        <KPIReadout items={kpis} />
      </section>

      {/* TWO-COLUMN: heat strip + live trace --------------------------- */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8 sm:mb-10">
        <div className="lg:col-span-2 border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
          <div className="border-b border-wf-outline-variant px-4 py-3 flex items-center justify-between">
            <Typeplate label="HEAT · 30D" value="WORKFORCE TOTAL" />
            <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
              {activity.days[0]} → {activity.days[activity.days.length - 1]}
            </span>
          </div>
          <div className="p-4">
            <HeatStrip activity={activity} />
            <div className="mt-3 flex items-center gap-3 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
              <span>less</span>
              {[0, 1, 2, 3, 4, 5].map((v) => (
                <span key={v} className={`w-3 h-3 inline-block ${intensityClass(v)}`} />
              ))}
              <span>more</span>
            </div>
          </div>
        </div>

        <LiveTrace runs={stats.recent_runs} className="lg:col-span-1" />
      </section>

      {/* CREW TABLE --------------------------------------------------- */}
      <section className="mb-8 sm:mb-10">
        <div className="flex items-end justify-between mb-3">
          <Typeplate label="CREW" value="CREW · LIVE STATE" />
          <Link
            to="/agents"
            className="font-wfmono text-[11px] uppercase tracking-[0.14em] text-wf-primary hover:underline"
          >
            VIEW ALL →
          </Link>
        </div>

        <div className="border border-wf-outline-variant rounded-wf-md overflow-hidden bg-wf-surface-container-lo">
          {/* Desktop: table. Mobile: stacked cards. Rows reuse the
              `rollup` we already aggregated for the headline KPIs so a
              newly added persona renders here even before the mock JSON
              is backfilled. */}
          <ul className="divide-y divide-wf-outline-variant">
            {rollup.map(({ agent: a, stats: s, status }) => {
              return (
                <li key={a.slug}>
                  <Link
                    to={`/agents/${a.slug}`}
                    className="grid grid-cols-1 md:grid-cols-12 items-center gap-3 md:gap-4 px-4 py-3 hover:bg-wf-surface-container-hi transition-colors"
                  >
                    <div className="flex items-center gap-3 md:col-span-4">
                      <Sigil slug={a.slug} size={40} />
                      <div className="min-w-0">
                        <div className="font-wfmono text-[11px] uppercase tracking-[0.12em] text-wf-on-surface-variant">
                          {a.slug.toUpperCase()}
                        </div>
                        <div className="font-semibold text-wf-on-surface truncate">{fullName(a)}</div>
                      </div>
                    </div>
                    <div className="md:col-span-3 text-sm">
                      <div className="text-wf-on-surface">{a.role}</div>
                      <div className="text-xs text-wf-on-surface-variant">{a.residence}</div>
                    </div>
                    <div className="md:col-span-2">
                      <StatusPill status={status} />
                    </div>
                    <div className="md:col-span-3 grid grid-cols-3 gap-2 font-wfmono text-xs">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">runs</div>
                        <div className="text-wf-on-surface">{s.runs_this_month}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">avg dur</div>
                        <div className="text-wf-on-surface">{s.avg_duration_s != null ? fmtDuration(s.avg_duration_s) : '—'}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">deliv</div>
                        <div className="text-wf-on-surface">{s.deliv_this_month ?? s.deliv_count_total ?? 0}</div>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* PERFORMANCE ANALYTICS (Epic-016) ----------------------------- */}
      <section className="mb-8 sm:mb-10">
        <div className="mb-3">
          <Typeplate label="ANALYTICS" value="PERFORMANCE · ANALYTICS" />
          <p className="mt-1 text-sm text-wf-on-surface-variant max-w-prose leading-relaxed">
            The workforce as one organism: is hiring converting into delivered
            output, and is the delivery process shedding its humans?
          </p>
        </div>
        <PerformancePanels scope={WORKFORCE_SCOPE} />
      </section>

      <p className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
        manifest @ {new Date(manifest.generated_at).toISOString().slice(0, 16)}Z · stats @ {new Date(stats.generated_at).toISOString().slice(0, 16)}Z
      </p>
    </WorkforceLayout>
  );
}
