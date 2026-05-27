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
  const qs = new URLSearchParams();
  if (opts.includeSelf) qs.set('include_self', 'true');
  if (opts.status) qs.set('status', opts.status);
  if (opts.owner) qs.set('owner', opts.owner);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await fetch(`${WORKFORCE_AGENTS_API_BASE}/projects${suffix}`);
  if (!res.ok) throw new Error(`agents-api ${res.status}`);
  const data = (await res.json()) as { items: ProjectSummary[] };
  return data.items;
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
