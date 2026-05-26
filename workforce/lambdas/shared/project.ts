// workforce/lambdas/shared/project.ts
//
// Project as first-class entity. Per Epic-010 (workforce/docs/epics/
// epic-010-project-trust-boundary.md), a Project owns three things:
//   - a typed credential bag         → getCredential()
//   - an append-only execution ledger → appendExecution() / listExecutions()
//   - membership                      → addMember() / removeMember() / members() / isMember()
// plus lifecycle helpers (create / archive / getProject).
//
// Story 1-A scope: types + helpers; nothing else in the workforce calls
// these yet. Story 1-B (#90 follow-up) wires the orchestrator + runner +
// seed-agents to use them (self auto-seed + TASK.project_id + dual-write).
//
// Naming convention: camelCase for all exported function names, matching
// the rest of workforce/lambdas/shared/. The Epic-010 prose uses
// snake_case for these (e.g. `Project.append_execution`) — that is
// illustrative; the binding rule is codebase consistency.
//
// Membership audit semantics: removeMember() is a SOFT delete (writes
// `revoked_at` on the MEMBER row) so the audit trail "was agent X a
// member of project Y on date Z" can be reconstructed. isMember() and
// members() filter on `revoked_at === undefined`.
//
// Trust-boundary asymmetry (intentional): appendExecution() gates on
// membership; listExecutions() does NOT — the helper layer doesn't
// know the caller's identity. Story 1-B's runner wires the read-gate.
// See JSDoc on listExecutions() below.
//
// Credential resolution (getCredential) uses preferred-path-with-
// scoped-legacy-fallback per Epic-010 §6. The catch is narrowed to
// ResourceNotFoundException so IAM / network / parse failures still
// surface (W-4 fail-loud). Story 2 (#91) adds the
// WfLegacyCredentialReads CloudWatch metric on the legacy-hit path.

import {
  conditionalPutItem,
  getItem,
  putItem,
  queryByGsi,
  queryBySkPrefix,
} from "./ddb.js";
import { getSecret } from "./secrets.js";
import type { AgentSlug } from "./agent.js";

// --- Branded ProjectId ---------------------------------------------------

/**
 * Branded string type — prevents arbitrary strings from being passed where
 * a validated project id is expected. Construct via `asProjectId()` or
 * `selfProjectId()`; the brand survives only when one of those was used.
 */
export type ProjectId = string & { readonly __projectId: unique symbol };

/**
 * Construct a `ProjectId` from a raw string. Rejects:
 *   - empty strings
 *   - strings containing DDB partition-key delimiters (`#` / `|`) that would
 *     collide with the row-shape conventions
 *
 * Throws on rejection (W-4 fail-loud).
 */
export function asProjectId(id: string): ProjectId {
  if (id.length === 0) {
    throw new Error("invalid project_id: empty string");
  }
  if (id.includes("#") || id.includes("|")) {
    throw new Error(`invalid project_id "${id}": must not contain '#' or '|'`);
  }
  return id as ProjectId;
}

/**
 * Reserved per-agent project id for personal artefacts (own observability,
 * notification webhooks, per-agent model API keys). One project row per
 * agent. Format: `self/{slug}`.
 */
export function selfProjectId(slug: AgentSlug): ProjectId {
  return `self/${slug}` as ProjectId;
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
  /** Set when removeMember() soft-deletes this membership. Audit-only;
   *  isMember() / members() exclude rows where this is set. */
  revoked_at?: string;
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

/**
 * Create a new project. Conditional on `attribute_not_exists(pk)` so a
 * race between two concurrent callers does not silently overwrite an
 * existing META row's `created_at`. Throws `ConditionalCheckFailedException`
 * (re-exported from `./ddb.js`) on collision — callers that want
 * idempotent "ensure-create" semantics should catch + ignore that
 * specific error and treat it as "another writer won."
 */
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
  await conditionalPutItem(row, "attribute_not_exists(pk)");
  return row;
}

export async function archive(projectId: ProjectId, now?: string): Promise<void> {
  const meta = await getItem<ProjectMetaRow>(projectPk(projectId), "META");
  if (!meta) throw new Error(`project "${projectId}" not found`);
  meta.status = "archived";
  meta.archived_at = now ?? new Date().toISOString();
  await putItem(meta);
}

/** Renamed from `get` (shadowed JS keyword in some IDE contexts). */
export async function getProject(projectId: ProjectId): Promise<ProjectMetaRow | undefined> {
  return getItem<ProjectMetaRow>(projectPk(projectId), "META");
}

// --- Membership ----------------------------------------------------------

/**
 * Add an agent as a member of a project.
 *
 * Throws if the project does not exist (symmetric with archive(); avoids
 * stray MEMBER#* rows with no parent META).
 *
 * Audit-preserving semantics (Story 1-B / PR #111 review):
 *   - If the agent is already an ACTIVE member (row exists and
 *     `revoked_at` is undefined) → no-op. `joined_at` is preserved.
 *     This means the audit answer to "was X a member of Y on date Z"
 *     survives every redeploy / re-seed.
 *   - If the agent has a REVOKED membership row → write a fresh row
 *     with a new `joined_at` (starting a new membership tenure). The
 *     prior tenure's `joined_at` is lost; if full membership history
 *     is needed, a future MEMBER-AUDIT row family is the right place.
 *   - If no membership row exists → write a new one.
 */
export async function addMember(
  projectId: ProjectId,
  agentSlug: AgentSlug,
  now?: string,
): Promise<void> {
  const meta = await getItem<ProjectMetaRow>(projectPk(projectId), "META");
  if (!meta) throw new Error(`project "${projectId}" not found — call create() first`);
  const existing = await getItem<ProjectMemberRow>(
    projectPk(projectId),
    `MEMBER#${agentSlug}`,
  );
  if (existing && existing.revoked_at === undefined) {
    return; // already active — preserve joined_at
  }
  const row: ProjectMemberRow = {
    pk: projectPk(projectId),
    sk: `MEMBER#${agentSlug}`,
    project_id: projectId,
    agent_slug: agentSlug,
    joined_at: now ?? new Date().toISOString(),
  };
  await putItem(row);
}

/**
 * Soft-delete a membership. Writes `revoked_at` on the MEMBER row rather
 * than deleting it, so the audit question "was X a member of Y on date Z"
 * remains answerable. No-op if the agent was never a member.
 */
export async function removeMember(
  projectId: ProjectId,
  agentSlug: AgentSlug,
  now?: string,
): Promise<void> {
  const row = await getItem<ProjectMemberRow>(projectPk(projectId), `MEMBER#${agentSlug}`);
  if (!row) return;
  row.revoked_at = now ?? new Date().toISOString();
  await putItem(row);
}

/** Active members (excludes soft-deleted rows). */
export async function members(projectId: ProjectId): Promise<AgentSlug[]> {
  const rows = await queryBySkPrefix<ProjectMemberRow>(projectPk(projectId), "MEMBER#", 100);
  return rows.filter((r) => r.revoked_at === undefined).map((r) => r.agent_slug);
}

/** True iff the agent has an active (non-revoked) membership row. */
export async function isMember(projectId: ProjectId, agentSlug: AgentSlug): Promise<boolean> {
  const row = await getItem<ProjectMemberRow>(projectPk(projectId), `MEMBER#${agentSlug}`);
  return row !== undefined && row.revoked_at === undefined;
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

/**
 * Append one execution row to a project's ledger. Cross-project denial
 * is enforced at the helper layer: the agent MUST be an active member
 * (non-revoked) or this throws.
 *
 * Note: archive does NOT close the ledger — appendExecution against an
 * archived project succeeds if the agent is still a member. If
 * "archive closes the ledger" semantics are wanted later, gate here on
 * `meta.status === "active"`.
 */
export async function appendExecution(input: AppendExecutionInput): Promise<ExecutionRow> {
  if (!(await isMember(input.project_id, input.agent_slug))) {
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

// Filter discriminator: exactly one of {agent_slug, skill_name, project_id}
// must be set. `?: never` on the inactive fields makes mixing them a
// compile error rather than a runtime throw. Runtime throw stays as
// defence-in-depth for callers that bypass typing.
type AgentScope = { agent_slug: AgentSlug; skill_name?: never; project_id?: never };
type SkillScope = { agent_slug?: never; skill_name: string; project_id?: never };
type ProjScope = { agent_slug?: never; skill_name?: never; project_id: ProjectId };
type CommonOpts = {
  /** Inclusive lower bound on started_at (ISO-8601). */
  from?: string;
  /** Inclusive upper bound on started_at. */
  to?: string;
  /** Filter by status (post-query, not part of the index range). */
  status?: ExecStatus;
  /** Page size. Default 100. */
  limit?: number;
};

export type ListExecutionsFilter = (AgentScope | SkillScope | ProjScope) & CommonOpts;

/**
 * Return execution rows matching the filter.
 *
 * **Trust-boundary asymmetry (intentional)**: `appendExecution` gates on
 * project membership; `listExecutions` does NOT. The helper layer does
 * not know the caller's identity context. Story 1-B wires the runner to
 * assert membership before invoking this — that is where the read-gate
 * lives in the production flow. Callers outside the runner must do the
 * same check.
 *
 * Range push-down: both `from` and `to` are passed to DDB as
 * `skGte` / `skLte` constraints when scoping by agent_slug / skill_name.
 * Half-bounded ranges (only `from` or only `to`) work; full-partition
 * (neither bound) also works.
 */
export async function listExecutions(filter: ListExecutionsFilter): Promise<ExecutionRow[]> {
  const limit = filter.limit ?? 100;
  let rows: ExecutionRow[];

  if (filter.agent_slug) {
    rows = await queryByGsi<ExecutionRow>("GSI1", `AGENT#${filter.agent_slug}`, {
      skGte: filter.from,
      skLte: filter.to,
      limit,
    });
  } else if (filter.skill_name) {
    rows = await queryByGsi<ExecutionRow>("GSI2", `SKILL#${filter.skill_name}`, {
      skGte: filter.from,
      skLte: filter.to,
      limit,
    });
  } else if (filter.project_id) {
    // Project-partition path; range is post-filtered (no SK push-down).
    rows = await queryBySkPrefix<ExecutionRow>(projectPk(filter.project_id), "EXEC#", limit);
  } else {
    // Defence-in-depth: discriminated union should make this unreachable
    // at the type layer, but bypassed callers (e.g. JS interop, `as any`)
    // still get a loud failure.
    throw new Error(
      "listExecutions requires at least one of {agent_slug, skill_name, project_id}",
    );
  }

  // status + range post-filter. Status is never part of the index;
  // the range filter is a no-op on the GSI paths (DDB already pushed
  // down) and load-bearing on the project_id path.
  return rows.filter((r) => {
    if (filter.status && r.status !== filter.status) return false;
    if (filter.from && r.started_at < filter.from) return false;
    if (filter.to && r.started_at > filter.to) return false;
    return true;
  });
}

// --- Credentials ---------------------------------------------------------

/**
 * Resolve a credential by (project_id, credential_type).
 *
 * Tries `wf/projects/{id}/{type}` first; falls back to the legacy bare
 * path `wf/{type}` ONLY when the project-scoped path returns
 * `ResourceNotFoundException`. Other failures (IAM denial, throttle,
 * network, JSON parse) re-throw so they surface loudly per W-4.
 *
 * The legacy-hit path logs a structured `legacy_credential_read` event
 * so Story 2 (#91) can land its `WfLegacyCredentialReads` CloudWatch
 * metric on a clean signal.
 *
 * Type parameter `T` has no default — callers MUST specify the expected
 * secret shape (e.g. `getCredential<GithubSecret>(...)`) so wrong-shape
 * access is a compile error, not a runtime surprise. A `CredentialMap`
 * registry that keys T off `credentialType` lives in Story 2 (#91).
 */
export async function getCredential<T>(
  projectId: ProjectId,
  credentialType: string,
): Promise<T> {
  try {
    return await getSecret<T>(`wf/projects/${projectId}/${credentialType}`);
  } catch (err) {
    if (err instanceof Error && err.name === "ResourceNotFoundException") {
      console.warn(
        JSON.stringify({
          event: "legacy_credential_read",
          project_id: projectId,
          credential_type: credentialType,
        }),
      );
      return await getSecret<T>(`wf/${credentialType}`);
    }
    throw err;
  }
}
