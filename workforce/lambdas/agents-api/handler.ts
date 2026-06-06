// wf-agents-api Lambda handler.
// Routes:
//   GET    /agents                          list (paginated, filterable)
//   GET    /agents/{slug}                   single agent
//   GET    /agents/{slug}/deliverables      LEGACY DELIV rows (historical; no SPA caller — EXEC is canonical, see Story 3 #216)
//   GET    /agents/{slug}/executions        canonical activity ledger — EXEC rows via GSI1 (the agent-profile task log)
//   GET    /agents/{slug}/projects          projects this agent is an active member of
//   GET    /agents/{slug}/posts             per-agent activity feed (Epic-011 Story 5)
//   GET    /agents/{slug}/portfolio         per-client engagement records (Phase 7 PR5; ?project_id= required)
//   POST   /agents/{slug}/engagements       register a client-side engagement record (Phase 7 PR5; Bearer auth)
//   GET    /agents/{slug}/recall            semantic recall over the agent's ledger (?q=&k=; Epic-012 Story 1)
//   PATCH  /agents/{slug}                   operational fields only (IAM-auth at API GW)
//   DELETE /agents/{slug}                   soft delete -> archived=true (IAM-auth at API GW)
//   GET    /skills                          list of skills (paginated, filterable)
//   GET    /skills/{name}                   single skill
//   GET    /projects                        list of projects (paginated, ?include_self=)
//   GET    /projects/{id}                  single project META + member/exec summary
//   GET    /projects/{id}/members          active members (?include_revoked=true for audit)
//   GET    /projects/{id}/executions       ledger (paginated, ?from=&to=&status=&agent=&skill=)
//   GET    /feed                            workforce activity feed, reverse-chrono (Epic-011 Story 5)
//   GET    /feed/{post_id}                  single post + full body (Epic-011 Story 5)
//   PATCH  /feed/{post_id}                  hide a post (IAM-auth at API GW; Epic-011 Story 5)
//   GET    /threads                         operator inbox, reverse-chrono (Epic-013 Story 1; ?cursor=&page_size=&filter=unread|starred)
//   GET    /threads/{id}                    single thread + messages, S3-hydrated bodies (Epic-013 Story 1)
//   POST   /threads                         operator starts a thread (Epic-013 Story 2; Cognito JWT at GW)
//   POST   /threads/{id}/messages           operator appends a message (Epic-013 Story 2; Cognito JWT at GW)
//   POST   /threads/{id}/read               clear operator unread (Epic-013 Story 2; Cognito JWT at GW)
//   POST   /threads/{id}/star               set operator star (Epic-013 Story 2; Cognito JWT at GW)
//
// See workforce/docs/epics/epic-007-agent-management-api.md (agents),
// workforce/docs/epics/epic-008-skill-repository.md (skills),
// workforce/docs/epics/epic-010-project-trust-boundary.md §10 (projects),
// and workforce/docs/epics/epic-011-agent-feed.md (feed) for the
// source-of-truth split and the IAM-auth boundary.
//
// Per Epic-010 §10, `POST /projects` is intentionally NOT exposed: new
// projects come from `workforce/projects/{id}/project.json` + a seed
// step, mirroring Epic-007's "creates via API are deliberately not
// exposed." Member-mutation routes (POST/DELETE) land with Story 6's
// follow-up slice; this PR ships read endpoints only.
//
// Per Epic-011 §6 + Story 5 (#132), `POST /feed` is similarly NOT
// exposed: posts originate from the runner only, never from the UI.
// The feed `GET` endpoints are public on the CORS gate
// (`workforce.kohuehara.xyz` only); `PATCH /feed/{post_id}` requires
// AWS_IAM (operator's `aws-vault` credentials) — the threat model is
// documented in PR #132 (workforce-internal; hostname-guess access is
// the accepted blast radius; mitigated by Story 4's hide primitive +
// Story 1's write-time guards).

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
  appendExecution,
  archive as archiveProject,
  asProjectId,
  getProject,
  listExecutions,
  projectPk,
  unarchive as unarchiveProject,
  type ArtifactRef,
  type ExecStatus,
  type ExecutionRow,
  type ExecutionSurface,
  type ProjectMemberRow,
  type ProjectMetaRow,
} from "../shared/project.js";
import { recall, type RecallResult } from "../shared/recall.js";
import { isValidEngagementToken } from "../shared/engagement-token.js";
import { CREDENTIAL_TYPES } from "../shared/credential-injector.js";
import {
  CloudWatchClient,
  PutMetricDataCommand,
} from "@aws-sdk/client-cloudwatch";
import { timingSafeEqual } from "node:crypto";
import {
  DescribeSecretCommand,
  GetSecretValueCommand,
  ResourceNotFoundException as SmResourceNotFoundException,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import {
  createPost,
  fetchPostBody,
  getPost,
  hidePost,
  listAgentPosts,
  listFeed,
  toFeedPostApiView,
  type FeedPostDetailView,
  type PostKind,
} from "../shared/post.js";
import {
  getThreadDetail,
  listInbox,
  toThreadSummaryView,
  createThread,
  sendMessage,
  markThreadRead,
  setThreadStar,
  MESSAGING_OPERATOR_ID,
  type ThreadFilter,
} from "../shared/messaging.js";

// Secrets Manager path holding the feed-write capability token. The
// runner presents the same token (injected from this secret into its
// CCR task) as `Authorization: Bearer <token>`; POST /feed validates the
// incoming bearer against this. Single source of truth, read by two AWS
// principals (orchestrator to inject, this Lambda to validate). v1 scopes
// the capability to the agent-workforce project bag.
const FEED_WRITE_TOKEN_SECRET = "wf/projects/agent-workforce/workforce.feed_write_token";
let _feedWriteTokenCache: string | undefined;

// Secrets Manager path holding the engagement-write capability token.
// External clients (RepoA-style downstream repos) hold this token and
// present it as `Authorization: Bearer <token>` on POST /agents/{slug}/
// engagements. Single shared token per Phase 7 PR5 scope; per-project
// tokens are a future amendment (the operator decides distribution at
// single-operator scale, C-3). The engagement record's `project_id` is
// client-supplied — the operator's trust assumption is that only project
// members hold the token.
const ENGAGEMENT_WRITE_TOKEN_SECRET = "wf/api/engagements-write-token";
let _engagementWriteTokenCache: string | undefined;

const STAGE = process.env.STAGE ?? "dev";
// One client per cold start. Metric emission is best-effort — failures
// log but do NOT block the request (W-4 is preserved at the response
// level: a malformed row is skipped, not returned as garbage).
const cw = new CloudWatchClient({});
// One Secrets Manager client per cold start. Used only by the project
// credentials LIST route below (#158 PR-β A1). The Lambda's IAM grant
// is scoped to `wf/projects/*` so the client cannot describe anything
// outside the trust boundary.
const sm = new SecretsManagerClient({});

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;
const POST_KINDS: readonly PostKind[] = ["reflection", "friction", "improvement", "observation"];

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
    // Projects path uses a non-greedy `{id}` param. The greedy `{id+}`
    // proxy CANNOT be used here: a greedy parent (`GET /projects/{id+}`)
    // conflicts with its child routes (`/projects/{id}/members` etc.) on
    // HTTP API import — API Gateway silently drops the children (no
    // warning), so they 404 in the live API even though CloudFormation
    // reports the stack IN_SYNC (drift detection doesn't compare routes
    // inside an ApiGatewayV2::Api body). Project ids that contain `/`
    // (e.g. `self/ren`) are percent-encoded by the client
    // (encodeProjectId = encodeURIComponent), so they still match a single
    // `{id}` segment; decodeURIComponent restores the raw id here.
    const rawProjectId = event.pathParameters?.id;
    const projectId = rawProjectId ? decodeURIComponent(rawProjectId) : undefined;
    const postId = event.pathParameters?.post_id;
    // Talent-messaging threads (Epic-013 Story 1) share the `{id}` path
    // param name with projects; thread ids are bare ULIDs (no `/`), so the
    // decodeURIComponent on rawProjectId is identity for them.
    const threadId = event.pathParameters?.id;

    if (routeKey === "GET /agents") return listAgents(event);
    if (routeKey === "GET /skills") return listSkills(event);
    if (routeKey === "GET /skills/{name}" && skillName) return getSkill(skillName);
    if (routeKey === "GET /agents/{slug}/deliverables" && slug) return listAgentDeliverables(slug, event);
    if (routeKey === "GET /agents/{slug}/executions" && slug) return listAgentExecutions(slug, event);
    // Phase 7 PR5 — engagements API (external-client read/write surface).
    // Portfolio is the public-facing display projection of executions filtered
    // to the calling client's project; engagements POST is the inbound write
    // path from client-side (RepoA) execution per the R-N1 amendment.
    if (routeKey === "GET /agents/{slug}/portfolio" && slug) return listAgentPortfolio(slug, event);
    if (routeKey === "POST /agents/{slug}/engagements" && slug) return await createEngagementRoute(slug, event);
    if (routeKey === "GET /agents/{slug}/recall" && slug) return getAgentRecall(slug, event);
    if (routeKey === "GET /agents/{slug}/projects" && slug) return listAgentProjects(slug);
    if (routeKey === "GET /agents/{slug}/posts" && slug) return listAgentPostsRoute(slug, event);
    if (routeKey === "GET /agents/{slug}" && slug) return getAgent(slug);
    if (routeKey === "PATCH /agents/{slug}" && slug) return patchAgent(slug, event.body);
    if (routeKey === "DELETE /agents/{slug}" && slug) return deleteAgent(slug);
    if (routeKey === "GET /projects") return listProjects(event);
    if (routeKey === "GET /projects/{id}/members" && projectId) return listProjectMembers(projectId, event);
    if (routeKey === "GET /projects/{id}/executions" && projectId) return listProjectExecutions(projectId, event);
    if (routeKey === "GET /projects/{id}/credentials" && projectId) return listProjectCredentials(projectId);
    if (routeKey === "PATCH /projects/{id}" && projectId) return patchProject(projectId, event.body);
    if (routeKey === "GET /projects/{id}" && projectId) return getProjectRoute(projectId);
    if (routeKey === "GET /feed") return listFeedRoute(event);
    if (routeKey === "GET /feed/{post_id}" && postId) return getFeedPostRoute(postId, event);
    // POST /feed is the runner's write path (Epic-011 feed-post → DDB).
    // Bearer-token auth at the handler layer (the CCR session has no
    // SigV4 creds, so AWS_IAM is not an option). `return await` so the
    // auth/validation throws route through the outer 500 mapping.
    if (routeKey === "POST /feed") return await createFeedPostRoute(event);
    // `return await` (not bare `return`) is load-bearing: bare `return Promise` lets the
    // rejection escape the outer try/catch (Promise flattening on async returns). The
    // hide_helper_not_wired throw is what relies on this for the 500-mapping contract.
    if (routeKey === "PATCH /feed/{post_id}" && postId) return await patchFeedPostRoute(postId, event);
    // Talent messaging (Epic-013). Reads are public on the CORS gate;
    // the writes (Story 2, #249) sit behind the Cognito JWT authorizer at
    // API Gateway (decision D3), so the handler trusts the caller. `await`
    // on the writes so validation throws route through the 500 mapping.
    if (routeKey === "GET /threads") return listThreadsRoute(event);
    if (routeKey === "GET /threads/{id}" && threadId) return getThreadRoute(threadId);
    if (routeKey === "POST /threads") return await createThreadRoute(event);
    if (routeKey === "POST /threads/{id}/messages" && threadId) return await sendMessageRoute(threadId, event);
    if (routeKey === "POST /threads/{id}/read" && threadId) return await markReadRoute(threadId);
    if (routeKey === "POST /threads/{id}/star" && threadId) return await setStarRoute(threadId, event);

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

// LEGACY (Epic-010 C2/C3 cutover — reconciled by Epic-012 Story 3 #216).
// Reads the legacy `AGENT#{slug}/DELIV#{ulid}` rows, whose SUCCESS-path
// writes were removed at the C2 cutover (the runner is EXEC-only on success;
// see workforce/lambdas/agent-runner/dual-write-tests.ts). The SPA's
// agent-profile activity list migrated to `GET /agents/{slug}/executions`
// (the EXEC family, GSI1) — `fetchAgentDeliverables` was removed, so this
// route has NO front-end caller. It is retained only to read historical
// DELIV rows written before the cutover. The canonical activity source is
// the EXEC ledger; do not wire new readers to this route.
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

async function getProjectRoute(rawId: string): Promise<APIGatewayProxyResultV2> {
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

// --- Issue #158 PR-β: project credentials LIST + project PATCH ---------
//
// GET /projects/{id}/credentials returns metadata for every registered
// credential type the operator has provisioned under this project's
// Secrets Manager namespace. The response body is intentionally
// metadata-only (matches the secret-leak guard from PR #137 GET) — no
// secret value ever leaves the Lambda even on this read path.
//
// The route is PUBLIC (no AWS_IAM auth) because the fields it surfaces
// (last_changed_at / last_rotated_at / created_date) are operational
// metadata that the SPA project console renders. Tightening to AWS_IAM
// is a future call if even the rotation-cadence signal turns out to be
// sensitive in some context. R-N5 alarm path (CloudWatch) is unchanged.
//
// PATCH /projects/{id} flips `status` between `active` / `archived`
// (AWS_IAM auth). This replaces "run the seed step to archive" from
// pre-Story-6 — the operator now archives from the SPA. Only `status`
// is patchable; identity fields (`project_id`, `owner_agent`,
// `created_at`) cannot be edited from the API per Epic-010 §10
// (canonical entity edits go through `workforce/projects/{id}/`).

interface CredentialMetadataView {
  credential_type: string;
  name: string;
  /** secret_arn included so the operator can deep-link to the AWS
   *  console; non-secret in the same sense the credentials-api GET
   *  surfaces it. */
  secret_arn: string;
  last_changed_at?: string;
  last_rotated_at?: string;
  created_date?: string;
}

async function listProjectCredentials(rawId: string): Promise<APIGatewayProxyResultV2> {
  const id = asProjectId(rawId);
  // Confirm the project exists so a missing project 404s instead of
  // returning an empty list (which would look like "registered but
  // nothing provisioned"). Same pattern as listProjectMembers's seed.
  const proj = await getProject(id);
  if (!proj) return reply(404, { error: "not_found", project_id: rawId });

  // Enumerate from the canonical CREDENTIAL_TYPES registry; for each
  // type try DescribeSecret on the project-scoped path. Missing keys
  // are omitted from the response (the SPA renders them as "not yet
  // provisioned" affordances). Concurrency-bounded by the small N
  // (today: 4 types); a future > 20 would want batching.
  const results = await Promise.all(
    [...CREDENTIAL_TYPES].sort().map(async (type): Promise<CredentialMetadataView | undefined> => {
      const name = `wf/projects/${id}/${type}`;
      try {
        const res = await sm.send(new DescribeSecretCommand({ SecretId: name }));
        return {
          credential_type: type,
          name,
          secret_arn: res.ARN ?? "",
          last_changed_at: res.LastChangedDate?.toISOString(),
          last_rotated_at: res.LastRotatedDate?.toISOString(),
          created_date: res.CreatedDate?.toISOString(),
        };
      } catch (err) {
        if (err instanceof SmResourceNotFoundException) return undefined;
        // Re-throw on any other error so it bubbles to the outer
        // handler's 500 (W-4 fail-loud). A throttle / access-denied
        // would be silently swallowed as "no metadata" without this.
        throw err;
      }
    }),
  );

  const items = results.filter((v): v is CredentialMetadataView => v !== undefined);
  return reply(200, { items });
}

const PATCHABLE_PROJECT_FIELDS = ["status"] as const;
type PatchableProjectField = (typeof PATCHABLE_PROJECT_FIELDS)[number];

async function patchProject(
  rawId: string,
  body: string | undefined,
): Promise<APIGatewayProxyResultV2> {
  if (!body) return reply(400, { error: "missing_body" });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return reply(400, { error: "invalid_json" });
  }

  const invalid: string[] = [];
  const patch: Partial<Record<PatchableProjectField, unknown>> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if ((PATCHABLE_PROJECT_FIELDS as readonly string[]).includes(k)) {
      patch[k as PatchableProjectField] = v;
    } else {
      invalid.push(k);
    }
  }
  if (invalid.length > 0) {
    return reply(400, {
      error: "non_patchable_fields",
      detail: `the following fields cannot be PATCHed via this API (edit workforce/projects/{id}/project.json + seed instead): ${invalid.join(", ")}`,
      patchable: [...PATCHABLE_PROJECT_FIELDS],
    });
  }
  if (Object.keys(patch).length === 0) {
    return reply(400, { error: "empty_patch" });
  }

  const id = asProjectId(rawId);
  const existing = await getProject(id);
  if (!existing) return reply(404, { error: "not_found", project_id: rawId });

  if ("status" in patch) {
    const next = patch.status;
    if (next === "archived") {
      // No-op if already archived — preserves the original
      // `archived_at` timestamp.
      if (existing.status === "active") {
        await archiveProject(id);
      }
    } else if (next === "active") {
      // unarchive() is itself idempotent on already-active rows.
      await unarchiveProject(id);
    } else {
      return reply(400, {
        error: "invalid_status",
        detail: `status must be 'active' or 'archived' (got ${JSON.stringify(next)})`,
      });
    }
  }

  const updated = await getProject(id);
  return reply(200, updated ? toProjectApiView(updated) : { error: "vanished" });
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

// Epic-010 ROADMAP §Status-transition criterion 3 (C3): the agent
// profile page must read execution history from the EXEC row family
// (`PROJECT#{id}/EXEC#{ulid}`) via the GSI1 `AGENT#{slug}` partition
// rather than from the legacy `AGENT#{slug}/RUN#{ulid}` +
// `AGENT#{slug}/DELIV#{ulid}` rows. This route is the read path.
//
// Uses `listExecutions({agent_slug})` which queries GSI1 directly —
// one round-trip per agent regardless of how many projects they've
// worked in. Range push-down via `from`/`to` is supported but unused
// by the SPA's "recent 20" use case today.
//
// The route is PUBLIC (no AWS_IAM auth) — matches the existing
// `GET /agents/{slug}/deliverables` read pattern, and the EXEC row
// fields surfaced here (skill / status / started_at / ended_at /
// artifact_ref uri-shape) are no more sensitive than the deliverable
// metadata that endpoint already exposes. The Cognito-on-hostname gate
// in front of the SPA is the operator-vs-anonymous boundary.
//
// NB: this route does NOT yet surface `notion_page_url` / `pr_url` —
// those fields live on the legacy DELIV row family and weren't
// promoted to EXEC by Story 1-B's dual-write. A separate follow-up
// (FU-NEW-G filed alongside this PR) extends the runner to write
// those onto EXEC. Until then the SPA renders the artifact_ref URI
// in place of the deeplink — documented regression.
async function listAgentExecutions(
  slug: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const qs = event.queryStringParameters ?? {};
  const limit = Math.min(
    Math.max(parseInt(qs.limit ?? `${PAGE_SIZE_DEFAULT}`, 10) || PAGE_SIZE_DEFAULT, 1),
    PAGE_SIZE_MAX,
  );
  const status = qs.status as "ok" | "throw" | "skipped" | "failed_artefact_redaction" | undefined;
  const rows = await listExecutions({
    agent_slug: slug,
    from: qs.from,
    to: qs.to,
    status,
    limit,
  });
  // Newest-first matches the SPA's render order + the project-executions
  // route (PR #140 / agents-api precedent). ULID sort keys encode time,
  // but the canonical "when did this run start" is the `started_at`
  // attribute — sort on that.
  rows.sort((a, b) => b.started_at.localeCompare(a.started_at));
  const items = rows.slice(0, limit).map((r) => ({
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

/**
 * Epic-012 Story 1 — `GET /agents/{slug}/recall?q=&k=`.
 *
 * Inspection surface over the SAME `recall()` code path the agent-runner
 * uses to ground a run. Lets the operator (and a future chat UI) see what an
 * agent would retrieve for a query. `q` is required (semantic recall);
 * optional `k`, `project`, `skill`, `from`, `to`, `status` narrow the set.
 *
 * Caller-scoped to `{slug}` (an agent recalls its own history; Epic-012 Q2).
 * The membership trust boundary is enforced inside `recall()` itself.
 */
async function getAgentRecall(
  slug: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const qs = event.queryStringParameters ?? {};
  const query = (qs.q ?? "").trim();
  if (!query) return reply(400, { error: "missing_query", detail: "q= is required" });
  const k = Math.min(
    Math.max(parseInt(qs.k ?? `${PAGE_SIZE_DEFAULT}`, 10) || PAGE_SIZE_DEFAULT, 1),
    PAGE_SIZE_MAX,
  );
  const status = qs.status as ExecutionRow["status"] | undefined;
  const results: RecallResult[] = await recall({
    caller_agent_slug: slug,
    query,
    k,
    embedding_project_id: qs.project ? asProjectId(qs.project) : undefined,
    project: qs.project ? asProjectId(qs.project) : undefined,
    skill: qs.skill,
    from: qs.from,
    to: qs.to,
    status,
  });
  const items = results.map(({ row, score }) => ({
    exec_ulid: row.sk.replace(/^EXEC#/, ""),
    project_id: row.project_id,
    agent_slug: row.agent_slug,
    skill_name: row.skill_name,
    skill_version: row.skill_version,
    started_at: row.started_at,
    ended_at: row.ended_at,
    status: row.status,
    artifact_ref: row.artifact_ref,
    error: row.error,
    score,
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

// ----- Feed (Epic-011 Story 5 — #132) -----
//
// Four endpoints layered onto wf-agents-api:
//   GET   /feed                 reverse-chrono across all agents
//   GET   /feed/{post_id}       one post + full body (S3 hydrated when
//                               the body exceeds the inline `body_preview`)
//   GET   /agents/{slug}/posts  per-agent stream — same shape as /feed
//                               but partition-scoped
//   PATCH /feed/{post_id}       operator-only hide; requires AWS_IAM at
//                               API GW. Body is `{visibility: "hidden",
//                               reason: string}`; empty `reason` → 400.
//
// Auth posture (per Dario B3 closure on PR #123 + Epic-010 §10 pattern):
//   - GET endpoints: public on a CORS gate that admits only the
//     `workforce.kohuehara.xyz` origin. The CORS allowlist is enforced at
//     API GW (CorsConfiguration.AllowOrigins, set in the SAM template).
//   - PATCH /feed/{post_id}: AWS_IAM authorizer (operator's `aws-vault`
//     credentials). Signature validation happens at API GW before the
//     Lambda is invoked, so the handler can assume an authenticated
//     principal when this route fires.
//
// Pagination cursor: opaque base64url-encoded DDB LastEvaluatedKey. Same
// shape as `scanPrefix` / projects routes — see shared/ddb.ts.
//
// Hide-helper sequencing (per task brief): the PATCH route calls
// `hidePost(...)` from shared/post.ts. That helper is a stub in this PR
// (throws `hide_helper_not_wired`) — Story 4 (#131) fills it in. The
// rejection test below locks the stub so the route does not silently
// no-op after Story 4 lands a different signature.

function parsePostKindFilter(qs: Record<string, string | undefined>): PostKind | undefined {
  if (!qs.kind) return undefined;
  return POST_KINDS.includes(qs.kind as PostKind) ? (qs.kind as PostKind) : undefined;
}

function parsePageSize(qs: Record<string, string | undefined>): number {
  return Math.min(
    Math.max(parseInt(qs.page_size ?? `${PAGE_SIZE_DEFAULT}`, 10) || PAGE_SIZE_DEFAULT, 1),
    PAGE_SIZE_MAX,
  );
}

async function listFeedRoute(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const qs = event.queryStringParameters ?? {};
  const page = await listFeed({
    cursor: qs.cursor,
    pageSize: parsePageSize(qs),
    kind: parsePostKindFilter(qs),
    agentSlug: qs.agent_slug,
    from: qs.from,
    to: qs.to,
    includeHidden: qs.include_hidden === "true",
  });
  return reply(200, {
    posts: page.items.map(toFeedPostApiView),
    cursor: page.cursor,
  });
}

async function listAgentPostsRoute(
  slug: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const qs = event.queryStringParameters ?? {};
  const page = await listAgentPosts({
    agentSlug: slug,
    cursor: qs.cursor,
    pageSize: parsePageSize(qs),
    kind: parsePostKindFilter(qs),
    from: qs.from,
    to: qs.to,
    includeHidden: qs.include_hidden === "true",
  });
  return reply(200, {
    posts: page.items.map(toFeedPostApiView),
    cursor: page.cursor,
  });
}

async function getFeedPostRoute(
  postId: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  // `GET /feed/{post_id}` doesn't carry agent_slug in the URL — the SPA
  // hydrates from the list response which already knows the slug, so the
  // detail endpoint accepts it as a query string. (Alternative shapes
  // considered: a global GSI on `gsi4pk=POST#{ulid}` — rejected as a
  // second index for a low-frequency access pattern; a `/agents/{slug}
  // /posts/{post_id}` mirror — rejected as a duplicate of the list shape
  // for a detail view. The query-string slug keeps the URL flat and
  // matches Epic-011 §6's "/feed/{post_id}" canonical surface.)
  const qs = event.queryStringParameters ?? {};
  const slug = qs.agent_slug;
  if (!slug) {
    return reply(400, {
      error: "missing_agent_slug",
      detail: "GET /feed/{post_id} requires ?agent_slug= because POST rows are partitioned by AGENT#",
    });
  }
  const row = await getPost(slug, postId);
  if (!row) return reply(404, { error: "not_found", post_id: postId, agent_slug: slug });
  // Hidden-post handling on detail: surface the row but include the
  // visibility badge so the operator UI knows. The default list endpoints
  // already filter hidden out — the detail path preserves the audit trail
  // (Epic-011 Story 4 / #131 hide primitive is non-destructive).
  const view = toFeedPostApiView(row);
  let body: string;
  // Skip the S3 round-trip when the entire body fit into body_preview
  // (≤320 chars, per data-model.md). Most posts at 280–600 chars do
  // NOT fit, so the round-trip is the common case; cheap-path the rest.
  if (row.body_preview.length < 320) {
    body = row.body_preview;
  } else {
    body = await fetchPostBody(row.body_ref);
  }
  const detail: FeedPostDetailView = { ...view, body };
  return reply(200, detail);
}

// --- Talent messaging (Epic-013 Story 1, #248) --------------------------

/** Parse the `?filter=` query param for the inbox. Unknown values are
 *  ignored (no filter), matching the lenient posture of the feed filters. */
function parseThreadFilter(qs: Record<string, string | undefined>): ThreadFilter | undefined {
  if (qs.filter === "unread" || qs.filter === "starred") return qs.filter;
  return undefined;
}

/**
 * GET /threads — the operator's inbox, reverse-chronological. Single GSI4
 * partition query (`INBOX#operator`). Reads only the operator's inbox in
 * v1 (operator↔talent); a per-talent inbox view is a Story 2+ concern.
 */
async function listThreadsRoute(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const qs = event.queryStringParameters ?? {};
  const page = await listInbox({
    slug: MESSAGING_OPERATOR_ID,
    cursor: qs.cursor,
    pageSize: parsePageSize(qs),
    filter: parseThreadFilter(qs),
  });
  return reply(200, {
    threads: page.items.map(toThreadSummaryView),
    cursor: page.cursor,
  });
}

/**
 * GET /threads/{id} — one thread with its messages, oldest-first, each
 * body resolved (inline preview or S3 hydration). 404 when the thread has
 * no META row.
 */
async function getThreadRoute(threadId: string): Promise<APIGatewayProxyResultV2> {
  const detail = await getThreadDetail(threadId);
  if (!detail) return reply(404, { error: "not_found", thread_id: threadId });
  return reply(200, detail);
}

/** Parse a JSON request body, or return undefined for the 400 path. */
function parseJsonBody(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * POST /threads — operator starts a thread. Body:
 *   { participants: string[], body: string, group_label?: string }
 * Auth: Cognito JWT at the gateway (decision D3); the author is always the
 * operator in v1.
 */
async function createThreadRoute(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body = parseJsonBody(event.body);
  if (!body) return reply(400, { error: "invalid_json" });
  const participants = body.participants;
  const messageBody = body.body;
  if (!Array.isArray(participants) || participants.length === 0 || !participants.every((p) => typeof p === "string")) {
    return reply(400, { error: "invalid_participants" });
  }
  if (typeof messageBody !== "string") return reply(400, { error: "invalid_body" });
  try {
    const out = await createThread({
      participants: participants as string[],
      body: messageBody,
      from: MESSAGING_OPERATOR_ID,
      ...(typeof body.group_label === "string" ? { group_label: body.group_label } : {}),
    });
    return reply(201, out);
  } catch (err) {
    return reply(400, { error: "create_failed", detail: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * POST /threads/{id}/messages — operator appends a message. Body:
 *   { body: string }
 * The reply TASK that wakes the addressed talent is enqueued in Story 3.
 */
async function sendMessageRoute(
  threadId: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const body = parseJsonBody(event.body);
  if (!body) return reply(400, { error: "invalid_json" });
  if (typeof body.body !== "string") return reply(400, { error: "invalid_body" });
  try {
    const out = await sendMessage({ thread_id: threadId, from: MESSAGING_OPERATOR_ID, body: body.body });
    return reply(201, out);
  } catch (err) {
    return reply(400, { error: "send_failed", detail: err instanceof Error ? err.message : String(err) });
  }
}

/** POST /threads/{id}/read — clear the operator's unread on this thread. */
async function markReadRoute(threadId: string): Promise<APIGatewayProxyResultV2> {
  await markThreadRead(threadId, MESSAGING_OPERATOR_ID);
  return reply(200, { ok: true });
}

/** POST /threads/{id}/star — toggle/set the operator star. Body: { starred: boolean }. */
async function setStarRoute(
  threadId: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const body = parseJsonBody(event.body);
  if (!body || typeof body.starred !== "boolean") return reply(400, { error: "invalid_starred" });
  await setThreadStar(threadId, body.starred);
  return reply(200, { ok: true, starred: body.starred });
}

/**
 * POST /feed — the runner's authenticated write path. Validates the
 * bearer token, then writes the body+row via createPost() (which runs
 * the server-side W-1 editorial guards). Body shape:
 *   { agent_slug, kind, body, references?, skill_version? }
 */
async function createFeedPostRoute(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const authed = await validateFeedWriteBearer(event);
  if (!authed) return reply(401, { error: "unauthorized", detail: "POST /feed requires a valid feed-write bearer token." });

  if (!event.body) return reply(400, { error: "missing_body" });
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(event.body) as Record<string, unknown>;
  } catch {
    return reply(400, { error: "invalid_json" });
  }

  const agent_slug = parsed.agent_slug;
  const kind = parsed.kind;
  const body = parsed.body;
  if (typeof agent_slug !== "string" || agent_slug.length === 0) {
    return reply(400, { error: "missing_agent_slug" });
  }
  if (typeof kind !== "string") {
    return reply(400, { error: "missing_kind" });
  }
  if (typeof body !== "string") {
    return reply(400, { error: "missing_body_text" });
  }
  const references = Array.isArray(parsed.references)
    ? parsed.references.filter((r): r is string => typeof r === "string")
    : [];
  const skill_version = typeof parsed.skill_version === "string" ? parsed.skill_version : undefined;

  try {
    const row = await createPost({ agent_slug, kind, body, references, skill_version });
    return reply(201, {
      post_id: row.sk.replace(/^POST#/, ""),
      agent_slug: row.agent_slug,
      posted_at: row.posted_at,
      kind: row.kind,
    });
  } catch (err) {
    // createPost throws on the W-1 editorial guards (empty_body,
    // body_over_hard_cap, invalid_kind, llm_artefact_in_head,
    // too_many_references). Map those to 422 so the caller can
    // distinguish "your content failed validation" from a 500.
    const msg = err instanceof Error ? err.message : String(err);
    const validationFailure = /createPost: (empty_body|body_over_hard_cap|invalid_kind|llm_artefact_in_head|too_many_references)/.test(msg);
    if (validationFailure) {
      return reply(422, { error: "post_rejected", detail: msg.replace(/^createPost: /, "") });
    }
    throw err; // genuine error → outer 500
  }
}

/**
 * Validate the `Authorization: Bearer <token>` header against the
 * feed-write secret. Constant-time compare. Caches the secret value for
 * the Lambda's warm lifetime (rotation requires a cold start, acceptable
 * for a capability token). Returns false on any miss (missing header,
 * wrong scheme, mismatch, secret unavailable).
 */
async function validateFeedWriteBearer(event: APIGatewayProxyEventV2): Promise<boolean> {
  const headers = event.headers ?? {};
  const raw = headers.authorization ?? headers.Authorization;
  if (!raw || !raw.startsWith("Bearer ")) return false;
  const presented = raw.slice("Bearer ".length).trim();
  if (presented.length === 0) return false;

  let expected = _feedWriteTokenCache;
  if (!expected) {
    try {
      const out = await sm.send(new GetSecretValueCommand({ SecretId: FEED_WRITE_TOKEN_SECRET }));
      if (!out.SecretString) return false;
      const v = JSON.parse(out.SecretString) as { token?: unknown };
      if (typeof v.token !== "string" || v.token.length === 0) return false;
      expected = v.token;
      _feedWriteTokenCache = expected;
    } catch {
      return false;
    }
  }

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function patchFeedPostRoute(
  postId: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  // AWS_IAM signature validation happens at API GW (Auth.Authorizer:
  // AWS_IAM in the SAM template). If the request reaches this handler,
  // the signature is valid; the principal is in `requestContext.authorizer.iam`.
  const qs = event.queryStringParameters ?? {};
  const slug = qs.agent_slug;
  if (!slug) {
    return reply(400, {
      error: "missing_agent_slug",
      detail: "PATCH /feed/{post_id} requires ?agent_slug= because POST rows are partitioned by AGENT#",
    });
  }

  if (!event.body) return reply(400, { error: "missing_body" });
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(event.body) as Record<string, unknown>;
  } catch {
    return reply(400, { error: "invalid_json" });
  }

  // v1 only supports `visibility=hidden` as the patch payload. Any other
  // shape is rejected to keep the audit trail simple.
  if (parsed.visibility !== "hidden") {
    return reply(400, {
      error: "unsupported_visibility",
      detail: "PATCH /feed/{post_id} v1 only supports visibility=\"hidden\".",
    });
  }

  const reason = parsed.reason;
  if (typeof reason !== "string" || reason.trim() === "") {
    return reply(400, {
      error: "missing_reason",
      detail: "PATCH /feed/{post_id} requires a non-empty `reason` field — it is stored on the audit EXEC row.",
    });
  }

  // Resolve the operator principal. API GW's IAM authorizer puts the
  // signing identity under requestContext.authorizer.iam — we surface
  // the user ARN's tail as the operator slug for the audit row. Anything
  // missing means the AWS_IAM gate let an unauthenticated request
  // through, which is a misconfig — fall back to `_operator` rather than
  // throwing (W-4 is preserved by the hide_helper_not_wired throw below).
  type IamCtx = { userArn?: string; userId?: string };
  const iamRaw = (event.requestContext as unknown as { authorizer?: { iam?: IamCtx } }).authorizer?.iam;
  const operator = iamRaw?.userArn
    ? iamRaw.userArn.split("/").pop() ?? "_operator"
    : "_operator";

  // Story 4 (#131) wired the real implementation. The helper writes the
  // audit EXEC row to PROJECT#self/{operator} BEFORE flipping visibility
  // (W-2 ordering). If anything fails, the outer try/catch returns 500.
  await hidePost({
    agent_slug: slug,
    post_id: postId,
    reason: reason.trim(),
    operator,
  });

  return reply(200, { post_id: postId, agent_slug: slug, visibility: "hidden" });
}

// --- Phase 7 PR5: Engagements API ----------------------------------------
//
// Business-shape over the existing PROJECT#{id}/EXEC#* ledger:
//
//   GET  /agents/{slug}/portfolio?project_id=X   list past engagement records
//                                                  filtered to the calling
//                                                  client's project. Each item
//                                                  is one completed engagement
//                                                  (= one EXEC row in the
//                                                  business-vocabulary view).
//
//   POST /agents/{slug}/engagements              register a new engagement
//                                                  record from a client-side
//                                                  (RepoA) execution. Bearer-
//                                                  token auth. The body's
//                                                  project_id determines the
//                                                  PROJECT#{id}/EXEC#* row
//                                                  partition.
//
// Per the R-N1 amendment (governance.md §4 R-N1 exception (b)):
// client-side execution is best-effort on audit, cost tracking, and
// persona stability — silent loss is an accepted failure mode at single-
// operator scale (C-3). The shape here matches that posture: a single
// shared bearer token, client-supplied project_id, no auto-membership
// enforcement beyond what appendExecution() already gates (cross-project
// denial throws if the agent isn't a project member).

interface EngagementView {
  engagement_id: string;
  agent_slug: string;
  project_id: string;
  skill_name: string;
  skill_version: string;
  started_at: string;
  ended_at: string;
  status: ExecStatus;
  /**
   * L2-2: where the LLM call ran. Defaults to `lambda` on legacy rows
   * (pre-L2-2 EXEC rows have no attribute; we surface `lambda` as the
   * canonical default per the data-model amendment). Lets clients
   * (and the portfolio UI) tell Lambda-side and client-side engagements
   * apart for attribution / analytics.
   */
  execution_surface: ExecutionSurface;
  summary: string;
  artifact?: ArtifactRef;
  error?: string;
}

function toEngagementView(row: ExecutionRow): EngagementView {
  return {
    engagement_id: row.sk.replace(/^EXEC#/, ""),
    agent_slug: row.agent_slug,
    project_id: row.project_id,
    skill_name: row.skill_name,
    skill_version: row.skill_version,
    started_at: row.started_at,
    ended_at: row.ended_at,
    status: row.status,
    // Legacy rows (pre-L2-2) are Lambda-side by construction — the
    // client-side write path is what introduced the field.
    execution_surface: row.execution_surface ?? "lambda",
    summary: row.artifact_ref?.summary ?? "",
    artifact: row.artifact_ref,
    error: row.error,
  };
}

async function listAgentPortfolio(
  slug: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const qs = event.queryStringParameters ?? {};
  const projectId = qs.project_id;
  if (!projectId) {
    return reply(400, {
      error: "missing_project_id",
      detail:
        "GET /agents/{slug}/portfolio requires ?project_id= — portfolio is per-client (the dispatch agency only shows you the work the agent did *for you*).",
    });
  }
  const limit = Math.min(
    Math.max(parseInt(qs.limit ?? `${PAGE_SIZE_DEFAULT}`, 10) || PAGE_SIZE_DEFAULT, 1),
    PAGE_SIZE_MAX,
  );
  const status = qs.status as ExecStatus | undefined;
  const rows = await listExecutions({
    agent_slug: slug,
    from: qs.from,
    to: qs.to,
    status,
    limit: PAGE_SIZE_MAX, // upper-bound the GSI1 fetch, then post-filter
  });
  const filtered = rows.filter((r) => r.project_id === projectId);
  filtered.sort((a, b) => b.started_at.localeCompare(a.started_at));
  return reply(200, { items: filtered.slice(0, limit).map(toEngagementView) });
}

async function createEngagementRoute(
  slug: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const authed = await validateEngagementWriteBearer(event);
  if (!authed) return reply(401, { error: "unauthorized" });

  if (!event.body) return reply(400, { error: "missing_body" });
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(event.body) as Record<string, unknown>;
  } catch {
    return reply(400, { error: "invalid_json" });
  }

  // Required fields. The client (RepoA) computes timestamps because the
  // execution happened on their side; we trust them for audit purposes
  // per the R-N1(b) "best-effort" posture.
  const required: Array<keyof typeof parsed> = [
    "project_id",
    "skill_name",
    "skill_version",
    "started_at",
    "ended_at",
    "status",
  ];
  const missing = required.filter((k) => parsed[k] === undefined);
  if (missing.length > 0) {
    return reply(400, { error: "missing_fields", missing });
  }
  const projectId = parsed.project_id;
  if (typeof projectId !== "string") {
    return reply(400, { error: "invalid_project_id" });
  }
  const status = parsed.status;
  if (status !== "ok" && status !== "throw" && status !== "skipped" && status !== "failed_artefact_redaction") {
    return reply(400, { error: "invalid_status", detail: "status must be one of ok|throw|skipped|failed_artefact_redaction" });
  }

  // Validate the optional artifact shape if present.
  const rawArtifact = parsed.artifact;
  let artifactRef: ArtifactRef | undefined;
  if (rawArtifact !== undefined && rawArtifact !== null) {
    if (typeof rawArtifact !== "object") {
      return reply(400, { error: "invalid_artifact" });
    }
    const a = rawArtifact as Record<string, unknown>;
    if (
      typeof a.uri !== "string" ||
      typeof a.content_hash !== "string" ||
      typeof a.content_type !== "string" ||
      typeof a.size_bytes !== "number" ||
      typeof a.summary !== "string"
    ) {
      return reply(400, {
        error: "invalid_artifact",
        detail: "artifact requires {uri, content_hash, content_type, size_bytes, summary}",
      });
    }
    artifactRef = {
      uri: a.uri,
      content_hash: a.content_hash,
      content_type: a.content_type,
      size_bytes: a.size_bytes,
      summary: a.summary.slice(0, 512),
    };
  }

  // ULID-shaped; client-supplied is fine but we generate if missing so
  // the response always carries an engagement_id the client can follow up
  // on. Time-monotonic ULIDs aren't required for the engagements path —
  // a random ULID-shaped string is sufficient for the partition key.
  const exec_ulid =
    typeof parsed.engagement_id === "string" && parsed.engagement_id.length > 0
      ? (parsed.engagement_id as string)
      : generateUlid();

  try {
    const row = await appendExecution({
      project_id: asProjectId(projectId),
      agent_slug: slug as AgentMetaRow["slug"],
      exec_ulid,
      skill_name: parsed.skill_name as string,
      skill_version: parsed.skill_version as string,
      started_at: parsed.started_at as string,
      ended_at: parsed.ended_at as string,
      status: status as ExecStatus,
      used_credential_types:
        Array.isArray(parsed.used_credential_types) && parsed.used_credential_types.every((x) => typeof x === "string")
          ? (parsed.used_credential_types as string[])
          : undefined,
      inputs_hash: typeof parsed.inputs_hash === "string" ? parsed.inputs_hash : undefined,
      artifact_ref: artifactRef,
      // This single write surface records every off-Lambda execution. The
      // optional `execution_surface` says which produced it: `ccr` for the
      // generic CCR agent-runner routine's per-task write-back (ADR-0005
      // item 5 — the framework activity ledger), or `client` (default) for an
      // external R-N1(b) engagement POST. Missing/invalid → `client`, the
      // original engagement behaviour. (`lambda` is the retired runner and is
      // not accepted from the wire.)
      execution_surface: parsed.execution_surface === "ccr" ? "ccr" : "client",
      error: typeof parsed.error === "string" ? parsed.error : undefined,
    });
    return reply(201, { engagement: toEngagementView(row) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("cross-project denial")) {
      return reply(403, { error: "not_a_member", detail: msg });
    }
    if (msg.startsWith("invalid project_id")) {
      return reply(400, { error: "invalid_project_id", detail: msg });
    }
    throw err;
  }
}

// Lightweight ULID-shaped id generator. Crockford base32, 26 chars, no
// time monotonicity guarantee — sufficient for an EXEC row's partition
// key on a write that already carries client-supplied started_at.
function generateUlid(): string {
  const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let out = "";
  for (let i = 0; i < 26; i++) {
    out += ALPHABET[Math.floor(Math.random() * 32)];
  }
  return out;
}

/**
 * Validate the engagement-write bearer token. Mirrors the
 * validateFeedWriteBearer pattern: constant-time compare, cached for
 * Lambda warm lifetime. Returns false on any miss — handler maps to 401.
 */
async function validateEngagementWriteBearer(
  event: APIGatewayProxyEventV2,
): Promise<boolean> {
  const headers = event.headers ?? {};
  const raw = headers.authorization ?? headers.Authorization;
  if (!raw || !raw.startsWith("Bearer ")) return false;
  const presented = raw.slice("Bearer ".length).trim();
  if (presented.length === 0) return false;

  // Primary path (ADR-0005): a short-lived engagement-write token minted in
  // DynamoDB — by the orchestrator per fire (cron), or by an operator-
  // credentialed session via workforce/scripts/record-engagement.mjs
  // (interactive). No static secret needed for either.
  try {
    if (await isValidEngagementToken(presented)) return true;
  } catch {
    // DDB read error — fall through to the static path rather than 500.
  }

  // Fallback: the long-lived capability token external (Phase 7) clients hold.
  let expected = _engagementWriteTokenCache;
  if (!expected) {
    try {
      const out = await sm.send(new GetSecretValueCommand({ SecretId: ENGAGEMENT_WRITE_TOKEN_SECRET }));
      if (!out.SecretString) return false;
      const v = JSON.parse(out.SecretString) as { token?: unknown };
      if (typeof v.token !== "string" || v.token.length === 0) return false;
      expected = v.token;
      _engagementWriteTokenCache = expected;
    } catch {
      return false;
    }
  }

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
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
