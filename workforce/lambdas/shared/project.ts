// workforce/lambdas/shared/project.ts
//
// Project as first-class entity. Per Epic-010 (workforce/docs/epics/
// epic-010-project-trust-boundary.md), a Project owns two things:
//   - a typed credential bag         → getCredential()
//   - an append-only execution ledger → appendExecution() / listExecutions()
// plus lifecycle helpers (create / archive / rename / getProject).
//
// Naming convention: camelCase for all exported function names, matching
// the rest of workforce/lambdas/shared/. The Epic-010 prose uses
// snake_case for these (e.g. `Project.append_execution`) — that is
// illustrative; the binding rule is codebase consistency.
//
// MEMBERSHIP WAS REMOVED (2026-07-03, operator direction): every registered
// agent participates in every project — there is no member/non-member
// distinction, only `owner_agent`. The concept had already been reduced to
// "roster metadata that gates nothing" (the appendExecution write-gate was
// removed 2026-06-08 and the listExecutions/recall read-gate 2026-06-10 at
// C-3 scale); this removal deletes the vestigial helpers, routes, and seed
// writes. Historical PROJECT#{id}/MEMBER#{slug} rows remain in DDB as inert
// audit data — nothing reads or writes them.
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
  /**
   * Human-readable project name (the schema's `name`). Seeded from
   * `workforce/projects/{id}/project.json` by `seed-projects.mjs`; surfaced
   * in the console. Optional on the type because runner-auto-seeded
   * `self/{slug}` projects and pre-seed rows carry none.
   */
  name?: string;
  /**
   * The GitHub repo this project ships work against — the standard project
   * attribute for the target repo (e.g. `refluster/project-ind`,
   * `PSVL/asp-cloud`). Stored flattened as two scalar attributes (not a
   * nested map) so DDB filter/projection stays cheap; the seed
   * (`seed-projects.mjs`) writes them from `project.json:github.{owner,repo}`.
   *
   * NON-CONFIDENTIAL by design — this is a project *variable*, not a secret.
   * The matching PAT lives in Secrets Manager under
   * `wf/projects/{id}/github.token` (credential_types), exactly the
   * github-repo-var vs. github-repo-secret split. Canonical edits go through
   * `project.json` + seed (Epic-010 §10), not the PATCH API.
   *
   * Both present or both absent: a project either declares a target repo or
   * it does not. Read by the pr-autopilot / pr-review path to resolve PR
   * URLs against the project (governance.md R-N9 / R-N10).
   */
  github_owner?: string;
  github_repo?: string;
}

export interface ArtifactRef {
  uri: string;
  content_hash: string;
  content_type: string;
  size_bytes: number;
  /** ≤512-char inline preview. Full body fetched from S3 on demand. */
  summary: string;
}

/**
 * Status discriminator for the EXEC ledger row.
 *
 *   - `ok`                          execution completed; artefact written.
 *   - `throw`                       execution body threw before the artefact
 *                                    write; `error` populated.
 *   - `skipped`                     scheduler fired but pre-flight skipped
 *                                    the body (paused / archived / etc.).
 *   - `failed_artefact_redaction`   execution body completed but the
 *                                    redaction guard in
 *                                    `shared/artefact-writer.ts` matched
 *                                    a known secret shape. The S3 object
 *                                    was NOT written; the EXEC row is
 *                                    persisted with `error` populated so
 *                                    the failure is visible in the
 *                                    ledger rather than silently dropped
 *                                    (Epic-010 Story 3 / #92 AC 3).
 */
export type ExecStatus = "ok" | "throw" | "skipped" | "failed_artefact_redaction";

/**
 * Where the LLM call that produced this execution ran. Per R-N1
 * (governance.md §4):
 *
 *   - `lambda`  Workforce agent-runner Lambda — the canonical surface
 *               with full W-3 budget enforcement, W-4 fail-loud, W-5
 *               persona stability. Default if unset (covers all rows
 *               written before L2-2 added this field).
 *   - `client`  Client-side execution under R-N1(b): the consumer fetched
 *               agent metadata + persona, ran the LLM in their own
 *               environment, and filed the engagement record via the
 *               Phase 7 PR5 `POST /agents/{slug}/engagements` surface.
 *               Best-effort audit by definition — silent loss of the
 *               POST-back is the accepted failure mode.
 *
 * Adding new surfaces is a Zone A amendment (governance.md R-N1).
 */
// `ccr` (ADR-0005 item 5): the row was written by the generic CCR
// agent-runner routine's per-task write-back — the framework activity-ledger
// sink for the CCR execution model. `lambda` = the retired in-Lambda runner;
// `client` = an external R-N1(b) engagement POST. All three flow through the
// one `POST /agents/{slug}/engagements` write surface.
export type ExecutionSurface = "lambda" | "client" | "ccr";

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
  /**
   * Free-text business summary of the engagement — what this unit of work
   * accomplished, in the caller's own words. Distinct from
   * `artifact_ref.summary`, which is a ≤512-char preview of a produced *file*
   * deliverable: an engagement (e.g. a `pr-review`) can carry a meaningful
   * summary with no file artifact at all, and previously had nowhere to put
   * it (the portfolio/deliverables UI rendered "no summary"). Set via the
   * `POST /agents/{slug}/engagements` route; ≤512 chars, sliced at the write
   * seam. Pre-2026-06-13 rows have no attribute; readers fall back to
   * `artifact_ref.summary`, then "".
   */
  summary?: string;
  /**
   * Where the LLM call ran. `lambda` = workforce agent-runner (default; the
   * historical-and-still-canonical path). `client` = client-side execution
   * under R-N1(b) — the consumer fetched agent metadata + persona, ran the
   * LLM in their own environment, and POSTed the engagement record via
   * `POST /agents/{slug}/engagements` to file the audit. Pre-L2-2 rows
   * have no attribute; readers treat absent as `lambda` (no migration).
   */
  execution_surface?: ExecutionSurface;
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

/**
 * Flip an archived project back to active. Mirror of `archive()` —
 * needed by the operator project console's Unarchive button (Issue #158
 * D2). The `archived_at` attribute is intentionally CLEARED on unarchive
 * (rather than preserved as audit) so a future audit can rely on "the
 * attribute is set" being equivalent to "the project is archived right
 * now." Tenure-history reconstruction would need a separate row family
 * (same shape as the soft-delete on memberships) and is out of scope.
 */
export async function unarchive(projectId: ProjectId): Promise<void> {
  const meta = await getItem<ProjectMetaRow>(projectPk(projectId), "META");
  if (!meta) throw new Error(`project "${projectId}" not found`);
  if (meta.status !== "archived") {
    // No-op if not currently archived — callers may want to flip
    // optimistically without reading first. Throw is reserved for the
    // genuinely-missing case above.
    return;
  }
  meta.status = "active";
  delete meta.archived_at;
  await putItem(meta);
}

/** Renamed from `get` (shadowed JS keyword in some IDE contexts). */
export async function getProject(projectId: ProjectId): Promise<ProjectMetaRow | undefined> {
  return getItem<ProjectMetaRow>(projectPk(projectId), "META");
}

/**
 * Rename a project's human-readable display name. The `name` is a display
 * attribute fully decoupled from `project_id` (the immutable slug that keys
 * the partition, the URL, and the Secrets Manager prefix) — renames never
 * cascade, and any characters that fit the length bound are fine. Writable
 * via `PATCH /projects/{id}` (AWS_IAM); the seed treats `name` as
 * create-only on existing rows so a PATCHed name survives re-seeds.
 */
export async function rename(projectId: ProjectId, name: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 80) {
    throw new Error(`project name must be 1..80 chars after trim (got ${trimmed.length})`);
  }
  const meta = await getItem<ProjectMetaRow>(projectPk(projectId), "META");
  if (!meta) throw new Error(`project "${projectId}" not found`);
  meta.name = trimmed;
  await putItem(meta);
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
  /** Free-text business summary of the engagement (≤512 chars; the caller
   *  must slice). Distinct from `artifact_ref.summary` — see
   *  `ExecutionRow.summary`. */
  summary?: string;
  /** Where the LLM call ran. Omit (or set `lambda`) for workforce
   *  agent-runner executions; set `client` when the row is written via
   *  the `POST /agents/{slug}/engagements` route for R-N1(b) client-side
   *  execution. See `ExecutionSurface` doc above. */
  execution_surface?: ExecutionSurface;
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
 * Append one execution row to a project's ledger.
 *
 * No membership gate (the concept was removed 2026-07-03; the write-gate
 * had already gone 2026-06-08): any caller holding the API-layer write
 * token may append to any project's ledger (single-operator scale, C-3).
 *
 * Note: archive does NOT close the ledger — appendExecution against an
 * archived project succeeds. If "archive closes the ledger" semantics are
 * wanted later, gate here on `meta.status === "active"`.
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
    summary: input.summary,
    execution_surface: input.execution_surface,
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
};

export type ListExecutionsFilter = (AgentScope | SkillScope | ProjScope) & CommonOpts;

/**
 * Return execution rows matching the filter.
 *
 * **No membership gate.** The `appendExecution` write-gate on project
 * membership was removed 2026-06-08 (C-3), and the recall read-gate that
 * post-filtered rows by `isMember(caller, project)` was removed 2026-06-10
 * (owner directive: project↔member binding is not an access-control
 * primitive — every registered agent participates in every project; the
 * single-operator scale of C-3 has no tenant boundary to enforce). Rows
 * are returned to any caller subject only to the structured filters below.
 *
 * Range push-down: both `from` and `to` are passed to DDB as
 * `skGte` / `skLte` constraints when scoping by agent_slug / skill_name.
 * Half-bounded ranges (only `from` or only `to`) work; full-partition
 * (neither bound) also works.
 *
 * Ordering: all three branches query **newest-first** (`ScanIndexForward:
 * false`). This is load-bearing, not cosmetic — DDB applies `Limit` before
 * returning, so an ascending query keeps the OLDEST `limit` rows and a
 * busy partition's recent rows never surface (the engagement-ledger read
 * bug: an agent with >100 historical EXEC rows could not see today's
 * engagement at all). Callers that want a stable order still re-sort, but
 * must receive the recent window first.
 */
export async function listExecutions(filter: ListExecutionsFilter): Promise<ExecutionRow[]> {
  const limit = filter.limit ?? 100;
  let rows: ExecutionRow[];

  if (filter.agent_slug) {
    rows = await queryByGsi<ExecutionRow>("GSI1", `AGENT#${filter.agent_slug}`, {
      skGte: filter.from,
      skLte: filter.to,
      limit,
      scanIndexForward: false,
    });
  } else if (filter.skill_name) {
    rows = await queryByGsi<ExecutionRow>("GSI2", `SKILL#${filter.skill_name}`, {
      skGte: filter.from,
      skLte: filter.to,
      limit,
      scanIndexForward: false,
    });
  } else if (filter.project_id) {
    // Project-partition path; range is post-filtered (no SK push-down).
    rows = await queryBySkPrefix<ExecutionRow>(projectPk(filter.project_id), "EXEC#", limit, false);
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
