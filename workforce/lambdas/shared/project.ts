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
// surface (W-4 fail-loud).
//
// Story 2-B (#91) extended the fallback into THREE tiers and added the
// WfLegacyCredentialReads CloudWatch metric:
//   1. wf/projects/{id}/{type}            — canonical, post-migration
//   2. wf/projects/_default/{type}        — shared fallback for keys
//                                            the project hasn't shadowed
//                                            (populated by the migrate-
//                                            credentials Lambda)
//   3. wf/{type}                          — legacy bare path; pre-Epic-010
//                                            deployment artefact, kept
//                                            until WfLegacyCredentialReads
//                                            graphs to zero
// Each fallback hit emits a metric with `Reason=fallback_default` or
// `fallback_bare`; the operator graphs the bare reason to zero before
// deleting the bare keys.

import {
  CloudWatchClient,
  PutMetricDataCommand,
} from "@aws-sdk/client-cloudwatch";
import {
  conditionalPutItem,
  getItem,
  putItem,
  queryByGsi,
  queryBySkPrefix,
} from "./ddb.js";
import { getSecret } from "./secrets.js";
import type { AgentSlug } from "./agent.js";

const STAGE = process.env.STAGE ?? "dev";
// One client per cold start. Metric emission is best-effort — failures
// log but do NOT block the credential read (W-4 is preserved at the
// read level: a missing credential still throws loudly).
const cwForCreds = new CloudWatchClient({});

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

/**
 * Status of the embedding sidecar attached to an EXEC row (Story 4 / #93).
 *
 * - `ok`      — `embedding_bytes`, `embedding_model_id`, `embedding_dim`
 *               are all present and the vector is L2-normalised float32.
 * - `pending` — the embedding API call failed (or `voyage.api_key` was
 *               not yet provisioned); the execution itself succeeded
 *               and the row was written WITHOUT the three embedding
 *               attributes so a retry sweep can backfill later.
 * - `skipped` — the caller intentionally opted out of embedding (e.g.
 *               a deterministic skill whose summary is the empty string
 *               — embedding the empty string costs ~10 tokens for zero
 *               recall signal).
 *
 * Rows missing `embedding_status` entirely are pre-Story-4 ledger rows.
 * The recall path treats both `pending` / `skipped` / missing-attribute
 * identically: EXCLUDED from semantic-recall candidates, still visible
 * via structured recall (W-4 — don't silently hide ledger rows from the
 * audit view because one optional sidecar attribute is missing).
 */
export type EmbeddingStatus = "ok" | "pending" | "skipped";

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

  // ── Embedding sidecar (Story 4 / #93) ────────────────────────────────
  //
  // Stored only when `embedding_status === 'ok'`. The recall path filters
  // semantic candidates on the truthiness of `embedding_bytes`, NOT on
  // `embedding_status`, so pre-Story-4 rows (no status attribute) are
  // silently treated as `pending` for semantic purposes.

  /** L2-normalised float32 vector, little-endian, encoded by
   *  `shared/embedding.ts:encodeEmbeddingBytes`. The AWS DocumentClient
   *  marshals Uint8Array ↔ DDB `B` attribute transparently. */
  embedding_bytes?: Uint8Array;
  /** Model id used to compute the embedding (e.g. `voyage-3-lite`). Stored
   *  per Epic-010 Open Q3 so re-embedding on a model change is a query,
   *  not a guess. */
  embedding_model_id?: string;
  /** Vector dimensionality. Stored explicitly so the kNN code can fail
   *  loud on dim drift instead of producing silent garbage. */
  embedding_dim?: number;
  /** See `EmbeddingStatus` doc. */
  embedding_status?: EmbeddingStatus;
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
  // ── Embedding sidecar (Story 4 / #93) ──────────────────────────────
  // All three must be present together, or all three must be absent.
  // `embedding_status` controls how the row is treated by the recall
  // path; see EmbeddingStatus doc.
  embedding_bytes?: Uint8Array;
  embedding_model_id?: string;
  embedding_dim?: number;
  embedding_status?: EmbeddingStatus;
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
 *
 * Story 4 (#93): the embedding sidecar (`embedding_bytes` +
 * `embedding_model_id` + `embedding_dim` + `embedding_status`) is optional
 * and validated as a co-set: either all four are present (ok-status) or
 * none of the byte/model/dim are present (status is `pending` / `skipped`
 * / absent). Mixed states throw — they would silently corrupt the recall
 * index. The high-level "compute embedding then append" wrapper lives in
 * `shared/exec-embedding.ts`; callers that already have a vector in hand
 * (the retry path, tests) call `appendExecution` directly.
 */
export async function appendExecution(input: AppendExecutionInput): Promise<ExecutionRow> {
  if (!(await isMember(input.project_id, input.agent_slug))) {
    throw new Error(
      `cross-project denial: agent "${input.agent_slug}" is not a member of project "${input.project_id}"`,
    );
  }

  // Validate the embedding-sidecar co-set. The three byte/model/dim
  // fields MUST be all-present or all-absent; `embedding_status='ok'`
  // requires all three to be present.
  const hasBytes = input.embedding_bytes !== undefined;
  const hasModel = input.embedding_model_id !== undefined;
  const hasDim = input.embedding_dim !== undefined;
  if (hasBytes !== hasModel || hasModel !== hasDim) {
    throw new Error(
      `appendExecution: embedding_{bytes,model_id,dim} must be all-present or all-absent ` +
        `(got bytes=${hasBytes}, model=${hasModel}, dim=${hasDim})`,
    );
  }
  if (input.embedding_status === "ok" && !hasBytes) {
    throw new Error(
      "appendExecution: embedding_status='ok' requires embedding_bytes / embedding_model_id / embedding_dim",
    );
  }
  if (hasBytes && input.embedding_status !== "ok") {
    throw new Error(
      `appendExecution: embedding_bytes provided but embedding_status="${input.embedding_status}" ` +
        `(expected 'ok' when bytes are present)`,
    );
  }
  if (hasDim && input.embedding_bytes!.byteLength !== input.embedding_dim! * 4) {
    throw new Error(
      `appendExecution: embedding_bytes byteLength=${input.embedding_bytes!.byteLength} ` +
        `does not match embedding_dim=${input.embedding_dim} (expected ${input.embedding_dim! * 4})`,
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
    embedding_bytes: input.embedding_bytes,
    embedding_model_id: input.embedding_model_id,
    embedding_dim: input.embedding_dim,
    embedding_status: input.embedding_status,
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
  /**
   * Caller identity for the recall trust-boundary read-gate (Story 4 / #93).
   *
   * When set, `listExecutions` post-filters out any row whose `project_id`
   * the named agent is not an active member of. This is the read-side of
   * the cross-project denial that `appendExecution` enforces at write
   * time. It is OPTIONAL because:
   *
   *   - Pre-Story-4 callers (the agents-api, the agent-runner's own
   *     dual-write tests) already assert membership at a higher seam and
   *     would double-charge the check.
   *   - Cross-project queries from `_operator` are valid (the operator
   *     sees everything by design) — passing the caller as `_operator`
   *     short-circuits the gate.
   *
   * Story 4's `agent.recall()` ALWAYS sets this (defence in depth — the
   * surface is reachable from agent-as-actor code paths that may
   * eventually run with reduced trust). See `shared/recall.ts`.
   */
  caller_agent_slug?: AgentSlug | "_operator";
};

export type ListExecutionsFilter = (AgentScope | SkillScope | ProjScope) & CommonOpts;

/**
 * Return execution rows matching the filter.
 *
 * **Trust-boundary asymmetry (intentional, then tightened by Story 4)**:
 * `appendExecution` gates on project membership; `listExecutions`
 * historically does NOT — the helper layer does not always know the
 * caller's identity context. Story 1-B wired the runner to assert
 * membership before invoking this. Story 4 (#93) ADDS an optional
 * `caller_agent_slug` field (see `CommonOpts.caller_agent_slug` doc) so
 * the recall surface can defence-in-depth the read-gate here even when
 * the higher-layer check is forgotten. Callers that don't pass it get
 * the same (un-gated) behaviour as before — non-breaking.
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
  const prefiltered = rows.filter((r) => {
    if (filter.status && r.status !== filter.status) return false;
    if (filter.from && r.started_at < filter.from) return false;
    if (filter.to && r.started_at > filter.to) return false;
    return true;
  });

  // Story 4 (#93) recall trust-boundary read-gate. Only applied when the
  // caller explicitly opts in via `caller_agent_slug`. `_operator` sees
  // everything; named agents see only rows from projects they are an
  // active member of. The membership check is per-distinct-project_id
  // (Set dedup) so a partition of 10k EXEC rows across 3 projects only
  // costs 3 isMember() reads, not 10k.
  const caller = filter.caller_agent_slug;
  if (caller === undefined || caller === "_operator") {
    return prefiltered;
  }
  const distinctProjects = new Set<ProjectId>(prefiltered.map((r) => r.project_id));
  const membershipByProject = new Map<ProjectId, boolean>();
  await Promise.all(
    [...distinctProjects].map(async (pid) => {
      membershipByProject.set(pid, await isMember(pid, caller));
    }),
  );
  return prefiltered.filter((r) => membershipByProject.get(r.project_id) === true);
}

// --- Credentials ---------------------------------------------------------

/**
 * Resolve a credential by (project_id, credential_type).
 *
 * Three-tier preferred-path-with-fallback (Epic-010 Story 2-B / #91):
 *   1. `wf/projects/{id}/{type}`         project-scoped (canonical)
 *   2. `wf/projects/_default/{type}`     shared fallback (post-migration)
 *   3. `wf/{type}`                       legacy bare path (pre-Epic-010)
 *
 * Each tier-2 / tier-3 hit emits a structured `legacy_credential_read`
 * log AND a `WfLegacyCredentialReads` CloudWatch metric (namespace
 * `Workforce/Credentials`, dimensions `Stage` + `Reason`). The operator
 * watches the bare-path metric graph to zero before deleting the bare
 * keys (Epic-010 §6 deprecation window).
 *
 * Only `ResourceNotFoundException` triggers fallback. IAM / throttle /
 * network / JSON-parse failures re-throw so they surface loudly per W-4.
 * If all three tiers miss, the third throw propagates (load-bearing —
 * a missing credential is a fail-loud event).
 *
 * Type parameter `T` has no default — callers MUST specify the expected
 * secret shape (e.g. `getCredential<GithubSecret>(...)`) so wrong-shape
 * access is a compile error, not a runtime surprise. The type registry
 * that keys T off `credentialType` lives at
 * `workforce/lambdas/shared/credential-injector.ts:CredentialShapes`
 * (Story 2-A); skill code SHOULD prefer `injectCredentials()` over
 * direct `getCredential()` so the bag is sealed at the trust boundary.
 */
export async function getCredential<T>(
  projectId: ProjectId,
  credentialType: string,
): Promise<T> {
  try {
    return await getSecret<T>(`wf/projects/${projectId}/${credentialType}`);
  } catch (err) {
    if (!isResourceNotFound(err)) throw err;
  }
  // Tier 1 missed — try _default shared bag.
  try {
    const value = await getSecret<T>(`wf/projects/_default/${credentialType}`);
    emitLegacyCredentialRead(projectId, credentialType, "fallback_default");
    return value;
  } catch (err) {
    if (!isResourceNotFound(err)) throw err;
  }
  // Tier 2 missed — fall back to legacy bare path. A third miss throws
  // (load-bearing W-4 — a totally missing credential must fail loud).
  const value = await getSecret<T>(`wf/${credentialType}`);
  emitLegacyCredentialRead(projectId, credentialType, "fallback_bare");
  return value;
}

function isResourceNotFound(err: unknown): boolean {
  return err instanceof Error && err.name === "ResourceNotFoundException";
}

function emitLegacyCredentialRead(
  projectId: ProjectId,
  credentialType: string,
  reason: "fallback_default" | "fallback_bare",
): void {
  console.warn(
    JSON.stringify({
      event: "legacy_credential_read",
      project_id: projectId,
      credential_type: credentialType,
      reason,
    }),
  );
  // Best-effort fire-and-forget; never await, never throw. A metric-
  // emission failure must NOT mask the successful credential read.
  cwForCreds
    .send(
      new PutMetricDataCommand({
        Namespace: "Workforce/Credentials",
        MetricData: [
          {
            MetricName: "WfLegacyCredentialReads",
            Value: 1,
            Unit: "Count",
            Dimensions: [
              { Name: "Stage", Value: STAGE },
              { Name: "Reason", Value: reason },
            ],
          },
        ],
      }),
    )
    .catch((err) => {
      console.warn(
        JSON.stringify({
          event: "legacy_credential_metric_emit_failed",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    });
}
