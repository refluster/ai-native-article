// Client-side helpers for the workforce projects API.
//   - fetch lists / single rows from wf-agents-api (live)
//   - fall back to /workforce-projects-mock.json when the API isn't wired
//     (epic-010 §200 — "SPA falls back to a static mock until Story 1-B's
//     dual-write is on")
//
// Project ids may contain `/` (e.g. `self/ren`). Every id placed in a URL
// path goes through encodeProjectId() which percent-encodes the slash so
// the API Gateway router treats the whole id as one path parameter.

import { WORKFORCE_AGENTS_API_BASE } from '../config/api';
import { withBasePath } from './paths';
import type {
  AgentMembership,
  ProjectDetail,
  ProjectExecution,
  ProjectMember,
  ProjectSummary,
  WorkforceProjectsMock,
} from '../types/project';

export const apiConfigured = (): boolean => WORKFORCE_AGENTS_API_BASE.length > 0;

/** Encode a project id for use in a URL path. */
export function encodeProjectId(id: string): string {
  return encodeURIComponent(id);
}

let mockCache: Promise<WorkforceProjectsMock> | null = null;

/**
 * Load the static fallback mock. Used on gh-pages (no live API) and in
 * `npm run dev` when WORKFORCE_AGENTS_API_BASE is unset. The shape
 * matches the live response per type — every page degrades cleanly to
 * mock data when the live call fails.
 */
export function loadProjectsMock(): Promise<WorkforceProjectsMock> {
  if (!mockCache) {
    mockCache = fetch(withBasePath('/workforce-projects-mock.json'))
      .then((res) => {
        if (!res.ok) throw new Error(`failed to load workforce-projects-mock.json (${res.status})`);
        return res.json() as Promise<WorkforceProjectsMock>;
      })
      .catch((err) => {
        mockCache = null;
        throw err;
      });
  }
  return mockCache;
}

// ----- Live API client -----

interface ListProjectsOpts {
  includeSelf?: boolean;
  status?: 'active' | 'archived';
  owner?: string;
}

export async function fetchProjects(opts: ListProjectsOpts = {}): Promise<ProjectSummary[]> {
  if (!apiConfigured()) {
    const mock = await loadProjectsMock();
    return mock.projects
      .filter((p) => opts.includeSelf || !p.project_id.startsWith('self/'))
      .filter((p) => !opts.status || p.status === opts.status)
      .filter((p) => !opts.owner || p.owner_agent === opts.owner);
  }
  // listProjects backs `GET /projects` with a DDB Scan + FilterExpression.
  // DDB's `Limit` is applied BEFORE the filter, so when the table is
  // dominated by `RUN#` / `EXEC#` rows (every prod table is) a single page
  // often holds zero or one PROJECT META row even though many exist.
  // We loop on `next_cursor` until the API stops handing one back.
  // Hard cap prevents an unbounded loop if the backend regresses; the
  // single-operator scale guarantees the real page count stays small.
  const PAGE_CAP = 50;
  const qs = new URLSearchParams();
  if (opts.includeSelf) qs.set('include_self', 'true');
  if (opts.status) qs.set('status', opts.status);
  if (opts.owner) qs.set('owner', opts.owner);
  const items: ProjectSummary[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < PAGE_CAP; i++) {
    if (cursor) qs.set('cursor', cursor); else qs.delete('cursor');
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const res = await fetch(`${WORKFORCE_AGENTS_API_BASE}/projects${suffix}`);
    if (!res.ok) throw new Error(`agents-api ${res.status}`);
    const data = (await res.json()) as { items: ProjectSummary[]; next_cursor?: string };
    items.push(...data.items);
    if (!data.next_cursor) return items;
    cursor = data.next_cursor;
  }
  return items;
}

export async function fetchProject(projectId: string): Promise<ProjectDetail | undefined> {
  if (!apiConfigured()) {
    const mock = await loadProjectsMock();
    return mock.projects.find((p) => p.project_id === projectId);
  }
  const res = await fetch(`${WORKFORCE_AGENTS_API_BASE}/projects/${encodeProjectId(projectId)}`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`agents-api ${res.status}`);
  return (await res.json()) as ProjectDetail;
}

export async function fetchProjectMembers(
  projectId: string,
  includeRevoked = false,
): Promise<ProjectMember[]> {
  if (!apiConfigured()) {
    const mock = await loadProjectsMock();
    const rows = mock.members[projectId] ?? [];
    return includeRevoked ? rows : rows.filter((m) => !m.revoked_at);
  }
  const qs = includeRevoked ? '?include_revoked=true' : '';
  const res = await fetch(
    `${WORKFORCE_AGENTS_API_BASE}/projects/${encodeProjectId(projectId)}/members${qs}`,
  );
  if (!res.ok) throw new Error(`agents-api ${res.status}`);
  const data = (await res.json()) as { items: ProjectMember[] };
  return data.items;
}

export async function fetchProjectExecutions(
  projectId: string,
  limit = 25,
): Promise<ProjectExecution[]> {
  if (!apiConfigured()) {
    const mock = await loadProjectsMock();
    return (mock.executions[projectId] ?? []).slice(0, limit);
  }
  const res = await fetch(
    `${WORKFORCE_AGENTS_API_BASE}/projects/${encodeProjectId(projectId)}/executions?limit=${limit}`,
  );
  if (!res.ok) throw new Error(`agents-api ${res.status}`);
  const data = (await res.json()) as { items: ProjectExecution[] };
  return data.items;
}

export async function fetchAgentMemberships(slug: string): Promise<AgentMembership[]> {
  if (!apiConfigured()) {
    const mock = await loadProjectsMock();
    return mock.agent_memberships[slug] ?? [];
  }
  const res = await fetch(
    `${WORKFORCE_AGENTS_API_BASE}/agents/${encodeURIComponent(slug)}/projects`,
  );
  if (!res.ok) throw new Error(`agents-api ${res.status}`);
  const data = (await res.json()) as { items: AgentMembership[] };
  return data.items;
}

// ─── Project archive / unarchive — Project CRUD UI (PR-δ) ───────────────
//
// PATCH /projects/{id+} (AWS_IAM auth). Body shape: { status: 'active' | 'archived' }.
// Returns the updated project view. Uses signedFetch from lib/sigv4 — the
// agents-api PATCH route is AWS_IAM-protected per agents-api SAM events
// table; the SigV4 broker (cognito identity pool + operator role) was
// provisioned by the earlier sigv4 PR.

import { signedFetch, assertSigv4Configured } from './sigv4';

export type ProjectStatus = 'active' | 'archived';

export async function patchProjectStatus(
  projectId: string,
  status: ProjectStatus,
  agentsApiBase: string = WORKFORCE_AGENTS_API_BASE,
): Promise<ProjectDetail> {
  assertSigv4Configured();
  const url = `${agentsApiBase}/projects/${encodeProjectId(projectId)}`;
  const res = await signedFetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    let bodyText = '';
    try {
      bodyText = await res.text();
    } catch {
      // ignore
    }
    throw new Error(`PATCH /projects failed (${res.status}): ${bodyText}`);
  }
  return (await res.json()) as ProjectDetail;
}
