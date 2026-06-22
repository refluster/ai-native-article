// /workforce/projects/:slug — project profile in the workforce console
// language. Hero with id + status + owner, KPI strip, members panel, and
// execution-history table.
//
// Two deferred slices, each named here as a follow-up (not shipped in
// this PR per the Story 6 vertical-slice scoping):
//
//   - Member editor (add/remove agents): the data shape is already
//     supported by workforce/lambdas/shared/project.ts; the API write
//     endpoint (POST /projects/{id}/members) needs wiring + Cognito-to-
//     SigV4 brokering at the SPA edge. Surfaced today as read-only.
//   - Task-editor `project_id` selector: lives on the agent profile /
//     task editor, not this page; out of scope here.
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
import StatusBadge from '../components/StatusBadge';
import ProjectArchiveButton from '../components/ProjectArchiveButton';
import CredentialVault from '../components/CredentialVault';
import {
  apiConfigured,
  fetchProject,
  fetchProjectExecutions,
  fetchProjectMembers,
} from '../lib/projects';
import type {
  ProjectDetail,
  ProjectExecution,
  ProjectMember,
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
  // mock fixture key on the decoded form.
  const projectId = (() => {
    try {
      return decodeURIComponent(rawId);
    } catch {
      return rawId;
    }
  })();

  const [project, setProject] = useState<ProjectDetail | null | undefined>(undefined);
  const [members, setMembers] = useState<ProjectMember[] | null>(null);
  const [executions, setExecutions] = useState<ProjectExecution[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    Promise.all([
      fetchProject(projectId),
      fetchProjectMembers(projectId).catch(() => [] as ProjectMember[]),
      fetchProjectExecutions(projectId, 50).catch(() => [] as ProjectExecution[]),
    ])
      .then(([p, m, x]) => {
        if (cancelled) return;
        setProject(p ?? null);
        setMembers(m);
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

  const activeMembers = (members ?? []).filter((m) => !m.revoked_at);
  const okExecs = (executions ?? []).filter((e) => e.status === 'ok').length;
  const errExecs = (executions ?? []).filter((e) => e.status === 'throw').length;

  const kpis = [
    { cap: 'MEMBERS',     value: members ? String(activeMembers.length) : '—',          sub: 'active' },
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
        <h1 className="font-headline text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter leading-[1.04] text-wf-on-surface mb-1 font-mono">
          {project.project_id}
        </h1>
        <p className="font-wfmono text-xs sm:text-sm uppercase tracking-[0.12em] text-wf-on-surface-variant">
          owner · {project.owner_agent} · created {formatDate(project.created_at)}
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

      {/* TWO COLUMN: main / sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6 sm:space-y-8">
          <OverviewPanel project={project} memberCount={activeMembers.length} />

          <ExecutionHistoryPanel executions={executions} />
        </div>

        <aside className="lg:col-span-1 space-y-6">
          <MembersPanel members={activeMembers} loading={members === null} />
          <CredentialVault projectId={project.project_id} />
        </aside>
      </div>
    </WorkforceLayout>
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

function OverviewPanel({
  project,
  memberCount,
}: {
  project: ProjectDetail;
  memberCount: number;
}) {
  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3">
        <Typeplate label="DECK · OVERVIEW" value="META · OWNER · ACTIVITY" />
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 p-4 text-sm">
        <Fact label="PROJECT_ID" value={project.project_id} mono />
        {project.name && <Fact label="NAME" value={project.name} />}
        <Fact label="STATUS" value={project.status} />
        <Fact label="OWNER" value={project.owner_agent} />
        <RepoFact owner={project.github_owner} repo={project.github_repo} />
        <Fact label="CREATED" value={formatDate(project.created_at)} />
        <Fact label="MEMBERS" value={String(memberCount)} />
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

function MembersPanel({
  members,
  loading,
}: {
  members: ProjectMember[];
  loading: boolean;
}) {
  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3 flex items-center justify-between">
        <Typeplate label="DECK · MEMBERS" value={`${members.length} ACTIVE`} />
        <span
          className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant"
          title="Add / remove agents — Story 6 follow-up slice"
        >
          READ-ONLY · v1
        </span>
      </div>
      {loading ? (
        <p className="px-4 py-4 font-wfmono text-xs text-wf-on-surface-variant">Loading…</p>
      ) : members.length === 0 ? (
        <p className="px-4 py-4 text-sm text-wf-on-surface-variant leading-relaxed">
          No active members. Add an agent via{' '}
          <code className="font-wfmono text-xs">
            workforce/projects/{'{id}'}/members.json
          </code>{' '}
          (seed) or wait for the in-app editor (follow-up slice).
        </p>
      ) : (
        <ul className="divide-y divide-wf-outline-variant">
          {members.map((m) => (
            <li key={m.agent_slug} className="px-4 py-3 flex items-baseline justify-between gap-3">
              <Link
                to={`/agents/${m.agent_slug}`}
                className="font-wfmono text-xs text-wf-on-surface hover:text-wf-primary truncate"
              >
                {m.agent_slug}
              </Link>
              <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
                joined {formatDate(m.joined_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ExecutionHistoryPanel({ executions }: { executions: ProjectExecution[] | null }) {
  return (
    <section className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md">
      <div className="border-b border-wf-outline-variant px-4 py-3 flex items-center justify-between">
        <Typeplate
          label="DECK · EXECUTIONS"
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
          No executions yet. EXEC rows appear here as members run skills against this project.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-wf-outline-variant">
                <th className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant text-left px-4 py-2 whitespace-nowrap">
                  WHEN
                </th>
                <th className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant text-left px-2 py-2">
                  AGENT
                </th>
                <th className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant text-left px-2 py-2">
                  SKILL
                </th>
                <th className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant text-left px-2 py-2">
                  STATUS
                </th>
                <th className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant text-left px-4 py-2">
                  ARTIFACT
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-wf-outline-variant">
              {executions.map((e) => (
                <tr key={e.exec_ulid} className="hover:bg-wf-surface-container/40">
                  <td className="font-wfmono text-xs text-wf-on-surface-variant px-4 py-2 whitespace-nowrap">
                    <div className="text-wf-on-surface">{e.started_at.slice(0, 10)}</div>
                    <div className="text-[10px]">
                      {e.started_at.slice(11, 16)} · {formatRelative(e.started_at)}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <Link
                      to={`/agents/${e.agent_slug}`}
                      className="font-wfmono text-xs text-wf-on-surface hover:text-wf-primary"
                    >
                      {e.agent_slug}
                    </Link>
                  </td>
                  <td className="px-2 py-2">
                    <Link
                      to={`/skills/${e.skill_name}`}
                      className="font-wfmono text-xs text-wf-on-surface hover:text-wf-primary"
                    >
                      {e.skill_name}
                    </Link>
                    <div className="font-wfmono text-[10px] text-wf-on-surface-variant">
                      v{e.skill_version}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <StatusBadge status={e.status} error={e.error} />
                  </td>
                  <td className="px-4 py-2 text-sm">
                    {e.summary ? (
                      <span
                        className="font-wfmono text-xs text-wf-on-surface-variant"
                        title={e.artifact_ref?.uri}
                      >
                        {e.summary.slice(0, 60)}
                      </span>
                    ) : e.artifact_ref ? (
                      <span
                        className="font-wfmono text-xs text-wf-on-surface-variant"
                        title={e.artifact_ref.uri}
                      >
                        {e.artifact_ref.summary?.slice(0, 60) ?? e.artifact_ref.content_type}
                      </span>
                    ) : e.error ? (
                      <span className="text-xs text-wf-tertiary italic">{e.error.slice(0, 80)}</span>
                    ) : (
                      <span className="font-wfmono text-[10px] text-wf-on-surface-variant">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
