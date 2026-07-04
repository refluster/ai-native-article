// /workforce/projects/:slug — project profile in the workforce console
// language. Hero with display name + status + owner (+ rename/archive
// controls), KPI strip, and execution-history table.
//
// The membership concept was removed 2026-07-03 — every registered agent
// participates in every project, so there is no members panel and no
// member routes. `owner_agent` remains the single responsibility pointer.
//
// React Router quirk: `:slug` is captured as one segment. Project ids
// can include `/` (e.g. `self/ren`) but the router would split that
// into two segments — see `/projects/*` wildcard route in App.tsx,
// which captures the whole remainder and exposes it as `params['*']`.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import WorkforceLayout from '../components/WorkforceLayout';
import Typeplate from '../components/Typeplate';
import KPIReadout from '../components/KPIReadout';
import ProjectArchiveButton from '../components/ProjectArchiveButton';
import ExecutionTimeline from '../components/ExecutionTimeline';
import CredentialVault from '../components/CredentialVault';
import PerformancePanels from '../components/PerformancePanels';
import { projectScope } from '../lib/performance';
import ProjectRenameButton from '../components/ProjectRenameButton';
import {
  apiConfigured,
  fetchProject,
  fetchProjectExecutions,
} from '../lib/projects';
import type {
  ProjectDetail,
  ProjectExecution,
} from '../types/project';

function formatRelative(iso: string | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toISOString().slice(0, 10);
}

// Status-renderer for the executions table lives in
// components/StatusBadge.tsx — single source of truth across the SPA
// (introduced for Story 6 to handle `failed_artefact_redaction` from
// Story 3).

export default function ProjectProfile() {
  // App.tsx wires `/projects/*` so the full remainder is the project id;
  // useParams()['*'] is undefined only when React-Router has no match.
  const params = useParams();
  const rawId = params['*'] ?? '';
  // The route param arrives URL-encoded (`self%2Fren`); the API + the
  // mock fixture key on the decoded form. A trailing `/performance` segment
  // selects the Performance tab (Epic-016) — the `/projects/*` wildcard
  // captures the whole remainder, so the view is parsed here rather than
  // via a separate route (which would collide with slash-bearing ids).
  const { projectId, view } = (() => {
    let decoded = rawId;
    try {
      decoded = decodeURIComponent(rawId);
    } catch {
      /* keep raw on malformed input */
    }
    const PERF = '/performance';
    if (decoded.endsWith(PERF)) {
      return { projectId: decoded.slice(0, -PERF.length), view: 'performance' as const };
    }
    return { projectId: decoded, view: 'overview' as const };
  })();

  const [project, setProject] = useState<ProjectDetail | null | undefined>(undefined);
  const [executions, setExecutions] = useState<ProjectExecution[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    Promise.all([
      fetchProject(projectId),
      fetchProjectExecutions(projectId, 50).catch(() => [] as ProjectExecution[]),
    ])
      .then(([p, x]) => {
        if (cancelled) return;
        setProject(p ?? null);
        setExecutions(x);
      })
      .catch((err) => {
        if (cancelled) return;
        setProject(null);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (project) document.title = `${project.project_id} — Workforce`;
  }, [project]);

  if (project === undefined) {
    return (
      <WorkforceLayout>
        <div className="font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface-variant">
          Loading…
        </div>
      </WorkforceLayout>
    );
  }
  if (project === null) {
    return (
      <WorkforceLayout>
        <Typeplate label="ERROR" value="PROJECT NOT FOUND" />
        <h1 className="font-headline text-3xl font-black tracking-tighter mt-3 text-wf-on-surface">
          No project "{projectId}".
        </h1>
        {error && (
          <p className="mt-2 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-tertiary">
            agents-api error: {error}
          </p>
        )}
        <Link
          to="/projects"
          className="mt-4 inline-block font-wfmono text-xs uppercase tracking-[0.14em] text-wf-primary hover:underline"
        >
          ← BACK TO PROJECTS
        </Link>
      </WorkforceLayout>
    );
  }

  const okExecs = (executions ?? []).filter((e) => e.status === 'ok').length;
  const errExecs = (executions ?? []).filter((e) => e.status === 'throw').length;
  const distinctAgents = new Set((executions ?? []).map((e) => e.agent_slug)).size;

  const kpis = [
    { cap: 'AGENTS',      value: executions ? String(distinctAgents) : '—',             sub: 'active in window' },
    { cap: 'EXECS · 50',  value: executions ? String(executions.length) : '—',          sub: 'most recent window' },
    { cap: 'OK · RATE',   value: executions && executions.length > 0
                              ? `${Math.round((okExecs / executions.length) * 100)}%`
                              : '—',                                                     sub: `${okExecs} ok · ${errExecs} throw`,
                          alarm: errExecs > 0 },
    { cap: 'LAST EXEC',   value: formatRelative(project.last_execution_at),             sub: formatDate(project.last_execution_at) },
  ];

  return (
    <WorkforceLayout>
      {/* Breadcrumb */}
      <div className="mb-4 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
        <Link to="/" className="hover:text-wf-on-surface">HOME</Link>
        <span className="mx-2">/</span>
        <Link to="/projects" className="hover:text-wf-on-surface">PROJECTS</Link>
        <span className="mx-2">/</span>
        <span className="text-wf-on-surface font-mono">{project.project_id}</span>
      </div>

      {/* HERO */}
      <section className="mb-8 sm:mb-10">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <Typeplate label="PROJECT" value={project.project_id.toUpperCase()} />
          <StatusChip status={project.status} />
          <ProjectRenameButton
            projectId={project.project_id}
            name={project.name}
            onNameChange={(next) => {
              setProject((prev) => (prev ? { ...prev, name: next } : prev));
            }}
          />
          <ProjectArchiveButton
            projectId={project.project_id}
            status={project.status}
            onStatusChange={(next, archivedAt) => {
              // Functional updater — keeps state in sync if the parent
              // refetch fires concurrently with the optimistic flip.
              setProject((prev) =>
                prev ? { ...prev, status: next, archived_at: archivedAt } : prev,
              );
            }}
          />
        </div>
        <h1
          className={`font-headline text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter leading-[1.04] text-wf-on-surface mb-1 ${
            project.name ? '' : 'font-mono'
          }`}
        >
          {project.name ?? project.project_id}
        </h1>
        <p className="font-wfmono text-xs sm:text-sm uppercase tracking-[0.12em] text-wf-on-surface-variant">
          <span className="font-mono normal-case">{project.project_id}</span>
          {' · '}owner · {project.owner_agent} · created {formatDate(project.created_at)}
          {project.archived_at && ` · archived ${formatDate(project.archived_at)}`}
        </p>
      </section>

      {/* KPIs */}
      <section className="mb-8 sm:mb-10">
        <KPIReadout items={kpis} />
        {!apiConfigured() && (
          <p className="mt-2 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
            * mocked — wire WORKFORCE_AGENTS_API_BASE for live data
          </p>
        )}
        {error && (
          <p className="mt-2 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-tertiary">
            agents-api error: {error}
          </p>
        )}
      </section>

      {/* Overview / Performance tabs (Epic-016) */}
      <ProjectTabs projectId={project.project_id} view={view} />

      {view === 'performance' ? (
        <section className="mb-8 sm:mb-10">
          <PerformancePanels scope={projectScope(project.project_id)} />
        </section>
      ) : (
        /* TWO COLUMN: main / sidebar */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6 sm:space-y-8">
            <OverviewPanel project={project} />

            <ExecutionHistoryPanel executions={executions} />
          </div>

          <aside className="lg:col-span-1 space-y-6">
            <CredentialVault projectId={project.project_id} />
          </aside>
        </div>
      )}
    </WorkforceLayout>
  );
}

function ProjectTabs({
  projectId,
  view,
}: {
  projectId: string;
  view: 'overview' | 'performance';
}) {
  const enc = encodeURIComponent(projectId);
  const tabs: { label: string; to: string; active: boolean }[] = [
    { label: 'Overview', to: `/projects/${enc}`, active: view === 'overview' },
    { label: 'Performance', to: `/projects/${enc}/performance`, active: view === 'performance' },
  ];
  return (
    <nav className="mb-6 flex items-stretch gap-1 border-b border-wf-outline-variant">
      {tabs.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          className={`px-3 py-2 -mb-px border-b-2 font-wfmono text-[11px] uppercase tracking-[0.14em] transition-colors ${
            t.active
              ? 'border-wf-on-surface text-wf-on-surface'
              : 'border-transparent text-wf-on-surface-variant hover:text-wf-on-surface'
          }`}
          aria-current={t.active ? 'page' : undefined}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

function StatusChip({ status }: { status: 'active' | 'archived' }) {
  const tone = status === 'active' ? 'text-wf-running' : 'text-wf-archived';
  return (
    <span className={`font-wfmono text-[10px] uppercase tracking-[0.14em] ${tone}`}>
      ● {status}
    </span>
  );
}

function OverviewPanel({ project }: { project: ProjectDetail }) {
  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3">
        <Typeplate label="OVERVIEW" value="META · OWNER · ACTIVITY" />
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 p-4 text-sm">
        <Fact label="PROJECT_ID" value={project.project_id} mono />
        {project.name && <Fact label="NAME" value={project.name} />}
        <Fact label="STATUS" value={project.status} />
        <Fact label="OWNER" value={project.owner_agent} />
        <RepoFact owner={project.github_owner} repo={project.github_repo} />
        <Fact label="CREATED" value={formatDate(project.created_at)} />
        <Fact label="LAST EXEC" value={formatRelative(project.last_execution_at)} />
        {project.archived_at && <Fact label="ARCHIVED" value={formatDate(project.archived_at)} />}
      </dl>
    </section>
  );
}

// The GitHub repo is the standard project attribute (project.json
// `github.{owner,repo}`, flattened to `github_owner`/`github_repo` on the
// META row). Non-confidential — rendered as a deep link to the repo. When
// a project declares no repo (e.g. `self/*` personal projects) the row is
// omitted entirely rather than showing an empty cell. Edited via
// project.json + seed (Epic-010 §10), so this is read-only here.
function RepoFact({ owner, repo }: { owner?: string; repo?: string }) {
  if (!owner || !repo) return null;
  const slug = `${owner}/${repo}`;
  return (
    <div>
      <dt className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-0.5">
        GITHUB REPO
      </dt>
      <dd className="text-sm">
        <a
          href={`https://github.com/${owner}/${repo}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-wf-primary hover:underline"
        >
          {slug}
        </a>
      </dd>
    </div>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-0.5">
        {label}
      </dt>
      <dd className={`text-sm text-wf-on-surface ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

function ExecutionHistoryPanel({ executions }: { executions: ProjectExecution[] | null }) {
  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3 flex items-center justify-between">
        <Typeplate
          label="EXECUTIONS"
          value={executions ? `LAST ${executions.length} ROWS` : '—'}
        />
        <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
          when · agent · skill · result
        </span>
      </div>
      {executions === null ? (
        <p className="px-4 py-4 font-wfmono text-xs text-wf-on-surface-variant">Loading…</p>
      ) : executions.length === 0 ? (
        <p className="px-4 py-4 text-sm text-wf-on-surface-variant leading-relaxed">
          No executions yet. EXEC rows appear here as agents run skills against this project.
        </p>
      ) : (
        <div className="p-4">
          {/* Same visual language as the agent page's ACTIVITY ledger —
              one timeline component across the console (2026-07-03). */}
          <ExecutionTimeline executions={executions} perspective="project" />
        </div>
      )}
    </section>
  );
}
