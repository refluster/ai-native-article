// /workforce/agents/:slug — agent profile in the workforce console
// language. Hero with sigil + name + status, KPI strip, per-agent heat
// strip, recent runs, skills, identity, and reporting graph card.
//
// Data sources:
//   - manifest (workforce-agents.json) → static persona record + topology
//   - mock-stats (workforce-mock-stats.json) → fallback shape when
//     WORKFORCE_AGENTS_API_BASE is unset
//   - live agents-api (fetchAgentLive / fetchAgentDeliverables) → preferred
//     when configured; supplants mock for THIS-MONTH numbers and the
//     deliverables list. The heat strip stays mock-driven for now (no
//     live endpoint exists yet).

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import WorkforceLayout from '../components/WorkforceLayout';
import Typeplate from '../components/Typeplate';
import Sigil from '../components/Sigil';
import StatusPill, { deriveStatus } from '../components/StatusPill';
import KPIReadout from '../components/KPIReadout';
import HeatStrip from '../components/HeatStrip';
import AgentOrgGraph from '../components/AgentOrgGraph';
import {
  apiConfigured,
  fetchAgentDeliverables,
  fetchAgentLive,
  findAgent,
  fullName,
  loadWorkforceManifest,
  loadWorkforceMockStats,
  type AgentDeliverable,
  type AgentLiveRecord,
} from '../lib/agents';
import type { WorkforceAgent } from '../types/agent';
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
  const [delivs, setDelivs] = useState<AgentDeliverable[] | null>(null);
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
      setDelivs([]);
      return;
    }
    let cancelled = false;
    Promise.all([fetchAgentLive(slug), fetchAgentDeliverables(slug, 20)])
      .then(([l, d]) => {
        if (cancelled) return;
        setLive(l ?? null);
        setDelivs(d);
      })
      .catch((err) => {
        if (cancelled) return;
        setLive(null);
        setDelivs([]);
        setLiveError(err instanceof Error ? err.message : String(err));
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
                    {b.cron}
                  </span>
                  {b.note && (
                    <span className="text-wf-on-surface-variant">{b.note}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {/* DELIVERABLES (live API only) */}
          {apiConfigured() && (
            <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
              <div className="border-b border-wf-outline-variant px-4 py-3">
                <Typeplate label="DECK · DELIV" value="RECENT" />
              </div>
              <div className="p-4">
                {delivs === null ? (
                  <p className="font-wfmono text-xs text-wf-on-surface-variant">Loading…</p>
                ) : delivs.length === 0 ? (
                  <p className="font-wfmono text-xs text-wf-on-surface-variant">
                    no deliverables yet — orchestrator hasn't fired since deploy.
                  </p>
                ) : (
                  <ul className="divide-y divide-wf-outline-variant">
                    {delivs.map((d) => {
                      const id = d.sk.replace(/^DELIV#/, '');
                      const link =
                        d.pr_url ??
                        d.notion_page_url ??
                        (d.notion_page_id
                          ? `https://www.notion.so/${d.notion_page_id.replace(/-/g, '')}`
                          : undefined);
                      return (
                        <li key={id} className="py-2.5 flex items-baseline gap-3 text-sm">
                          <span className="font-wfmono text-xs text-wf-on-surface-variant shrink-0 w-24">
                            {d.created_at?.slice(0, 10)}
                          </span>
                          <span className="font-wfmono text-[10px] uppercase tracking-[0.12em] text-wf-on-surface-variant shrink-0 w-20">
                            {d.type}
                          </span>
                          <span className="flex-1">
                            {link ? (
                              <a href={link} target="_blank" rel="noopener noreferrer" className="text-wf-primary hover:underline">
                                {id.slice(0, 8)}
                              </a>
                            ) : (
                              <>{id.slice(0, 8)}</>
                            )}
                            {d.status && (
                              <span className="ml-2 font-wfmono text-[10px] uppercase tracking-[0.12em] text-wf-on-surface-variant">
                                {d.status}
                              </span>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>
          )}

          {/* IDENTITY / BIAS DISCLOSURE */}
          <section className="border border-wf-outline-variant bg-wf-surface-container rounded-wf-md p-4">
            <Typeplate label="DECK · IDENTITY" value="LLM-DRIVEN PERSONA" className="mb-2" />
            <p className="text-sm text-wf-on-surface-variant leading-relaxed">
              {fullName(agent)} is an LLM-driven persona on the Workforce platform. Articles bylined to{' '}
              {agent.first_name} are produced by an Anthropic Claude model running on AWS Lambda; the persona's
              voice, biases, and limitations are described in their{' '}
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
    </WorkforceLayout>
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
