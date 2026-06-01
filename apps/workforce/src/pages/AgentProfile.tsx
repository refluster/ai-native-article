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

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import WorkforceLayout from '../components/WorkforceLayout';
import Typeplate from '../components/Typeplate';
import Sigil from '../components/Sigil';
import StatusPill, { deriveStatus } from '../components/StatusPill';
import KPIReadout from '../components/KPIReadout';
import HeatStrip from '../components/HeatStrip';
import AgentOrgGraph from '../components/AgentOrgGraph';
import RecentPostsSection from '../components/RecentPostsSection';
import {
  apiConfigured,
  fetchAgentExecutions,
  fetchAgentLive,
  findAgent,
  fullName,
  loadWorkforceManifest,
  loadWorkforceMockStats,
  type AgentExecution,
  type AgentLiveRecord,
} from '../lib/agents';
import { fetchAgentMemberships } from '../lib/projects';
import type { AgentMembership } from '../types/project';
import type { AgentMemoryKind, WorkforceAgent } from '../types/agent';
import type { AgentMockStats, WorkforceMockStats } from '../types/stats';

const STREAM_LABEL: Record<WorkforceAgent['streams'][number], string> = {
  internal: 'workforce',
  client: 'client work',
  editorial: 'editorial',
};

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

function nextRunLabel(iso: string | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const diffMin = Math.round((t - Date.now()) / 60_000);
  if (diffMin <= 0) return 'queued';
  if (diffMin < 60) return `in ${diffMin}m`;
  const hrs = Math.round(diffMin / 60);
  if (hrs < 48) return `in ${hrs}h`;
  return `in ${Math.round(hrs / 24)}d`;
}

export default function AgentProfile() {
  const { slug } = useParams<{ slug: string }>();
  const [agent, setAgent] = useState<WorkforceAgent | null | undefined>(undefined);
  const [roster, setRoster] = useState<WorkforceAgent[]>([]);
  const [mock, setMock] = useState<WorkforceMockStats | null>(null);
  const [live, setLive] = useState<AgentLiveRecord | null | undefined>(undefined);
  const [execs, setExecs] = useState<AgentExecution[] | null>(null);
  const [memberships, setMemberships] = useState<AgentMembership[] | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  // Load persona + mock stats up front.
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    Promise.all([findAgent(slug), loadWorkforceManifest(), loadWorkforceMockStats()])
      .then(([a, m, s]) => {
        if (cancelled) return;
        setAgent(a ?? null);
        setRoster(m.agents);
        setMock(s);
      })
      .catch(() => {
        if (!cancelled) setAgent(null);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Layer live data on top when the API is wired.
  useEffect(() => {
    if (!slug || !apiConfigured()) {
      setLive(null);
      setExecs([]);
      return;
    }
    let cancelled = false;
    Promise.all([fetchAgentLive(slug), fetchAgentExecutions(slug, 20)])
      .then(([l, d]) => {
        if (cancelled) return;
        setLive(l ?? null);
        setExecs(d);
      })
      .catch((err) => {
        if (cancelled) return;
        setLive(null);
        setExecs([]);
        setLiveError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Project memberships — separate effect so the projects API can be
  // wired independently of the agents live API (Story 6 #95). Renders
  // off whichever data source is configured: live agents-api when set,
  // otherwise the projects-mock fallback.
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    fetchAgentMemberships(slug)
      .then((items) => {
        if (cancelled) return;
        setMemberships(items);
      })
      .catch(() => {
        if (cancelled) return;
        setMemberships([]);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (agent) document.title = `${fullName(agent)} — Workforce`;
  }, [agent]);

  const mockForSlug: AgentMockStats | undefined = useMemo(
    () => (mock && slug ? mock.agents[slug] : undefined),
    [mock, slug],
  );

  if (agent === undefined) {
    return (
      <WorkforceLayout>
        <div className="font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface-variant">Loading…</div>
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

  // KPI source preference: live → mock → '—'
  const runsMTD = live?.runs_this_month ?? mockForSlug?.runs_this_month;
  const spendMTD = live?.cost_this_month_usd ?? mockForSlug?.cost_this_month_usd;
  const delivTotal = live?.deliv_count_total ?? mockForSlug?.deliv_count_total;
  const nextRun = mockForSlug?.next_run_at;
  const lastRunAt = live?.last_run_at ?? mockForSlug?.last_run_at;
  const lastRunStatus = live?.last_run_status ?? mockForSlug?.last_run_status ?? 'ok';
  const isPaused = live?.paused ?? mockForSlug?.paused ?? false;
  const isArchived = live?.archived ?? mockForSlug?.archived ?? false;
  const status = deriveStatus({ paused: isPaused, archived: isArchived, last_run_status: lastRunStatus });

  const budgetCap = agent.budget_monthly_usd;
  const spendPct = budgetCap > 0 && spendMTD !== undefined
    ? Math.min(100, Math.round((spendMTD / budgetCap) * 100))
    : 0;

  const kpis = [
    { cap: 'RUNS · MTD',  value: runsMTD !== undefined ? String(runsMTD) : '—',                     sub: 'this month' },
    { cap: 'SPEND · MTD', value: spendMTD !== undefined ? `$${spendMTD.toFixed(2)}` : '—',           sub: `of $${budgetCap} cap · ${spendPct}%` },
    { cap: 'DELIV',       value: delivTotal !== undefined ? String(delivTotal) : '—',                sub: 'lifetime total' },
    { cap: 'NEXT RUN',    value: nextRunLabel(nextRun),                                              sub: agent.bindings[0]?.note ?? `${agent.bindings.length} binding(s)`, alarm: status === 'throwing' },
  ];

  return (
    <WorkforceLayout>
      {/* Breadcrumb */}
      <div className="mb-4 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
        <Link to="/" className="hover:text-wf-on-surface">DASHBOARD</Link>
        <span className="mx-2">/</span>
        <Link to="/agents" className="hover:text-wf-on-surface">CREW</Link>
        <span className="mx-2">/</span>
        <span className="text-wf-on-surface">{agent.slug.toUpperCase()}</span>
      </div>

      {/* HERO */}
      <section className="mb-8 sm:mb-10 flex flex-col md:flex-row md:items-start gap-4 sm:gap-6">
        <Sigil slug={agent.slug} size={88} />
        <div className="flex-1 min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <Typeplate label="AGENT" value={`${agent.slug.toUpperCase()} · L${agent.depth}`} />
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

      {/* KPIs */}
      <section className="mb-8 sm:mb-10">
        <KPIReadout items={kpis} />
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

      {/* TWO COLUMN: main / sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6 sm:space-y-8">

          {/* JD — mission, key responsibilities, success measures */}
          {agent.jd && <JDPanel jd={agent.jd} />}

          {/* IDENTITY — OpenClaw-style archetype + operating principles */}
          {agent.identity && <IdentityPanel identity={agent.identity} />}

          {/* PERFORMANCE — 7-day rollup + per-skill execution bars */}
          {mockForSlug?.last_7d && (
            <PerformancePanel last7d={mockForSlug.last_7d} />
          )}

          {/* RECENT ACTIVITY — task log (when, what, result) */}
          {mockForSlug?.recent_runs && mockForSlug.recent_runs.length > 0 && (
            <RecentRunsPanel runs={mockForSlug.recent_runs} />
          )}

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

          {/* EXPERIENCE — joined, highlights, endorsements */}
          {agent.experience && <ExperiencePanel agent={agent} roster={roster} />}

          {/* MEMORY — durable long-term state. Renders even when empty
              so the operator can see "no learned memory yet" as a state. */}
          {agent.memory && <MemoryPanel memory={agent.memory} />}

          {/* CONFIG facts grid */}
          <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
            <div className="border-b border-wf-outline-variant px-4 py-3">
              <Typeplate label="DECK · CONFIG" value="PERSONA · MODEL · PROJECT" />
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

          {/* BINDINGS — cron × skill pairs */}
          <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
            <div className="border-b border-wf-outline-variant px-4 py-3">
              <Typeplate label="DECK · BINDINGS" value={`${agent.bindings.length} cron×skill`} />
            </div>
            <ul className="divide-y divide-wf-outline-variant">
              {agent.bindings.map((b, idx) => (
                <li key={idx} className="px-4 py-3 flex flex-col sm:flex-row sm:items-baseline gap-2 sm:gap-4 text-sm">
                  <Link
                    to={`/skills/${b.skill}`}
                    className="font-wfmono text-xs px-2.5 py-1.5 border border-wf-outline-variant text-wf-on-surface bg-wf-surface-container hover:border-wf-on-surface-variant hover:bg-wf-surface-container-hi rounded-wf-sm transition-colors self-start"
                  >
                    {b.skill}
                  </Link>
                  <span className="font-wfmono text-[11px] uppercase tracking-[0.12em] text-wf-on-surface-variant">
                    {b.trigger.cron ?? b.trigger.scheduler}
                  </span>
                  {b.note && (
                    <span className="text-wf-on-surface-variant">{b.note}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {/* MEMBERSHIPS — projects this agent is an active member of.
              Lives between BINDINGS and DELIVERABLES so the operator sees
              which trust boundaries this agent crosses before they see
              the artefacts they've produced inside those boundaries.
              Renders even when empty so a brand-new agent is visibly
              registered-but-unattached. */}
          {memberships !== null && (
            <MembershipsPanel memberships={memberships} />
          )}

          {/* DELIVERABLES (live API only) */}
          {apiConfigured() && (
            <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
              <div className="border-b border-wf-outline-variant px-4 py-3">
                <Typeplate label="DECK · EXEC" value="RECENT" />
              </div>
              <div className="p-4">
                {execs === null ? (
                  <p className="font-wfmono text-xs text-wf-on-surface-variant">Loading…</p>
                ) : execs.length === 0 ? (
                  <p className="font-wfmono text-xs text-wf-on-surface-variant">
                    no executions yet — orchestrator hasn't fired since deploy.
                  </p>
                ) : (
                  <ul className="divide-y divide-wf-outline-variant">
                    {execs.map((e) => {
                      const id = e.exec_ulid;
                      const startedDate = e.started_at?.slice(0, 10);
                      // EXEC rows carry the canonical S3 artefact URI.
                      // Deeplinks to Notion / GitHub PRs lived on the
                      // legacy DELIV row family and aren't on EXEC yet
                      // (FU-NEW-G follow-up). Until that lands the row
                      // surfaces the project_id + exec_ulid as the
                      // operator's drill-down handle.
                      return (
                        <li key={id} className="py-2.5 flex items-baseline gap-3 text-sm">
                          <span className="font-wfmono text-xs text-wf-on-surface-variant shrink-0 w-24">
                            {startedDate}
                          </span>
                          <span className="font-wfmono text-[10px] uppercase tracking-[0.12em] text-wf-on-surface-variant shrink-0 w-32 truncate" title={e.skill_name}>
                            {e.skill_name}
                          </span>
                          <span className="flex-1 font-wfmono text-xs text-wf-on-surface">
                            <Link
                              to={`/projects/${encodeURIComponent(e.project_id)}`}
                              className="text-wf-primary hover:underline"
                            >
                              {id.slice(0, 8)}
                            </Link>
                            <span className="ml-2 text-wf-on-surface-variant">
                              · {e.project_id}
                            </span>
                            <span
                              className={`ml-2 font-wfmono text-[10px] uppercase tracking-[0.12em] ${
                                e.status === 'ok'
                                  ? 'text-wf-running'
                                  : e.status === 'throw' || e.status === 'failed_artefact_redaction'
                                    ? 'text-wf-throwing'
                                    : 'text-wf-on-surface-variant'
                              }`}
                            >
                              {e.status === 'failed_artefact_redaction' ? 'REDACTED' : e.status}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>
          )}

          {/* DISCLOSURE — LLM-persona footer (slimmed: IDENTITY moved up) */}
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

        {/* SIDEBAR */}
        <aside className="lg:col-span-1 space-y-6">
          {roster.length > 0 && <AgentOrgGraph agent={agent} roster={roster} />}
        </aside>
      </div>

      {/* RECENT POSTS — appended section (Epic-011 cycle-1 verdict #3 closure: section, not tab). */}
      {slug && <RecentPostsSection slug={slug} />}
    </WorkforceLayout>
  );
}

export function MembershipsPanel({ memberships }: { memberships: AgentMembership[] }) {
  // self/{slug} projects are always present (auto-seeded by Story 1-B) so
  // surface them last; "real" project memberships are the interesting
  // signal for the operator.
  //
  // C-1/C-4: a single malformed membership row (missing project_id — e.g. a
  // legacy MEMBER row written before addMember stamped project_id, or API
  // shape drift) must not blank the whole agent page. Drop rows without a
  // string project_id rather than throwing inside .sort()/.map().
  const valid = memberships.filter(
    (m): m is AgentMembership => typeof m.project_id === 'string',
  );
  const sorted = [...valid].sort((a, b) => {
    const aSelf = a.project_id.startsWith('self/');
    const bSelf = b.project_id.startsWith('self/');
    if (aSelf !== bSelf) return aSelf ? 1 : -1;
    return a.project_id.localeCompare(b.project_id);
  });
  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3 flex items-center justify-between">
        <Typeplate label="DECK · PROJECTS" value={`${valid.length} MEMBERSHIPS`} />
        <Link
          to="/projects"
          className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-primary hover:underline"
        >
          ALL PROJECTS →
        </Link>
      </div>
      {valid.length === 0 ? (
        <div className="px-4 py-4">
          <p className="text-sm text-wf-on-surface-variant leading-relaxed">
            No project memberships yet. This agent is not bound to any project's trust boundary —
            assign one via{' '}
            <code className="font-wfmono text-xs">
              workforce/projects/{'{id}'}/members.json
            </code>{' '}
            (seed) or the in-app member editor (follow-up slice).
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-wf-outline-variant">
          {sorted.map((m) => {
            const isSelf = m.project_id.startsWith('self/');
            return (
              <li
                key={m.project_id}
                className="px-4 py-3 flex items-baseline justify-between gap-3"
              >
                <Link
                  to={`/projects/${encodeURIComponent(m.project_id)}`}
                  className="font-mono text-sm text-wf-on-surface hover:text-wf-primary truncate"
                >
                  {m.project_id}
                  {isSelf && (
                    <span className="ml-2 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
                      self
                    </span>
                  )}
                </Link>
                <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant whitespace-nowrap">
                  joined {m.joined_at ? m.joined_at.slice(0, 10) : '—'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
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
        <Typeplate label="DECK · JD" value="MISSION · RESPONSIBILITIES · MEASURES" />
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
        <Typeplate label="DECK · IDENTITY" value="ARCHETYPE · PRINCIPLES · GUARDRAILS" />
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
        <Typeplate label="DECK · PERF" value="LAST 7 DAYS" />
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
        <Typeplate label="DECK · TASK LOG" value={`LAST ${ordered.length} RUNS`} />
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

// Long-term memory has four kinds: durable facts, standing decisions,
// emergent preferences, and people-context. Entries within a kind are
// rendered in their authored order — long-term memory is NOT chronological,
// so no date sort. The Task Log and EXPERIENCE decks already cover the
// dated/activity view.
const MEMORY_KIND_META: Record<AgentMemoryKind, { label: string; tone: string; border: string; order: number }> = {
  fact:       { label: 'FACT',     tone: 'text-wf-on-surface',         border: 'border-wf-outline-variant', order: 0 },
  decision:   { label: 'DECISION', tone: 'text-wf-tertiary',           border: 'border-wf-tertiary/40',     order: 1 },
  preference: { label: 'PREF',     tone: 'text-wf-on-surface-variant', border: 'border-wf-outline-variant', order: 2 },
  person:     { label: 'PERSON',   tone: 'text-wf-primary',            border: 'border-wf-primary/40',      order: 3 },
};

function MemoryPanel({ memory }: { memory: NonNullable<WorkforceAgent['memory']> }) {
  const entries = memory.entries;
  const counts = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.kind] = (acc[e.kind] ?? 0) + 1;
    return acc;
  }, {});
  // Group by kind in canonical order; preserve authored order within a group.
  const grouped = [...entries].sort((a, b) =>
    (MEMORY_KIND_META[a.kind]?.order ?? 99) - (MEMORY_KIND_META[b.kind]?.order ?? 99),
  );
  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3 flex items-center justify-between flex-wrap gap-2">
        <Typeplate label="DECK · MEMORY" value="LONG-TERM · DURABLE STATE" />
        <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'} · curated {memory.last_updated}
        </span>
      </div>
      {entries.length === 0 ? (
        <div className="px-4 py-5">
          <p className="text-sm text-wf-on-surface-variant leading-relaxed">
            No durable memory yet. This persona hasn't accumulated facts,
            decisions, preferences, or people-context worth surviving across
            sessions. Memory entries are appended by the agent (or operator)
            only when something is learned that should survive — not as a
            record of what was done.
          </p>
          <p className="mt-2 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
            see also · TASK LOG · EXPERIENCE for the activity record
          </p>
        </div>
      ) : (
        <>
          <div className="px-4 pt-3 flex flex-wrap gap-2 border-b border-wf-outline-variant pb-3">
            {(Object.keys(MEMORY_KIND_META) as AgentMemoryKind[])
              .filter((k) => counts[k])
              .map((k) => {
                const m = MEMORY_KIND_META[k];
                return (
                  <span
                    key={k}
                    className={`font-wfmono text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 border ${m.border} ${m.tone} rounded-wf-sm`}
                  >
                    {m.label} · {counts[k]}
                  </span>
                );
              })}
          </div>
          <ol className="divide-y divide-wf-outline-variant">
            {grouped.map((e) => {
              const m = MEMORY_KIND_META[e.kind];
              return (
                <li
                  key={e.id}
                  className="px-4 py-3 grid grid-cols-[80px_1fr] sm:grid-cols-[100px_1fr] gap-x-3 gap-y-1"
                >
                  <span className={`font-wfmono text-[10px] uppercase tracking-[0.14em] ${m.tone}`}>
                    {m.label}
                  </span>
                  <span className="text-sm font-semibold text-wf-on-surface leading-snug">{e.subject}</span>
                  <span aria-hidden />
                  <span className="text-sm text-wf-on-surface-variant leading-snug">{e.body}</span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}

function ExperiencePanel({ agent, roster }: { agent: WorkforceAgent; roster: WorkforceAgent[] }) {
  const exp = agent.experience!;
  const tenureDays = Math.max(
    0,
    Math.round((Date.now() - Date.parse(exp.joined_at)) / 86_400_000),
  );
  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3 flex items-center justify-between">
        <Typeplate label="DECK · EXPERIENCE" value="TRACK RECORD ON THE WORKFORCE" />
        <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          joined {exp.joined_at} · {tenureDays}d
        </span>
      </div>
      <div className="p-4 sm:p-5 space-y-5">
        {exp.highlights.length > 0 && (
          <div>
            <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-2">
              HIGHLIGHTS
            </div>
            <ol className="relative border-l border-wf-outline-variant pl-4 space-y-3">
              {exp.highlights.map((h, i) => (
                <li key={i} className="relative">
                  <span
                    aria-hidden
                    className="absolute -left-[19px] top-1.5 w-2 h-2 bg-wf-primary rounded-full"
                  />
                  <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
                    {h.date}
                  </div>
                  <div className="text-sm font-semibold text-wf-on-surface leading-snug">{h.title}</div>
                  <div className="text-sm text-wf-on-surface-variant leading-snug">{h.impact}</div>
                </li>
              ))}
            </ol>
          </div>
        )}
        {exp.endorsements.length > 0 && (
          <div>
            <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-2">
              ENDORSEMENTS · TEAMMATES
            </div>
            <ul className="space-y-2">
              {exp.endorsements.map((e, i) => {
                const teammate = roster.find((r) => r.slug === e.from);
                const label = teammate ? `${teammate.first_name} ${teammate.last_name}` : e.from;
                const subtitle = teammate ? teammate.role : '';
                return (
                  <li
                    key={i}
                    className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3 text-sm border border-wf-outline-variant rounded-wf-sm px-3 py-2"
                  >
                    <Link
                      to={`/agents/${e.from}`}
                      className="font-wfmono text-xs text-wf-on-surface hover:text-wf-primary shrink-0"
                    >
                      {label}
                    </Link>
                    {subtitle && (
                      <span className="font-wfmono text-[10px] uppercase tracking-[0.12em] text-wf-on-surface-variant shrink-0">
                        {subtitle}
                      </span>
                    )}
                    <span className="text-wf-on-surface flex-1 italic">"{e.for}"</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
