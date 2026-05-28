// wf-agents-api Lambda handler.
// Routes:
//   GET    /agents                          list (paginated, filterable)
//   GET    /agents/{slug}                   single agent
//   GET    /agents/{slug}/deliverables      recent DELIV rows (paginated)
//   GET    /agents/{slug}/projects          projects this agent is an active member of
//   PATCH  /agents/{slug}                   operational fields only (IAM-auth at API GW)
//   DELETE /agents/{slug}                   soft delete -> archived=true (IAM-auth at API GW)
//   GET    /skills                          list of skills (paginated, filterable)
//   GET    /skills/{name}                   single skill
//   GET    /projects                        list of projects (paginated, ?include_self=)
//   GET    /projects/{id+}                  single project META + member/exec summary
//   GET    /projects/{id+}/members          active members (?include_revoked=true for audit)
//   GET    /projects/{id+}/executions       ledger (paginated, ?from=&to=&status=&agent=&skill=)
//
// See workforce/docs/epics/epic-007-agent-management-api.md (agents),
// workforce/docs/epics/epic-008-skill-repository.md (skills), and
// workforce/docs/epics/epic-010-project-trust-boundary.md §10 (projects)
// for the source-of-truth split and the IAM-auth boundary.
//
// Per Epic-010 §10, `POST /projects` is intentionally NOT exposed: new
// projects come from `workforce/projects/{id}/project.json` + a seed
// step, mirroring Epic-007's "creates via API are deliberately not
// exposed." Member-mutation routes (POST/DELETE) land with Story 6's
// follow-up slice; this PR ships read endpoints only.

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import {
  type AgentMetaRow,
  type AgentOperational,
  type Stream,
  agentPk,
  toApiView,
} from "../shared/agent.js";
import {
  type SkillMetaRow,
  skillPk,
  toSkillApiView,
} from "../shared/skill-row.js";
import type { DelivRow } from "../shared/task.js";
import { getItem, queryBySkPrefix, scanPrefix, updateOperational } from "../shared/ddb.js";
import {
  asProjectId,
  projectPk,
  type ExecutionRow,
  type ProjectMemberRow,
  type ProjectMetaRow,
} from "../shared/project.js";
import {
  CloudWatchClient,
  PutMetricDataCommand,
} from "@aws-sdk/client-cloudwatch";

const STAGE = process.env.STAGE ?? "dev";
// One client per cold start. Metric emission is best-effort — failures
// log but do NOT block the request (W-4 is preserved at the response
// level: a malformed row is skipped, not returned as garbage).
const cw = new CloudWatchClient({});

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;

const PATCHABLE_FIELDS: Array<keyof AgentOperational> = [
  "budget_monthly_usd_override",
  "paused",
  "archived",
];

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  try {
    const routeKey = event.routeKey;
    const method = event.requestContext.http.method;
    const path = event.requestContext.http.path;
    const slug = event.pathParameters?.slug;
    const skillName = event.pathParameters?.name;

    // Dispatch on routeKey (e.g. "GET /agents") rather than the raw
    // requestContext.http.path. The latter carries the stage prefix
    // when the API isn't on the $default stage — path becomes
    // "/prod/agents" — which would silently break list endpoints.
    // routeKey is the API GW HTTP API v2 route as configured.
    // Projects path uses the greedy `{id+}` proxy because project ids
    // include slashes (e.g. `self/ren`). API Gateway HTTP API v2 maps
    // that to `pathParameters.id` regardless of slash count.
    const projectId = event.pathParameters?.id;

    if (routeKey === "GET /agents") return listAgents(event);
    if (routeKey === "GET /skills") return listSkills(event);
    if (routeKey === "GET /skills/{name}" && skillName) return getSkill(skillName);
    if (routeKey === "GET /agents/{slug}/deliverables" && slug) return listAgentDeliverables(slug, event);
    if (routeKey === "GET /agents/{slug}/projects" && slug) return listAgentProjects(slug);
    if (routeKey === "GET /agents/{slug}" && slug) return getAgent(slug);
    if (routeKey === "PATCH /agents/{slug}" && slug) return patchAgent(slug, event.body);
    if (routeKey === "DELETE /agents/{slug}" && slug) return deleteAgent(slug);
    if (routeKey === "GET /projects") return listProjects(event);
    if (routeKey === "GET /projects/{id+}/members" && projectId) return listProjectMembers(projectId, event);
    if (routeKey === "GET /projects/{id+}/executions" && projectId) return listProjectExecutions(projectId, event);
    if (routeKey === "GET /projects/{id+}" && projectId) return getProject(projectId);

    return reply(404, { error: "route_not_found", routeKey, path, method });
  } catch (err) {
    return reply(500, {
      error: "internal",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function listAgents(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const qs = event.queryStringParameters ?? {};
  const wantArchived = qs.archived === "true";
  const filterStream = qs.stream as Stream | undefined;
  const pageSize = Math.min(
    Math.max(parseInt(qs.page_size ?? `${PAGE_SIZE_DEFAULT}`, 10) || PAGE_SIZE_DEFAULT, 1),
    PAGE_SIZE_MAX,
  );

  const page = await scanPrefix<AgentMetaRow>("AGENT#", "META", pageSize, qs.cursor);
  const items = page.items
    .filter((r) => wantArchived || !r.archived)
    .filter((r) => !filterStream || r.streams.includes(filterStream))
    .map(toApiView);

  return reply(200, { items, next_cursor: page.cursor });
}

async function getAgent(slug: string): Promise<APIGatewayProxyResultV2> {
  const row = await getItem<AgentMetaRow>(agentPk(slug), "META");
  if (!row) return reply(404, { error: "not_found", slug });
  return reply(200, toApiView(row));
}

async function patchAgent(
  slug: string,
  body: string | undefined,
): Promise<APIGatewayProxyResultV2> {
  if (!body) return reply(400, { error: "missing_body" });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return reply(400, { error: "invalid_json" });
  }

  const patch: Partial<AgentOperational> = {};
  const invalid: string[] = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (PATCHABLE_FIELDS.includes(k as keyof AgentOperational)) {
      (patch as Record<string, unknown>)[k] = v;
    } else {
      invalid.push(k);
    }
  }
  if (invalid.length > 0) {
    return reply(400, {
      error: "non_operational_fields",
      detail: `the following fields are identity-only and cannot be PATCHed: ${invalid.join(", ")}`,
      patchable: PATCHABLE_FIELDS,
    });
  }
  if (Object.keys(patch).length === 0) {
    return reply(400, { error: "empty_patch" });
  }

  const existing = await getItem<AgentMetaRow>(agentPk(slug), "META");
  if (!existing) return reply(404, { error: "not_found", slug });

  const updated = await updateOperational<AgentMetaRow>(
    agentPk(slug),
    "META",
    patch,
    existing.identity_hash,
  );
  return reply(200, toApiView(updated));
}

async function deleteAgent(slug: string): Promise<APIGatewayProxyResultV2> {
  const existing = await getItem<AgentMetaRow>(agentPk(slug), "META");
  if (!existing) return reply(404, { error: "not_found", slug });
  if (existing.archived) {
    return reply(200, { ...toApiView(existing), already_archived: true });
  }
  const updated = await updateOperational<AgentMetaRow>(
    agentPk(slug),
    "META",
    { archived: true },
    existing.identity_hash,
  );
  return reply(200, toApiView(updated));
}

// ----- Skills (Epic-008 PR-D) -----

async function listSkills(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const qs = event.queryStringParameters ?? {};
  const filterStatus = qs.status as "active" | "stale" | "deprecated" | undefined;
  const filterOwner = qs.owner; // agent slug — show skills the given agent owns
  const pageSize = Math.min(
    Math.max(parseInt(qs.page_size ?? `${PAGE_SIZE_DEFAULT}`, 10) || PAGE_SIZE_DEFAULT, 1),
    PAGE_SIZE_MAX,
  );

  const page = await scanPrefix<SkillMetaRow>("SKILL#", "META", pageSize, qs.cursor);
  const items = page.items
    .filter((r) => !filterStatus || r.status === filterStatus)
    .filter((r) => !filterOwner || r.owners.includes(filterOwner))
    .map(toSkillApiView);

  return reply(200, { items, next_cursor: page.cursor });
}

async function getSkill(name: string): Promise<APIGatewayProxyResultV2> {
  const row = await getItem<SkillMetaRow>(skillPk(name), "META");
  if (!row) return reply(404, { error: "not_found", name });
  return reply(200, toSkillApiView(row));
}

async function listAgentDeliverables(
  slug: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const qs = event.queryStringParameters ?? {};
  const limit = Math.min(
    Math.max(parseInt(qs.limit ?? "20", 10) || 20, 1),
    PAGE_SIZE_MAX,
  );
  // DDB Query under AGENT#{slug} with SK begins_with DELIV# returns rows
  // sorted by SK lex order, i.e. by ulid which encodes time. Limit is the
  // page size; v1 returns most-recent-first by reversing client-side.
  const rows = await queryBySkPrefix<DelivRow>(agentPk(slug), "DELIV#", limit);
  // Sort by created_at desc (the ULID ordering already gives chronology,
  // but explicit sort handles any operator-inserted out-of-order rows).
  rows.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  return reply(200, { items: rows });
}

// ----- Projects (Epic-010 §10 — Story 6 #95) -----
//
// The projects read API is layered onto agents-api so the SPA doesn't
// fan out to a second base URL. `POST /projects` is intentionally
// absent — new projects come from `workforce/projects/{id}/project.json`
// + a seed step (mirroring Epic-007's "creates via API are deliberately
// not exposed"). The credential vault has its own Lambda (Story 2-C
// #91) to keep this Lambda's IAM scope narrow per R-N3.
//
// Authorisation: `GET` is allowed at the HTTP API layer (Cognito on the
// SPA host gates browser access). The `listExecutions` read-gate from
// Epic-010 §10 ("operator OR active member") needs per-request IAM
// brokering that isn't wired into the SPA yet — the operator is the
// only browser consumer today, by hostname convention.

/** API-shaped Project META — flattens the DDB row's PK/SK plumbing. */
interface ProjectApiView {
  project_id: string;
  status: "active" | "archived";
  owner_agent: string;
  created_at: string;
  archived_at?: string;
  /** Number of active (non-revoked) MEMBER rows. Resolved lazily by
   *  list/get callers so the index view can paginate cheaply. */
  member_count?: number;
  /** Most-recent EXEC#* `started_at` on this project's partition.
   *  Undefined when the ledger is empty. */
  last_execution_at?: string;
}

function toProjectApiView(row: ProjectMetaRow): ProjectApiView {
  return {
    project_id: row.project_id,
    status: row.status,
    owner_agent: row.owner_agent,
    created_at: row.created_at,
    archived_at: row.archived_at,
  };
}

async function listProjects(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const qs = event.queryStringParameters ?? {};
  const includeSelf = qs.include_self === "true";
  const filterStatus = qs.status as "active" | "archived" | undefined;
  const filterOwner = qs.owner;
  const pageSize = Math.min(
    Math.max(parseInt(qs.page_size ?? `${PAGE_SIZE_DEFAULT}`, 10) || PAGE_SIZE_DEFAULT, 1),
    PAGE_SIZE_MAX,
  );

  const page = await scanPrefix<ProjectMetaRow>("PROJECT#", "META", pageSize, qs.cursor);

  // Defence-in-depth: skip rows that don't match the canonical
  // `ProjectMetaRow` shape rather than throwing the whole request.
  // This catches data-integrity regressions from operator-side bootstrap
  // runbooks (the prod bug found in OP-001 verification — a META row
  // missing `project_id` would 500 the entire listProjects call) and
  // emits a structured log + `WfMalformedProjectMeta` metric so the
  // operator sees the gap. The per-route GETs still expose the shape
  // honestly (a single-row GET 404s on a row that the brand validator
  // rejects), so this is *list-route defence*, not a silent papering-over.
  const wellFormed = page.items.filter((r) =>
    isWellFormedProjectMeta(r) ? true : (emitMalformedProjectMeta(r), false),
  );
  const filtered = wellFormed
    .filter((r) => includeSelf || !r.project_id.startsWith("self/"))
    .filter((r) => !filterStatus || r.status === filterStatus)
    .filter((r) => !filterOwner || r.owner_agent === filterOwner);

  // Resolve member_count + last_execution_at concurrently per row. At v1
  // page sizes (≤100) this is bounded and cheap; promote to a single GSI
  // query if it becomes hot.
  const items: ProjectApiView[] = await Promise.all(
    filtered.map(async (row) => {
      const view = toProjectApiView(row);
      const id = asProjectId(row.project_id);
      const [memberRows, lastExec] = await Promise.all([
        queryBySkPrefix<ProjectMemberRow>(projectPk(id), "MEMBER#", 100),
        getLastExecutionAt(row.project_id),
      ]);
      view.member_count = memberRows.filter((m) => m.revoked_at === undefined).length;
      if (lastExec !== undefined) view.last_execution_at = lastExec;
      return view;
    }),
  );

  return reply(200, { items, next_cursor: page.cursor });
}

/**
 * True iff the row carries the canonical `ProjectMetaRow` attributes
 * `listProjects` consumes. Rejection drops the row from the list
 * response AND emits a metric (see `emitMalformedProjectMeta`). The
 * branded `asProjectId(row.project_id)` call inside the per-row map
 * would also throw on a bad value; this pre-check moves the rejection
 * BEFORE the Promise.all fan-out so one bad row doesn't fail the rest.
 */
function isWellFormedProjectMeta(row: Partial<ProjectMetaRow>): row is ProjectMetaRow {
  return (
    typeof row.project_id === "string" &&
    row.project_id.length > 0 &&
    typeof row.status === "string" &&
    typeof row.owner_agent === "string" &&
    typeof row.created_at === "string"
  );
}

/**
 * Structured log + best-effort CW metric on a skipped malformed row.
 * Fire-and-forget — a metric-emission failure must not block the list
 * response (the row is already skipped; we just lose the signal).
 */
function emitMalformedProjectMeta(row: Partial<ProjectMetaRow>): void {
  const pk = typeof row.pk === "string" ? row.pk : "<missing-pk>";
  console.warn(
    JSON.stringify({
      event: "agents_api_malformed_project_meta",
      pk,
      attrs: Object.keys(row).sort(),
      reason: "missing canonical attributes — fix the bootstrap runbook",
    }),
  );
  cw.send(
    new PutMetricDataCommand({
      Namespace: "Workforce/AgentsApi",
      MetricData: [
        {
          MetricName: "WfMalformedProjectMeta",
          Value: 1,
          Unit: "Count",
          Dimensions: [{ Name: "Stage", Value: STAGE }],
        },
      ],
    }),
  ).catch((err) => {
    console.warn(
      JSON.stringify({
        event: "agents_api_malformed_meta_metric_emit_failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  });
}

async function getProject(rawId: string): Promise<APIGatewayProxyResultV2> {
  const id = asProjectId(rawId);
  const row = await getItem<ProjectMetaRow>(projectPk(id), "META");
  if (!row) return reply(404, { error: "not_found", project_id: rawId });
  const view = toProjectApiView(row);
  const [memberRows, lastExec] = await Promise.all([
    queryBySkPrefix<ProjectMemberRow>(projectPk(id), "MEMBER#", 100),
    getLastExecutionAt(rawId),
  ]);
  view.member_count = memberRows.filter((m) => m.revoked_at === undefined).length;
  if (lastExec !== undefined) view.last_execution_at = lastExec;
  return reply(200, view);
}

async function listProjectMembers(
  rawId: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const id = asProjectId(rawId);
  const qs = event.queryStringParameters ?? {};
  const includeRevoked = qs.include_revoked === "true";
  const rows = await queryBySkPrefix<ProjectMemberRow>(projectPk(id), "MEMBER#", 100);
  const items = rows
    .filter((r) => includeRevoked || r.revoked_at === undefined)
    .map((r) => ({
      agent_slug: r.agent_slug,
      joined_at: r.joined_at,
      revoked_at: r.revoked_at,
    }));
  return reply(200, { items });
}

async function listProjectExecutions(
  rawId: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const id = asProjectId(rawId);
  const qs = event.queryStringParameters ?? {};
  const limit = Math.min(
    Math.max(parseInt(qs.limit ?? `${PAGE_SIZE_DEFAULT}`, 10) || PAGE_SIZE_DEFAULT, 1),
    PAGE_SIZE_MAX,
  );
  // Project-partition query — single PK, SK begins_with EXEC#. Range
  // filtering on `from`/`to` is post-filter because the EXEC sort key
  // is a ULID, not the raw started_at timestamp.
  const rows = await queryBySkPrefix<ExecutionRow>(projectPk(id), "EXEC#", limit);
  const filtered = rows
    .filter((r) => !qs.status || r.status === qs.status)
    .filter((r) => !qs.agent || r.agent_slug === qs.agent)
    .filter((r) => !qs.skill || r.skill_name === qs.skill)
    .filter((r) => !qs.from || r.started_at >= qs.from)
    .filter((r) => !qs.to || r.started_at <= qs.to)
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
  const items = filtered.map((r) => ({
    exec_ulid: r.sk.replace(/^EXEC#/, ""),
    project_id: r.project_id,
    agent_slug: r.agent_slug,
    skill_name: r.skill_name,
    skill_version: r.skill_version,
    started_at: r.started_at,
    ended_at: r.ended_at,
    status: r.status,
    used_credential_types: r.used_credential_types,
    artifact_ref: r.artifact_ref,
    error: r.error,
  }));
  return reply(200, { items });
}

async function listAgentProjects(slug: string): Promise<APIGatewayProxyResultV2> {
  // Memberships query: scan MEMBER#{slug} rows across all PROJECT#*
  // partitions. No GSI for this access pattern yet; scanPrefix is fine
  // at workforce scale (≤ 20 projects). When this grows hot, add a GSI
  // on (gsi3pk=AGENT#slug, gsi3sk=PROJECT#id) at MEMBER write time.
  const page = await scanPrefix<ProjectMemberRow>("PROJECT#", `MEMBER#${slug}`, PAGE_SIZE_MAX);
  const items = page.items
    .filter((r) => r.revoked_at === undefined)
    .map((r) => ({
      project_id: r.project_id,
      joined_at: r.joined_at,
    }));
  return reply(200, { items });
}

/**
 * Most-recent EXEC#* `started_at` for a project, or undefined when the
 * ledger is empty. Surfaces "last activity" at the index level without
 * a second round-trip per row at the client.
 *
 * Implementation: one DDB query over the project partition, then a
 * linear scan for the max `started_at`. EXEC sort keys are ULIDs which
 * encode ms-precision time, but the canonical "when did this run start"
 * lives in `started_at` on the row — so use that for cross-page sorting
 * and tie-breaking.
 */
async function getLastExecutionAt(rawId: string): Promise<string | undefined> {
  const id = asProjectId(rawId);
  const rows = await queryBySkPrefix<ExecutionRow>(projectPk(id), "EXEC#", 100);
  let latest: string | undefined;
  for (const r of rows) {
    if (latest === undefined || r.started_at > latest) latest = r.started_at;
  }
  return latest;
}

function reply(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
    body: JSON.stringify(body),
  };
}
