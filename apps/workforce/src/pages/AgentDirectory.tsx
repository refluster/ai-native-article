// /workforce/agents — Crew Index. The roster, sorted by tier then last
// run. Responsive: dense table on md+, stacked cards under that.
//
// Filter chips (ALL / RUNNING / THROWING / PAUSED) and a search box let
// the operator focus the list. State is purely client-side; reload
// returns to ALL.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import WorkforceLayout from '../components/WorkforceLayout';
import Typeplate from '../components/Typeplate';
import Sigil from '../components/Sigil';
import StatusPill, { type AgentStatus, deriveStatus } from '../components/StatusPill';
import { loadWorkforceManifest, loadWorkforceMockStats, fullName } from '../lib/agents';
import type { WorkforceAgent, WorkforceAgentManifest } from '../types/agent';
import type { WorkforceMockStats } from '../types/stats';

type Filter = 'all' | 'running' | 'throwing' | 'paused';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all',      label: 'ALL' },
  { id: 'running',  label: 'RUNNING' },
  { id: 'throwing', label: 'THROWING' },
  { id: 'paused',   label: 'PAUSED' },
];

function tierWeight(t: WorkforceAgent['tier']): number {
  if (t === 'founder') return 0;
  if (t === 'lead') return 1;
  return 2;
}

export default function AgentDirectory() {
  const [manifest, setManifest] = useState<WorkforceAgentManifest | null>(null);
  const [stats, setStats] = useState<WorkforceMockStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    document.title = 'Workforce — Crew';
    Promise.all([loadWorkforceManifest(), loadWorkforceMockStats()])
      .then(([m, s]) => {
        setManifest(m);
        setStats(s);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const rows = useMemo(() => {
    if (!manifest || !stats) return [];
    const q = query.trim().toLowerCase();
    return manifest.agents
      .map((a) => {
        const s = stats.agents[a.slug];
        if (!s) return null;
        const status = deriveStatus({ paused: s.paused, archived: s.archived, last_run_status: s.last_run_status });
        return { agent: a, stats: s, status } as { agent: WorkforceAgent; stats: typeof s; status: AgentStatus };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .filter((r) => (filter === 'all' ? true : r.status === filter))
      .filter((r) => {
        if (!q) return true;
        return (
          r.agent.slug.includes(q) ||
          fullName(r.agent).toLowerCase().includes(q) ||
          r.agent.role.toLowerCase().includes(q) ||
          r.agent.residence.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const tier = tierWeight(a.agent.tier) - tierWeight(b.agent.tier);
        if (tier !== 0) return tier;
        return new Date(b.stats.last_run_at).getTime() - new Date(a.stats.last_run_at).getTime();
      });
  }, [manifest, stats, filter, query]);

  if (error) {
    return (
      <WorkforceLayout>
        <div className="font-wfmono text-sm text-wf-tertiary">Could not load crew index: {error}</div>
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

  return (
    <WorkforceLayout>
      {/* Header band */}
      <section className="mb-6 sm:mb-8">
        <Typeplate label="DECK 02" value={`CREW · ${manifest.agents.length} AGENTS`} className="mb-3" />
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <h1 className="font-headline text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter leading-[1.04] text-wf-on-surface">
            The crew.
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`font-wfmono text-[10px] uppercase tracking-[0.14em] px-3 py-1.5 border transition-colors ${
                  filter === f.id
                    ? 'border-wf-tertiary text-wf-tertiary'
                    : 'border-wf-outline-variant text-wf-on-surface-variant hover:border-wf-on-surface-variant hover:text-wf-on-surface'
                }`}
              >
                {f.label}
              </button>
            ))}
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="search by slug / role / city"
              className="font-wfmono text-xs px-3 py-1.5 border border-wf-outline-variant bg-wf-surface-container-lo text-wf-on-surface placeholder:text-wf-on-surface-variant w-full md:w-56 focus:outline-none focus:border-wf-primary"
            />
          </div>
        </div>
      </section>

      {/* MOBILE: stacked cards. DESKTOP: table layout. */}

      {/* Mobile */}
      <ul className="md:hidden space-y-3">
        {rows.map(({ agent, stats: s, status }) => (
          <li key={agent.slug}>
            <Link
              to={`/agents/${agent.slug}`}
              className="block border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-4 hover:bg-wf-surface-container-hi transition-colors"
            >
              <div className="flex items-start gap-3 mb-3">
                <Sigil slug={agent.slug} size={48} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
                      {agent.slug.toUpperCase()} · {agent.tier.toUpperCase()}
                    </div>
                    <StatusPill status={status} compact />
                  </div>
                  <div className="font-semibold text-wf-on-surface truncate">{fullName(agent)}</div>
                  <div className="text-xs text-wf-on-surface-variant">{agent.role} · {agent.residence}</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 font-wfmono">
                <div>
                  <div className="text-[9px] uppercase tracking-[0.14em] text-wf-on-surface-variant">RUNS</div>
                  <div className="text-sm text-wf-on-surface">{s.runs_this_month}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-[0.14em] text-wf-on-surface-variant">SPEND</div>
                  <div className="text-sm text-wf-on-surface">${s.cost_this_month_usd.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-[0.14em] text-wf-on-surface-variant">DELIV</div>
                  <div className="text-sm text-wf-on-surface">{s.deliv_count_total}</div>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {/* Desktop */}
      <div className="hidden md:block border border-wf-outline-variant rounded-wf-md overflow-hidden bg-wf-surface-container-lo">
        <div className="grid grid-cols-12 gap-3 px-4 py-2 border-b border-wf-outline-variant font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          <div className="col-span-4">AGENT</div>
          <div className="col-span-2">ROLE</div>
          <div className="col-span-2">STATUS</div>
          <div className="col-span-1 text-right">RUNS</div>
          <div className="col-span-1 text-right">SPEND</div>
          <div className="col-span-2 text-right">LAST RUN</div>
        </div>
        <ul className="divide-y divide-wf-outline-variant">
          {rows.map(({ agent, stats: s, status }) => (
            <li key={agent.slug}>
              <Link
                to={`/agents/${agent.slug}`}
                className="grid grid-cols-12 gap-3 items-center px-4 py-3 hover:bg-wf-surface-container-hi transition-colors"
              >
                <div className="col-span-4 flex items-center gap-3 min-w-0">
                  <Sigil slug={agent.slug} size={40} />
                  <div className="min-w-0">
                    <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
                      {agent.slug.toUpperCase()} · {agent.tier.toUpperCase()}
                    </div>
                    <div className="font-semibold text-wf-on-surface truncate">{fullName(agent)}</div>
                  </div>
                </div>
                <div className="col-span-2 text-sm">
                  <div className="text-wf-on-surface">{agent.role}</div>
                  <div className="text-xs text-wf-on-surface-variant">{agent.residence}</div>
                </div>
                <div className="col-span-2">
                  <StatusPill status={status} />
                </div>
                <div className="col-span-1 text-right font-wfmono text-sm text-wf-on-surface">{s.runs_this_month}</div>
                <div className="col-span-1 text-right font-wfmono text-sm text-wf-on-surface">${s.cost_this_month_usd.toFixed(2)}</div>
                <div className="col-span-2 text-right font-wfmono text-xs text-wf-on-surface-variant">
                  {new Date(s.last_run_at).toISOString().slice(0, 16).replace('T', ' ')}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {rows.length === 0 && (
        <div className="mt-6 font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface-variant">
          no agents match.
        </div>
      )}
    </WorkforceLayout>
  );
}
