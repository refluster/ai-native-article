// /workforce/agents/:slug — agent profile in the workforce console
// language. Hero with sigil + name + status, KPI strip, per-agent heat
// strip, recent executions, skills, identity, and reporting graph card.
//
// Data sources:
//   - manifest (workforce-agents.json) → static persona record + topology
//   - mock-stats (workforce-mock-stats.json) → fallback shape when
//     WORKFORCE_AGENTS_API_BASE is unset
//   - live agents-api (fetchAgentLive / fetchAgentExecutions) → preferred
//     when configured; supplants mock for THIS-MONTH numbers and the
//     execution-history list. The heat strip stays mock-driven for now
//     (no live endpoint exists yet).
//
// Epic-010 ROADMAP §Status-transition criterion 3 (C3): the execution-
// history list reads from the EXEC row family (PROJECT#{id}/EXEC#{ulid})
// via the GSI1 AGENT#{slug} query, NOT from the legacy
// AGENT#{slug}/RUN#{ulid} + AGENT#{slug}/DELIV#{ulid} rows. The C3
// migration replaced fetchAgentDeliverables with fetchAgentExecutions
// on this page; the deeplink-to-Notion/PR affordance the DELIV path
// surfaced is a documented regression (FU-NEW-G tracks the runner
// extension that re-enriches the EXEC row with notion_page_url /
// pr_url so the affordance can come back).

// Progressive rendering (2026-07-26). The page used to gate everything —
// breadcrumb, hero, KPIs, tabs — on one `Promise.all([findAgent, roster,
// stats])`, so the operator got a bare "Loading…" for the length of the
// slowest of three live reads. The loads are now independent and each
// region carries its own skeleton: the persona detail paints the hero, the
// /stats roll-up fills the KPI tiles behind it, and the roster only gates
// the org-graph card in the sidebar. The tab bar is interactive from the
// first frame.

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import WorkforceLayout from '../components/WorkforceLayout';
import Typeplate from '../components/Typeplate';
import Sigil from '../components/Sigil';
import StatusPill, { deriveStatus } from '../components/StatusPill';
import KPIReadout from '../components/KPIReadout';
import HeatStrip from '../components/HeatStrip';
import AgentOrgGraph from '../components/AgentOrgGraph';
import RecentPostsSection from '../components/RecentPostsSection';
import BindingsEditor from '../components/BindingsEditor';
import ExecutionTimeline from '../components/ExecutionTimeline';
import {
  SkeletonKPIReadout,
  SkeletonPanel,
  SkeletonProfileHero,
} from '../components/Skeleton';
import { useAsync } from '../lib/useAsync';
import {
  apiConfigured,
  fetchAgentExecutions,
  fetchAgentLive,
  findAgent,
  fullName,
  loadWorkforceManifest,
  loadWorkforceStats,
  type AgentExecution,
  type AgentLiveRecord,
} from '../lib/agents';
import { fmtDuration, fmtCompute } from '../lib/duration';
import type { WorkforceAgent } from '../types/agent';
import type { AgentMockStats, WorkforceMockStats } from '../types/stats';

const STREAM_LABEL: Record<WorkforceAgent['streams'][number], string> = {
  internal: 'workforce',
  client: 'client work',
  editorial: 'editorial',
};

// Unified ACTIVITY ledger: how many of the fetched EXEC rows to render.
const ACTIVITY_LIMIT = 30;

// The profile splits into meaning-level tabs (operator direction 2026-07-03,
// LinkedIn-style IA): identity reads in OVERVIEW, the run/deliverable record
// in ACTIVITY, the voice in POSTS, the wiring in BINDINGS. The active tab
// lives in the URL (?tab=) so deep links and refreshes keep their place.
const TABS = ['overview', 'activity', 'posts', 'bindings'] as const;
type Tab = (typeof TABS)[number];

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export default function AgentProfile() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? '') ? (rawTab as Tab) : 'overview';
  const setTab = (next: Tab) => {
    if (next === 'overview') searchParams.delete('tab');
    else searchParams.set('tab', next);
    setSearchParams(searchParams, { replace: true });
  };
  // Four independent reads. `agentState` is the only one the page can't
  // render without; the rest fill in their own regions as they land.
  const agentState = useAsync(async () => (slug ? (await findAgent(slug)) ?? null : null), [slug]);
  const rosterState = useAsync(async () => (await loadWorkforceManifest()).agents, []);
  const mockState = useAsync(() => loadWorkforceStats(), []);
  // Fetch a deeper window (not just 20) so the unified ACTIVITY ledger has a
  // meaningful run of recent history to render; it shows the most recent
  // ACTIVITY_LIMIT rows newest-first.
  const liveState = useAsync(
    async () => {
      if (!slug || !apiConfigured()) return { live: null, execs: [] as AgentExecution[] };
      const [l, d] = await Promise.all([fetchAgentLive(slug), fetchAgentExecutions(slug, 100)]);
      return { live: l ?? null, execs: d };
    },
    [slug],
  );

  const agent: WorkforceAgent | null | undefined = agentState.loading ? undefined : agentState.data;
  const roster: WorkforceAgent[] = rosterState.data ?? [];
  const mock: WorkforceMockStats | null = mockState.data;
  const live: AgentLiveRecord | null = liveState.data?.live ?? null;
  const execs: AgentExecution[] | null = liveState.loading ? null : liveState.data?.execs ?? [];
  const liveError = liveState.error;

  // The bindings editor PATCHes and gets the authoritative post-write array
  // back; hold it locally so the tab reflects the write without re-reading
  // the whole persona. Cleared on navigation to another agent.
  const [bindingsOverride, setBindingsOverride] = useState<WorkforceAgent['bindings'] | null>(null);
  useEffect(() => {
    setBindingsOverride(null);
  }, [slug]);

  useEffect(() => {
    if (agent) document.title = `${fullName(agent)} — Workforce`;
  }, [agent]);

  const mockForSlug: AgentMockStats | undefined = useMemo(
    () => (mock && slug ? mock.agents[slug] : undefined),
    [mock, slug],
  );

  if (agent === undefined) {
    // Skeleton in the shape of the real profile — breadcrumb and page
    // chrome are real, so nothing below reflows when the persona lands.
    return (
      <WorkforceLayout>
        <Breadcrumb slug={slug} />
        <section className="mb-8 sm:mb-10">
          <SkeletonProfileHero />
        </section>
        <section className="mb-8 sm:mb-10">
          <SkeletonKPIReadout />
        </section>
        <div className="space-y-6">
          <SkeletonPanel label="Loading agent detail" lines={5} />
          <SkeletonPanel label="Loading agent configuration" lines={3} />
        </div>
      </WorkforceLayout>
    );
  }
  if (agent === null) {
    return (
      <WorkforceLayout>
        <Typeplate label="ERROR" value="AGENT NOT FOUND" />
        <h1 className="font-headline text-3xl font-black tracking-tighter mt-3 text-wf-on-surface">
          No agent named "{slug}".
        </h1>
        <Link to="/agents" className="mt-4 inline-block font-wfmono text-xs uppercase tracking-[0.14em] text-wf-primary hover:underline">
          ← BACK TO CREW
        </Link>
      </WorkforceLayout>
    );
  }

  // KPI source preference: the /stats roll-up (computed from the EXEC
  // ledger) is the authoritative source for the activity figures — the
  // live AGENT#…/META counters (runs/cost) are stale because the CCR path
  // no longer maintains them. paused/archived DO come from META (the PATCH
  // endpoint writes them), so those keep their live preference below.
  const runsMTD = mockForSlug?.runs_this_month ?? live?.runs_this_month;
  // AVG DUR replaces SPEND: per-run token/cost usage is not observable
  // from the CCR execution path, so we report run duration — a real
  // compute proxy derivable from started_at/ended_at — instead.
  const avgDurMTD = mockForSlug?.avg_duration_s;
  const computeMTD = mockForSlug?.compute_seconds_this_month;
  const delivMTD = mockForSlug?.deliv_this_month ?? live?.deliv_count_total;
  const lastRunAt = mockForSlug?.last_run_at ?? live?.last_run_at;
  const lastRunStatus = mockForSlug?.last_run_status ?? live?.last_run_status ?? 'ok';
  const isPaused = live?.paused ?? mockForSlug?.paused ?? false;
  const isArchived = live?.archived ?? mockForSlug?.archived ?? false;
  const status = deriveStatus({ paused: isPaused, archived: isArchived, last_run_status: lastRunStatus });

  const kpis = [
    { cap: 'RUNS · MTD',   value: runsMTD !== undefined ? String(runsMTD) : '—',           sub: 'this month' },
    { cap: 'AVG DUR · MTD',value: avgDurMTD !== undefined ? fmtDuration(avgDurMTD) : '—',   sub: computeMTD !== undefined ? `${fmtCompute(computeMTD)} compute` : 'run duration' },
    { cap: 'DELIV · MTD',  value: delivMTD !== undefined ? String(delivMTD) : '—',          sub: 'this month' },
    // LAST RUN replaces the former NEXT RUN tile: next_run_at has no live
    // scheduler endpoint feeding it, so that tile always rendered "—" with
    // the whole binding note crammed underneath (a tall, value-less box).
    // LAST RUN is derivable from the EXEC ledger and pairs a real value
    // with a one-word status sub.
    { cap: 'LAST RUN',     value: lastRunAt ? formatRelative(lastRunAt) : '—',               sub: `status · ${lastRunStatus}`, alarm: status === 'throwing' },
  ];

  return (
    <WorkforceLayout>
      <Breadcrumb slug={agent.slug} />

      {/* HERO */}
      <section className="mb-8 sm:mb-10 flex flex-col md:flex-row md:items-start gap-4 sm:gap-6">
        <Sigil slug={agent.slug} size={88} />
        <div className="flex-1 min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <Typeplate label="AGENT WORKFORCE" value={`${agent.slug.toUpperCase()} · L${agent.depth}`} />
            <StatusPill status={status} />
          </div>
          <h1 className="font-headline text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter leading-[1.04] text-wf-on-surface mb-1">
            {fullName(agent)}
          </h1>
          <p className="font-wfmono text-xs sm:text-sm uppercase tracking-[0.12em] text-wf-on-surface-variant">
            {agent.role} · {agent.residence}
          </p>
          {agent.about && (
            <p className="mt-3 max-w-prose text-sm sm:text-base text-wf-on-surface-variant leading-relaxed">
              {agent.about}
            </p>
          )}
        </div>
      </section>

      {/* KPIs — the figures come from /stats + the live agent record, both
          slower than the persona detail above. Hold the tile shape until at
          least one of them lands rather than flashing four em-dashes. */}
      <section className="mb-8 sm:mb-10">
        {mockState.loading && liveState.loading ? <SkeletonKPIReadout /> : <KPIReadout items={kpis} />}
        {!apiConfigured() && (
          <p className="mt-2 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
            * mocked — wire WORKFORCE_AGENTS_API_BASE for live data
          </p>
        )}
        {liveError && (
          <p className="mt-2 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-tertiary">
            agents-api error: {liveError}
          </p>
        )}
      </section>

      {/* Meaning-level tabs (URL-backed via ?tab=) */}
      <nav className="mb-6 flex items-stretch gap-1 border-b border-wf-outline-variant overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-2 -mb-px border-b-2 font-wfmono text-[11px] uppercase tracking-[0.14em] whitespace-nowrap transition-colors ${
              tab === t
                ? 'border-wf-on-surface text-wf-on-surface'
                : 'border-transparent text-wf-on-surface-variant hover:text-wf-on-surface'
            }`}
            aria-current={tab === t ? 'page' : undefined}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6 sm:space-y-8">
            {/* JD — mission, key responsibilities, success measures */}
            {agent.jd && <JDPanel jd={agent.jd} />}

            {/* IDENTITY — archetype + operating principles */}
            {agent.identity && <IdentityPanel identity={agent.identity} />}

            {/* MEMORY — durable long-term state. Renders even when empty
                so the operator can see "no learned memory yet" as a state. */}
            {agent.memory && <MemoryPanel memory={agent.memory} />}

            {/* CONFIG facts grid */}
            <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
              <div className="border-b border-wf-outline-variant px-4 py-3">
                <Typeplate label="CONFIG" value="PERSONA · MODEL · PROJECT" />
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 p-4 text-sm">
                <Fact label="MODEL" value={agent.model} />
                <Fact label="PROMPT" value={`v${agent.prompt_version}`} />
                <Fact label="MONTHLY BUDGET" value={`USD ${agent.budget_monthly_usd}`} />
                <Fact label="PROJECT" value={agent.default_project} />
                <Fact label="STREAMS" value={agent.streams.map((s) => STREAM_LABEL[s]).join(' · ')} />
                {lastRunAt && (
                  <Fact label="LAST RUN" value={`${formatRelative(lastRunAt)} (${lastRunStatus})`} />
                )}
              </dl>
            </section>

            {/* DISCLOSURE — LLM-persona footer */}
            <section className="border border-wf-outline-variant bg-wf-surface-container rounded-wf-md p-4">
              <Typeplate label="DISCLOSURE" value="LLM-DRIVEN PERSONA" className="mb-2" />
              <p className="text-xs text-wf-on-surface-variant leading-relaxed">
                {fullName(agent)} is an LLM-driven persona on the Workforce platform. Articles bylined to{' '}
                {agent.first_name} are produced by an Anthropic Claude model running on AWS Lambda; the
                persona's full voice and limitations are documented in their{' '}
                <a
                  href={`https://github.com/refluster/ai-native-article/blob/main/workforce/agents/${agent.slug}/system.md`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-wf-primary hover:underline"
                >
                  system prompt
                </a>{' '}
                and acknowledged in every article footer.
              </p>
            </section>
          </div>

          {/* SIDEBAR — the org graph is the one region that needs the full
              roster, so it (and only it) waits on that read. */}
          <aside className="lg:col-span-1 space-y-6">
            {rosterState.loading ? (
              <SkeletonPanel label="Loading reporting graph" lines={5} />
            ) : (
              roster.length > 0 && <AgentOrgGraph agent={agent} roster={roster} />
            )}
          </aside>
        </div>
      )}

      {tab === 'activity' && (
        <div className="space-y-6 sm:space-y-8">
          {/* PERFORMANCE — 7-day rollup + per-skill execution bars */}
          {mockForSlug?.last_7d && <PerformancePanel last7d={mockForSlug.last_7d} />}

          {/* HEAT STRIP */}
          {mock && mock.activity.by_slug[agent.slug] && (
            <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
              <div className="border-b border-wf-outline-variant px-4 py-3 flex items-center justify-between">
                <Typeplate label="HEAT · 30D" value={agent.slug.toUpperCase()} />
                <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
                  {mock.activity.days[0]} → {mock.activity.days[mock.activity.days.length - 1]}
                </span>
              </div>
              <div className="p-4">
                <HeatStrip activity={mock.activity} slug={agent.slug} />
              </div>
            </section>
          )}

          {/* ACTIVITY — one unified ledger of every EXEC row, newest-first
              (live API only), rendered through the shared ExecutionTimeline
              (same visual language as the project page). Deeplinks to
              Notion / GitHub PRs aren't on EXEC yet (FU-NEW-G); until then
              the project link is the drill-down handle. */}
          {apiConfigured() && (
            <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
              <div className="border-b border-wf-outline-variant px-4 py-3 flex items-center justify-between gap-3">
                <Typeplate label="ACTIVITY" value="RUNS · DELIVERABLES" />
                <div className="flex items-center gap-3 shrink-0">
                  {execs !== null && execs.length > 0 && (
                    <span className="font-wfmono text-[10px] uppercase tracking-[0.12em] text-wf-on-surface-variant">
                      {Math.min(execs.length, ACTIVITY_LIMIT)} of {execs.length}
                    </span>
                  )}
                  {/* The ledger shows the newest N; recall (Epic-010 Story 4)
                      is how the operator reaches the rest by meaning. */}
                  <Link
                    to={`/agents/${agent.slug}/recall`}
                    className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-primary hover:underline"
                  >
                    RECALL →
                  </Link>
                </div>
              </div>
              <div className="p-4">
                {execs === null ? (
                  <p className="font-wfmono text-xs text-wf-on-surface-variant">Loading…</p>
                ) : execs.length === 0 ? (
                  <p className="font-wfmono text-xs text-wf-on-surface-variant">
                    no executions yet — orchestrator hasn't fired since deploy.
                  </p>
                ) : (
                  <ExecutionTimeline executions={execs} perspective="agent" limit={ACTIVITY_LIMIT} />
                )}
              </div>
            </section>
          )}

          {/* TASK LOG (mock fallback) */}
          {mockForSlug?.recent_runs && mockForSlug.recent_runs.length > 0 && (
            <RecentRunsPanel runs={mockForSlug.recent_runs} />
          )}
        </div>
      )}

      {tab === 'posts' && slug && <RecentPostsSection slug={slug} />}

      {tab === 'bindings' && (
        <div className="space-y-6">
          <BindingsEditor
            slug={agent.slug}
            bindings={bindingsOverride ?? agent.bindings}
            onUpdated={setBindingsOverride}
          />
        </div>
      )}
    </WorkforceLayout>
  );
}

/** Page chrome that needs no data — rendered in the skeleton state too, so
 *  the operator has a way back out while the persona is still loading. */
function Breadcrumb({ slug }: { slug: string | undefined }) {
  return (
    <div className="mb-4 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
      <Link to="/" className="hover:text-wf-on-surface">HOME</Link>
      <span className="mx-2">/</span>
      <Link to="/agents" className="hover:text-wf-on-surface">CREW</Link>
      <span className="mx-2">/</span>
      <span className="text-wf-on-surface">{(slug ?? '').toUpperCase()}</span>
    </div>
  );
}

function Fact({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-0.5">{label}</dt>
      <dd className="text-sm text-wf-on-surface">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-panels — kept inline rather than promoted to /components because they
// are only used here and read like one continuous profile narrative.
// ---------------------------------------------------------------------------

function JDPanel({ jd }: { jd: NonNullable<WorkforceAgent['jd']> }) {
  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3">
        <Typeplate label="JD" value="MISSION · RESPONSIBILITIES · MEASURES" />
      </div>
      <div className="p-4 sm:p-5 space-y-5">
        <div>
          <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-1.5">
            MISSION
          </div>
          <p className="text-base sm:text-lg text-wf-on-surface leading-snug">{jd.mission}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-2">
              KEY RESPONSIBILITIES
            </div>
            <ul className="space-y-1.5">
              {jd.key_responsibilities.map((r, i) => (
                <li key={i} className="flex gap-2 text-sm text-wf-on-surface">
                  <span aria-hidden className="font-wfmono text-wf-on-surface-variant shrink-0 w-5 text-right">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="leading-snug">{r}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-2">
              SUCCESS MEASURES
            </div>
            <ul className="space-y-1.5">
              {jd.success_measures.map((s, i) => (
                <li key={i} className="flex gap-2 text-sm text-wf-on-surface">
                  <span aria-hidden className="font-wfmono text-wf-tertiary shrink-0 w-5 text-right">
                    ✓
                  </span>
                  <span className="leading-snug">{s}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function IdentityPanel({ identity }: { identity: NonNullable<WorkforceAgent['identity']> }) {
  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3 flex items-center justify-between">
        <Typeplate label="IDENTITY" value="ARCHETYPE · PRINCIPLES · GUARDRAILS" />
        <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          OPENCLAW
        </span>
      </div>
      <div className="p-4 sm:p-5 space-y-4">
        <div>
          <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-1.5">
            ARCHETYPE
          </div>
          <p className="font-headline text-xl sm:text-2xl font-black tracking-tight text-wf-on-surface">
            {identity.archetype}
          </p>
        </div>
        <div>
          <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-2">
            OPERATING PRINCIPLES
          </div>
          <ul className="space-y-1.5">
            {identity.operating_principles.map((p, i) => (
              <li key={i} className="flex gap-2 text-sm text-wf-on-surface">
                <span aria-hidden className="text-wf-primary shrink-0">›</span>
                <span className="leading-snug">{p}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          <div>
            <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-1.5">
              VOICE
            </div>
            <p className="text-sm text-wf-on-surface leading-snug italic">"{identity.voice}"</p>
          </div>
          <div>
            <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-1.5">
              GUARDRAILS
            </div>
            <ul className="space-y-1">
              {identity.guardrails.map((g, i) => (
                <li key={i} className="flex gap-2 text-xs text-wf-on-surface">
                  <span aria-hidden className="font-wfmono text-wf-tertiary shrink-0">✕</span>
                  <span className="leading-snug">{g}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function PerformancePanel({ last7d }: { last7d: NonNullable<AgentMockStats['last_7d']> }) {
  const skillEntries = Object.entries(last7d.by_skill).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...skillEntries.map(([, n]) => n));
  const okPct = Math.round(last7d.ok_rate * 100);
  const avgMin = (last7d.avg_duration_s / 60).toFixed(1);
  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3 flex items-center justify-between">
        <Typeplate label="PERF" value="LAST 7 DAYS" />
        <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          rolling window
        </span>
      </div>
      <div className="p-4 sm:p-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <PerfTile cap="RUNS · 7D"     value={String(last7d.runs_total)} sub="skill executions" />
          <PerfTile cap="DELIV · 7D"    value={String(last7d.deliv_count)} sub="artefacts shipped" />
          <PerfTile cap="AVG · DUR"     value={`${avgMin}m`} sub="per run" />
          <PerfTile cap="OK · RATE"     value={`${okPct}%`} sub="green exits" alarm={okPct < 80} />
        </div>
        <div>
          <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-2">
            BY SKILL — 7D EXECUTIONS
          </div>
          <ul className="space-y-1.5">
            {skillEntries.map(([skill, n]) => (
              <li key={skill} className="flex items-center gap-3 text-sm">
                <Link
                  to={`/skills/${skill}`}
                  className="font-wfmono text-xs text-wf-on-surface hover:text-wf-primary shrink-0 w-40 sm:w-48 truncate"
                  title={skill}
                >
                  {skill}
                </Link>
                <div className="flex-1 h-3 bg-wf-surface-container rounded-wf-sm overflow-hidden">
                  <div
                    className="h-full bg-wf-primary"
                    style={{ width: `${Math.round((n / max) * 100)}%` }}
                    aria-label={`${n} executions`}
                  />
                </div>
                <span className="font-wfmono text-xs text-wf-on-surface tabular-nums shrink-0 w-8 text-right">
                  {n}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function PerfTile({ cap, value, sub, alarm = false }: { cap: string; value: string; sub: string; alarm?: boolean }) {
  return (
    <div className="border border-wf-outline-variant bg-wf-surface-container p-3 rounded-wf-sm">
      <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-1">
        {cap}
      </div>
      <div className={`font-wfmono font-medium leading-none tracking-tight ${
        alarm ? 'text-wf-tertiary' : 'text-wf-on-surface'
      } text-2xl sm:text-3xl`}>
        {value}
      </div>
      <div className="font-wfmono text-[10px] text-wf-on-surface-variant mt-1.5">{sub}</div>
    </div>
  );
}

const RUN_STATUS_LABEL: Record<string, { text: string; tone: string }> = {
  ok:    { text: 'ok',    tone: 'text-wf-running' },
  throw: { text: 'throw', tone: 'text-wf-throwing' },
  dlq:   { text: 'dlq',   tone: 'text-wf-throwing' },
};

function RecentRunsPanel({ runs }: { runs: NonNullable<AgentMockStats['recent_runs']> }) {
  const ordered = [...runs].sort(
    (a, b) => Date.parse(b.started_at) - Date.parse(a.started_at),
  ).slice(0, 20);
  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3 flex items-center justify-between">
        <Typeplate label="TASK LOG" value={`LAST ${ordered.length} RUNS`} />
        <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          when · what · result
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-wf-outline-variant">
              <th className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant text-left px-4 py-2 whitespace-nowrap">WHEN</th>
              <th className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant text-left px-2 py-2">SKILL</th>
              <th className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant text-right px-2 py-2 whitespace-nowrap">DUR</th>
              <th className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant text-left px-2 py-2">STATUS</th>
              <th className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant text-left px-4 py-2">RESULT</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-wf-outline-variant">
            {ordered.map((r, idx) => {
              const status = RUN_STATUS_LABEL[r.status] ?? RUN_STATUS_LABEL.ok;
              return (
                <tr key={`${r.started_at}-${idx}`} className="hover:bg-wf-surface-container/40">
                  <td className="font-wfmono text-xs text-wf-on-surface-variant px-4 py-2 whitespace-nowrap">
                    <div className="text-wf-on-surface">{r.started_at.slice(0, 10)}</div>
                    <div className="text-[10px]">{r.started_at.slice(11, 16)} · {formatRelative(r.started_at)}</div>
                  </td>
                  <td className="px-2 py-2">
                    <Link
                      to={`/skills/${r.skill}`}
                      className="font-wfmono text-xs text-wf-on-surface hover:text-wf-primary"
                    >
                      {r.skill}
                    </Link>
                  </td>
                  <td className="font-wfmono text-xs text-wf-on-surface tabular-nums text-right px-2 py-2 whitespace-nowrap">
                    {formatDuration(r.duration_s)}
                  </td>
                  <td className="px-2 py-2">
                    <span className={`font-wfmono text-[10px] uppercase tracking-[0.14em] ${status.tone}`}>
                      ● {status.text}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-sm">
                    {r.deliverable ? (
                      <span className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-wfmono text-[10px] uppercase tracking-[0.12em] text-wf-on-surface-variant">
                          {r.deliverable.type}
                        </span>
                        {r.deliverable.url ? (
                          <a
                            href={r.deliverable.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-wfmono text-xs text-wf-primary hover:underline"
                          >
                            {r.deliverable.id}
                          </a>
                        ) : (
                          <span className="font-wfmono text-xs text-wf-on-surface">{r.deliverable.id}</span>
                        )}
                      </span>
                    ) : r.note ? (
                      <span className="text-xs text-wf-on-surface-variant italic">{r.note}</span>
                    ) : (
                      <span className="font-wfmono text-[10px] text-wf-on-surface-variant">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s === 0 ? `${m}m` : `${m}m${String(s).padStart(2, '0')}`;
}

// Long-term memory is a plain-markdown MEMORY.md document (ADR-0019) —
// the semantic layer the persona re-reads at every fire. The panel
// renders the small markdown subset the seed/memory README's structure
// uses (## sections, - bullets, paragraphs); the `# MEMORY — …` title and
// the `> Curated …` provenance line are chrome the header already
// carries, so both are dropped rather than re-rendered.
type MemoryMdBlock =
  | { type: 'heading'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'para'; text: string };

function parseMemoryMd(body: string): MemoryMdBlock[] {
  const blocks: MemoryMdBlock[] = [];
  for (const raw of body.split(/\n{2,}/)) {
    const chunk = raw.trim();
    if (chunk === '' || chunk.startsWith('# ') || chunk.startsWith('>')) continue;
    if (chunk.startsWith('## ')) {
      // A section heading may share its blank-line block with body text.
      const [head, ...rest] = chunk.split('\n');
      blocks.push({ type: 'heading', text: head.replace(/^##\s+/, '') });
      const tail = rest.join('\n').trim();
      if (tail !== '') blocks.push(...parseMemoryMd(tail));
      continue;
    }
    if (/^[-*]\s/.test(chunk)) {
      // Bullets: one item per leading "- "; continuation lines fold in.
      const items = chunk
        .split(/\n(?=[-*]\s)/)
        .map((it) => it.replace(/^[-*]\s+/, '').replace(/\n\s*/g, ' ').trim())
        .filter(Boolean);
      blocks.push({ type: 'bullets', items });
      continue;
    }
    blocks.push({ type: 'para', text: chunk.replace(/\n\s*/g, ' ') });
  }
  return blocks;
}

// Render inline `*emphasis*` / `**strong**` as an emphasised span; drop the
// markers. Anything richer stays literal — memory is prose, not layout.
function MemoryInline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^\*\*[^*]+\*\*$/.test(p) ? (
          <strong key={i} className="font-semibold text-wf-on-surface">{p.slice(2, -2)}</strong>
        ) : /^\*[^*]+\*$/.test(p) ? (
          <em key={i} className="text-wf-on-surface">{p.slice(1, -1)}</em>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function MemoryPanel({ memory }: { memory: NonNullable<WorkforceAgent['memory']> }) {
  const body = memory.body?.trim() ?? '';
  const blocks = body === '' ? [] : parseMemoryMd(body);
  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3 flex items-center justify-between flex-wrap gap-2">
        <Typeplate label="MEMORY" value="LONG-TERM · SEMANTIC" />
        <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          MEMORY.md · curated {memory.last_updated}
        </span>
      </div>
      {blocks.length === 0 ? (
        <div className="px-4 py-5">
          <p className="text-sm text-wf-on-surface-variant leading-relaxed">
            No durable memory yet. This persona hasn't accumulated learned
            principles, people-context, or standing bets worth surviving
            across sessions. Memory is curated only when something is
            learned that should survive — not as a record of what was done.
          </p>
          <p className="mt-2 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
            see also · TASK LOG · ACTIVITY for the activity record
          </p>
        </div>
      ) : (
        <div className="px-4 py-4 space-y-3">
          {blocks.map((b, i) =>
            b.type === 'heading' ? (
              <h4
                key={i}
                className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-primary pt-1"
              >
                {b.text}
              </h4>
            ) : b.type === 'bullets' ? (
              <ul key={i} className="space-y-1.5">
                {b.items.map((it, j) => (
                  <li
                    key={j}
                    className="text-sm text-wf-on-surface-variant leading-relaxed pl-3 border-l border-wf-outline-variant"
                  >
                    <MemoryInline text={it} />
                  </li>
                ))}
              </ul>
            ) : (
              <p key={i} className="text-sm text-wf-on-surface-variant leading-relaxed">
                <MemoryInline text={b.text} />
              </p>
            ),
          )}
        </div>
      )}
    </section>
  );
}

