// workforce/lambdas/shared/project.ts
//
// Project as first-class entity. Per Epic-010 (workforce/docs/epics/
// epic-010-project-trust-boundary.md), a Project owns three things:
//   - a typed credential bag         → get_credential()
//   - an append-only execution ledger → append_execution() / list_executions()
//   - membership                      → add_member() / remove_member() / members() / is_member()
// plus lifecycle helpers (create / archive / get).
//
// Story 1-A scope: types + helpers; nothing else in the workforce calls
// these yet. Story 1-B (#90 follow-up) wires the orchestrator + runner +
// seed-agents to use them (self auto-seed + TASK.project_id + dual-write).
//
// Cross-project denial: append_execution() asserts the agent is a member
// of the named project before writing. This is the only authorization
// gate today; IAM-level enforcement (S3 prefix lock-down) lands in
// Story 3 (#92).
//
// Credential resolution (get_credential) uses the preferred-path-with-
// legacy-fallback pattern from Epic-010 §6. Story 2 (#91) tightens this:
// adds CloudWatch metric `WfLegacyCredentialReads`, removes the bare
// `wf/{type}` fallback at the end of the deprecation window.

import { deleteItem, getItem, putItem, queryByGsi, queryBySkPrefix } from "./ddb.js";
import { getSecret } from "./secrets.js";
import type { AgentSlug } from "./agent.js";

export type ProjectId = string;

/** Reserved per-agent project ID for personal artefacts (own observability,
 *  notification webhooks, per-agent model API keys). One project row per agent. */
export function selfProjectId(slug: AgentSlug): ProjectId {
  return `self/${slug}`;
}

export function projectPk(id: ProjectId): `PROJECT#${string}` {
  return `PROJECT#${id}`;
}

// --- Row shapes ----------------------------------------------------------

export interface ProjectMetaRow {
  pk: `PROJECT#${string}`;
  sk: "META";
  project_id: ProjectId;
  status: "active" | "archived";
  owner_agent: AgentSlug | "_operator";
  created_at: string;
  archived_at?: string;
}

export interface ProjectMemberRow {
  pk: `PROJECT#${string}`;
  sk: `MEMBER#${string}`;
  project_id: ProjectId;
  agent_slug: AgentSlug;
  joined_at: string;
}

export interface ArtifactRef {
  uri: string;
  content_hash: string;
  content_type: string;
  size_bytes: number;
  /** ≤512-char inline preview. Full body fetched from S3 on demand. */
  summary: string;
}

export type ExecStatus = "ok" | "throw" | "skipped";

export interface ExecutionRow {
  pk: `PROJECT#${string}`;
  sk: `EXEC#${string}`;
  project_id: ProjectId;
  agent_slug: AgentSlug;
  skill_name: string;
  skill_version: string;
  started_at: string;
  ended_at: string;
  status: ExecStatus;
  used_credential_types: string[];
  inputs_hash?: string;
  artifact_ref?: ArtifactRef;
  error?: string;
  /** GSI1: agent-scoped recall — "what did Ren do, across all projects". */
  gsi1pk: `AGENT#${string}`;
  gsi1sk: string;
  /** GSI2: skill-utilisation — "how often is article-draft fired, across all agents". */
  gsi2pk: `SKILL#${string}`;
  gsi2sk: string;
}

// --- Lifecycle -----------------------------------------------------------

export async function create(input: {
  project_id: ProjectId;
  owner_agent: AgentSlug | "_operator";
  now?: string;
}): Promise<ProjectMetaRow> {
  const now = input.now ?? new Date().toISOString();
  const row: ProjectMetaRow = {
    pk: projectPk(input.project_id),
    sk: "META",
    project_id: input.project_id,
    status: "active",
    owner_agent: input.owner_agent,
    created_at: now,
  };
  await putItem(row);
  return row;
}

export async function archive(projectId: ProjectId, now?: string): Promise<void> {
  const meta = await getItem<ProjectMetaRow>(projectPk(projectId), "META");
  if (!meta) throw new Error(`project "${projectId}" not found`);
  meta.status = "archived";
  meta.archived_at = now ?? new Date().toISOString();
  await putItem(meta);
}

export async function get(projectId: ProjectId): Promise<ProjectMetaRow | undefined> {
  return getItem<ProjectMetaRow>(projectPk(projectId), "META");
}

// --- Membership ----------------------------------------------------------

export async function add_member(
  projectId: ProjectId,
  agentSlug: AgentSlug,
  now?: string,
): Promise<void> {
  const row: ProjectMemberRow = {
    pk: projectPk(projectId),
    sk: `MEMBER#${agentSlug}`,
    project_id: projectId,
    agent_slug: agentSlug,
    joined_at: now ?? new Date().toISOString(),
  };
  await putItem(row);
}

export async function remove_member(projectId: ProjectId, agentSlug: AgentSlug): Promise<void> {
  await deleteItem(projectPk(projectId), `MEMBER#${agentSlug}`);
}

export async function members(projectId: ProjectId): Promise<AgentSlug[]> {
  const rows = await queryBySkPrefix<ProjectMemberRow>(projectPk(projectId), "MEMBER#", 100);
  return rows.map((r) => r.agent_slug);
}

export async function is_member(projectId: ProjectId, agentSlug: AgentSlug): Promise<boolean> {
  const row = await getItem<ProjectMemberRow>(projectPk(projectId), `MEMBER#${agentSlug}`);
  return row !== undefined;
}

// --- Execution ledger ----------------------------------------------------

export interface AppendExecutionInput {
  project_id: ProjectId;
  agent_slug: AgentSlug;
  exec_ulid: string;
  skill_name: string;
  skill_version: string;
  started_at: string;
  ended_at: string;
  status: ExecStatus;
  used_credential_types?: string[];
  inputs_hash?: string;
  artifact_ref?: ArtifactRef;
  error?: string;
}

/** Append one execution row to a project's ledger. Cross-project denial
 *  is enforced: the calling agent MUST already be a project member. */
export async function append_execution(input: AppendExecutionInput): Promise<ExecutionRow> {
  if (!(await is_member(input.project_id, input.agent_slug))) {
    throw new Error(
      `cross-project denial: agent "${input.agent_slug}" is not a member of project "${input.project_id}"`,
    );
  }
  const row: ExecutionRow = {
    pk: projectPk(input.project_id),
    sk: `EXEC#${input.exec_ulid}`,
    project_id: input.project_id,
    agent_slug: input.agent_slug,
    skill_name: input.skill_name,
    skill_version: input.skill_version,
    started_at: input.started_at,
    ended_at: input.ended_at,
    status: input.status,
    used_credential_types: input.used_credential_types ?? [],
    inputs_hash: input.inputs_hash,
    artifact_ref: input.artifact_ref,
    error: input.error,
    gsi1pk: `AGENT#${input.agent_slug}`,
    gsi1sk: input.started_at,
    gsi2pk: `SKILL#${input.skill_name}`,
    gsi2sk: input.started_at,
  };
  await putItem(row);
  return row;
}

export interface ListExecutionsFilter {
  /** When set, queries GSI1 (agent-scoped across all projects). */
  agent_slug?: AgentSlug;
  /** When set without agent_slug, queries GSI2 (skill-scoped across all projects). */
  skill_name?: string;
  /** When set without agent_slug / skill_name, queries the project's own partition. */
  project_id?: ProjectId;
  /** Inclusive lower bound on started_at (ISO-8601). */
  from?: string;
  /** Inclusive upper bound on started_at. */
  to?: string;
  /** Filter by status (post-query, not part of the index range). */
  status?: ExecStatus;
  /** Page size. Default 100. */
  limit?: number;
}

export async function list_executions(filter: ListExecutionsFilter): Promise<ExecutionRow[]> {
  const limit = filter.limit ?? 100;
  let rows: ExecutionRow[];

  if (filter.agent_slug) {
    rows = await queryByGsi<ExecutionRow>("GSI1", `AGENT#${filter.agent_slug}`, {
      skBetween: filter.from && filter.to ? [filter.from, filter.to] : undefined,
      limit,
    });
  } else if (filter.skill_name) {
    rows = await queryByGsi<ExecutionRow>("GSI2", `SKILL#${filter.skill_name}`, {
      skBetween: filter.from && filter.to ? [filter.from, filter.to] : undefined,
      limit,
    });
  } else if (filter.project_id) {
    rows = await queryBySkPrefix<ExecutionRow>(projectPk(filter.project_id), "EXEC#", limit);
  } else {
    throw new Error(
      "list_executions requires at least one of {agent_slug, skill_name, project_id}",
    );
  }

  // Status / range post-filter (covers the project_id partition path that
  // does not push the range down to DDB; harmless on the GSI paths too).
  return rows.filter((r) => {
    if (filter.status && r.status !== filter.status) return false;
    if (filter.from && r.started_at < filter.from) return false;
    if (filter.to && r.started_at > filter.to) return false;
    return true;
  });
}

// --- Credentials ---------------------------------------------------------

/**
 * Resolve a credential by (project_id, credential_type). Tries the
 * project-scoped path first (`wf/projects/{id}/{type}`) and falls back
 * to the legacy bare path (`wf/{type}`) on miss. The fallback exists for
 * the Story 2 (#91) deprecation window — Story 2 will add a CloudWatch
 * metric here and remove the bare-path fallback once the metric graphs
 * to zero.
 */
export async function get_credential<T = unknown>(
  projectId: ProjectId,
  credentialType: string,
): Promise<T> {
  try {
    return await getSecret<T>(`wf/projects/${projectId}/${credentialType}`);
  } catch {
    return await getSecret<T>(`wf/${credentialType}`);
  }
}
