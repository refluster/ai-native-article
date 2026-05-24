// /workforce — the console landing page. Hero KPI readout, 30-day heat
// strip, live trace ribbon, and a per-agent row table. Responsive: stacks
// vertically on mobile, switches to a two-column layout from md+.
//
// Data sources:
//   - workforce-agents.json  → roster + metadata
//   - workforce-mock-stats.json → totals + per-agent stats + activity
// When WORKFORCE_AGENTS_API_BASE is configured, individual agent rows
// will fall through to fetchAgentLive on the profile page; the Dashboard
// aggregates currently still read from the mock file.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import WorkforceLayout from '../components/WorkforceLayout';
import Typeplate from '../components/Typeplate';
import Sigil from '../components/Sigil';
import StatusPill, { deriveStatus } from '../components/StatusPill';
import KPIReadout from '../components/KPIReadout';
import HeatStrip, { intensityClass } from '../components/HeatStrip';
import LiveTrace from '../components/LiveTrace';
import { loadWorkforceManifest, loadWorkforceMockStats, fullName } from '../lib/agents';
import type { WorkforceAgentManifest } from '../types/agent';
import type { WorkforceMockStats } from '../types/stats';

export default function Dashboard() {
  const [manifest, setManifest] = useState<WorkforceAgentManifest | null>(null);
  const [stats, setStats] = useState<WorkforceMockStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Workforce — Dashboard';
    Promise.all([loadWorkforceManifest(), loadWorkforceMockStats()])
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

  const t = stats.totals;
  const kpis = [
    { cap: 'CREW LIVE',  value: String(t.agents_running),                                                 sub: `${t.agents_paused} paused · ${t.agents_throwing} throwing` },
    { cap: 'RUNS · MTD', value: String(t.runs_this_month),                                                sub: `${stats.month} · ${manifest.agents.length} agents` },
    { cap: 'SPEND · MTD',value: `$${t.cost_this_month_usd.toFixed(2)}`,                                   sub: `of $${t.budget_envelope_usd.toFixed(0)} envelope` },
    { cap: 'DELIV · MTD',value: String(t.deliv_count_this_month),                                         sub: 'across all streams' },
  ];

  const subnavRight = (
    <span className="hidden sm:inline-flex items-center gap-2 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
      <span className="inline-block w-1.5 h-1.5 bg-wf-running animate-pulse" />
      cron · 5 schedules
    </span>
  );

  return (
    <WorkforceLayout subnavRight={subnavRight}>
      {/* HERO ---------------------------------------------------------- */}
      <section className="mb-8 sm:mb-10">
        <Typeplate label="DECK 01" value="WORKFORCE · OVERVIEW" className="mb-4" />
        <h1 className="font-headline text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter leading-[1.02] mb-3 text-wf-on-surface">
          Five personas. One pipeline.<br className="hidden sm:block" /> Run state on a single readout.
        </h1>
        <p className="text-wf-on-surface-variant max-w-prose text-sm sm:text-base leading-relaxed">
          The crew is on individual cron schedules. {t.agents_throwing > 0 && (
            <>One agent is currently <span className="text-wf-tertiary font-semibold">throwing</span> — see the live trace below.</>
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
              {stats.activity.days[0]} → {stats.activity.days[stats.activity.days.length - 1]}
            </span>
          </div>
          <div className="p-4">
            <HeatStrip activity={stats.activity} />
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
          <Typeplate label="DECK 02" value="CREW · LIVE STATE" />
          <Link
            to="/agents"
            className="font-wfmono text-[11px] uppercase tracking-[0.14em] text-wf-primary hover:underline"
          >
            VIEW ALL →
          </Link>
        </div>

        <div className="border border-wf-outline-variant rounded-wf-md overflow-hidden bg-wf-surface-container-lo">
          {/* Desktop: table. Mobile: stacked cards. */}
          <ul className="divide-y divide-wf-outline-variant">
            {manifest.agents.map((a) => {
              // Synthesize a paused placeholder for agents the
              // mock-stats file doesn't yet cover — dropping them
              // silently (the old behaviour) made new personas
              // invisible until the operator backfilled the JSON.
              const s = stats.agents[a.slug] ?? {
                paused: true,
                archived: false,
                last_run_at: '',
                last_run_status: 'ok' as const,
                runs_this_month: 0,
                cost_this_month_usd: 0,
                deliv_count_total: 0,
              };
              const status = deriveStatus({ paused: s.paused, archived: s.archived, last_run_status: s.last_run_status });
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
                        <div className="text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">spend</div>
                        <div className="text-wf-on-surface">${s.cost_this_month_usd.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">deliv</div>
                        <div className="text-wf-on-surface">{s.deliv_count_total}</div>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <p className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
        manifest @ {new Date(manifest.generated_at).toISOString().slice(0, 16)}Z · stats @ {new Date(stats.generated_at).toISOString().slice(0, 16)}Z
      </p>
    </WorkforceLayout>
  );
}
