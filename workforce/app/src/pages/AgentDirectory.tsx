// /workforce/agents — Crew Index. The roster, sorted by depth (root
// first) then last run. Responsive: dense table on md+, stacked cards
// under that.
//
// Filter chips (ALL / RUNNING / THROWING / PAUSED) and a search box let
// the operator focus the list. State is purely client-side; reload
// returns to ALL.
//
// Progressive rendering (2026-07-26). The page used to await
// `Promise.all([roster, stats])` and paint one "Loading…" line until BOTH
// landed — the roster is a paginated live agents-api read, so that was the
// whole round-trip with nothing on screen. Now the two loads are
// independent: the header band and filters paint immediately, the roster
// paints as soon as the manifest lands (with skeletons in the cells that
// need /stats), and the run figures fill in behind it. A /stats failure
// degrades to a visible banner over a rendered roster rather than blanking
// the page — the roster is the part the operator came for.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import WorkforceLayout from '../components/WorkforceLayout';
import Typeplate from '../components/Typeplate';
import Sigil from '../components/Sigil';
import StatusPill, { type AgentStatus, deriveStatus } from '../components/StatusPill';
import { Skeleton, SkeletonRosterRows } from '../components/Skeleton';
import { loadWorkforceManifest, loadWorkforceStats, fullName } from '../lib/agents';
import { useAsync } from '../lib/useAsync';
import { fmtDuration } from '../lib/duration';
import type { WorkforceAgent } from '../types/agent';
import type { AgentMockStats } from '../types/stats';

type Filter = 'all' | 'running' | 'throwing' | 'paused';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all',      label: 'ALL' },
  { id: 'running',  label: 'RUNNING' },
  { id: 'throwing', label: 'THROWING' },
  { id: 'paused',   label: 'PAUSED' },
];

/** Row shape: the persona always resolves; its run figures may still be
 *  in flight (`stats === null`), in which case the cells render skeletons. */
interface Row {
  agent: WorkforceAgent;
  stats: AgentMockStats | null;
  status: AgentStatus | null;
}

export default function AgentDirectory() {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    document.title = 'Workforce — Crew';
  }, []);

  const roster = useAsync(() => loadWorkforceManifest(), []);
  const stats = useAsync(() => loadWorkforceStats(), []);

  const rows = useMemo<Row[]>(() => {
    const manifest = roster.data;
    if (!manifest) return [];
    const s = stats.data;
    const q = query.trim().toLowerCase();
    return manifest.agents
      .map((a) => {
        // Synthesize a paused placeholder for agents the stats source
        // doesn't yet cover — silently dropping them (the bug we had) made
        // new personas invisible until the operator remembered to backfill
        // the JSON. Render them with PAUSED status + zeros so they're
        // visibly registered-but-idle. While /stats is still in flight the
        // row carries `null` instead, and the cells show skeletons.
        const row = s
          ? s.agents[a.slug] ?? {
              paused: true,
              archived: false,
              last_run_at: '',
              last_run_status: 'ok' as const,
              runs_this_month: 0,
              deliv_this_month: 0,
              avg_duration_s: 0,
              compute_seconds_this_month: 0,
            }
          : null;
        return {
          agent: a,
          stats: row,
          status: row
            ? deriveStatus({ paused: row.paused, archived: row.archived, last_run_status: row.last_run_status })
            : null,
        };
      })
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
        const depth = a.agent.depth - b.agent.depth;
        if (depth !== 0) return depth;
        const at = a.stats?.last_run_at ? new Date(a.stats.last_run_at).getTime() : 0;
        const bt = b.stats?.last_run_at ? new Date(b.stats.last_run_at).getTime() : 0;
        return bt - at;
      });
  }, [roster.data, stats.data, filter, query]);

  if (roster.error) {
    return (
      <WorkforceLayout>
        <div className="font-wfmono text-sm text-wf-tertiary">Could not load crew index: {roster.error}</div>
      </WorkforceLayout>
    );
  }

  // A status filter can't be applied before /stats resolves — hold the
  // skeleton rather than render an empty, wrong-looking list.
  const rosterPending = roster.loading || (filter !== 'all' && stats.loading);

  return (
    <WorkforceLayout>
      {/* Header band — paints immediately, no data required. */}
      <section className="mb-6 sm:mb-8">
        {roster.data ? (
          <Typeplate label="CREW" value={`CREW · ${roster.data.agents.length} AGENTS`} className="mb-3" />
        ) : (
          <Skeleton className="h-4 w-40 mb-3" />
        )}
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

      {/* A /stats failure must be loud (C-4) but must not cost the operator
          the roster — the run figures degrade, the crew list stays. */}
      {stats.error && (
        <div className="mb-4 border border-wf-tertiary rounded-none sm:rounded-wf-md wf-bleed-x px-4 py-3 font-wfmono text-[11px] uppercase tracking-[0.12em] text-wf-tertiary">
          run figures unavailable: {stats.error}
        </div>
      )}

      {rosterPending ? (
        <SkeletonRosterRows rows={8} />
      ) : (
        <>
          {/* MOBILE: stacked cards, full-bleed. DESKTOP: table layout. */}
          <ul className="md:hidden wf-bleed-x border-y border-wf-outline-variant divide-y divide-wf-outline-variant bg-wf-surface-container-lo sm:border sm:rounded-wf-md sm:overflow-hidden">
            {rows.map(({ agent, stats: s, status }) => (
              <li key={agent.slug}>
                <Link
                  to={`/agents/${agent.slug}`}
                  className="block p-4 hover:bg-wf-surface-container-hi transition-colors"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <Sigil slug={agent.slug} size={48} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
                          {agent.slug.toUpperCase()} · L{agent.depth}
                        </div>
                        {status ? <StatusPill status={status} compact /> : <Skeleton className="h-4 w-16" />}
                      </div>
                      <div className="font-semibold text-wf-on-surface truncate">{fullName(agent)}</div>
                      <div className="text-xs text-wf-on-surface-variant">{agent.role} · {agent.residence}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 font-wfmono">
                    <Metric label="RUNS" value={s ? String(s.runs_this_month) : null} />
                    <Metric label="AVG DUR" value={s ? (s.avg_duration_s != null ? fmtDuration(s.avg_duration_s) : '—') : null} />
                    <Metric label="DELIV" value={s ? String(s.deliv_this_month ?? s.deliv_count_total ?? 0) : null} />
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
              <div className="col-span-1 text-right">AVG DUR</div>
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
                          {agent.slug.toUpperCase()} · L{agent.depth}
                        </div>
                        <div className="font-semibold text-wf-on-surface truncate">{fullName(agent)}</div>
                      </div>
                    </div>
                    <div className="col-span-2 text-sm">
                      <div className="text-wf-on-surface">{agent.role}</div>
                      <div className="text-xs text-wf-on-surface-variant">{agent.residence}</div>
                    </div>
                    <div className="col-span-2">
                      {status ? <StatusPill status={status} /> : <Skeleton className="h-5 w-20" />}
                    </div>
                    <div className="col-span-1 text-right font-wfmono text-sm text-wf-on-surface">
                      {s ? s.runs_this_month : <Skeleton className="h-3 w-6 ml-auto" />}
                    </div>
                    <div className="col-span-1 text-right font-wfmono text-sm text-wf-on-surface">
                      {s ? (s.avg_duration_s != null ? fmtDuration(s.avg_duration_s) : '—') : <Skeleton className="h-3 w-10 ml-auto" />}
                    </div>
                    <div className="col-span-2 text-right font-wfmono text-xs text-wf-on-surface-variant">
                      {s
                        ? s.last_run_at
                          ? new Date(s.last_run_at).toISOString().slice(0, 16).replace('T', ' ')
                          : '—'
                        : <Skeleton className="h-3 w-24 ml-auto" />}
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
        </>
      )}
    </WorkforceLayout>
  );
}

/** One mobile stat cell — value, or a skeleton while /stats is in flight. */
function Metric({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.14em] text-wf-on-surface-variant">{label}</div>
      {value === null ? (
        <Skeleton className="h-4 w-10 mt-1" />
      ) : (
        <div className="text-sm text-wf-on-surface">{value}</div>
      )}
    </div>
  );
}
