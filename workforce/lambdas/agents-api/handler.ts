// wf-agents-api Lambda handler.
// Routes:
//   GET    /agents                          list (paginated, filterable)
//   POST   /agents                          create an agent — validated + audited (IAM-auth at API GW; ADR-0007 full CRUD)
//   GET    /stats                           dashboard aggregate — EXEC-ledger roll-up (runs/deliv/heat/trace; duration, not cost)
//   GET    /agents/{slug}                   single agent
//   GET    /agents/{slug}/executions        canonical activity ledger — EXEC rows via GSI1 (the agent-profile task log)
//   GET    /agents/{slug}/projects          projects this agent is an active member of
//   GET    /agents/{slug}/posts             per-agent activity feed (Epic-011 Story 5)
//   GET    /agents/{slug}/portfolio         per-client engagement records (Phase 7 PR5; ?project_id= required)
//   POST   /agents/{slug}/engagements       register a client-side engagement record (Phase 7 PR5; Bearer auth)
//   GET    /agents/{slug}/recall            semantic recall over the agent's ledger (?q=&k=; Epic-012 Story 1)
//   PATCH  /agents/{slug}                   config writes — operational + identity fields, validated + audited (IAM-auth at API GW; ADR-0007)
//   DELETE /agents/{slug}                   soft delete -> archived=true (IAM-auth at API GW)
//   GET    /agents/{slug}/audit             config-mutation audit trail, newest-first (ADR-0007)
//   GET    /docs/openapi                    OpenAPI 3.0 spec (YAML; source ./openapi.ts)
//   GET    /docs/api                        rendered API reference (Redoc HTML)
//   GET    /skills                          list of skills (paginated, filterable)
//   GET    /skills/{name}                   single skill
//   PATCH  /skills/{name}                   judgment-config writes — validated + audited (IAM-auth at API GW; ADR-0008)
//   GET    /skills/{name}/audit             skill config-mutation audit trail, newest-first (ADR-0008)
//   GET    /projects                        list of projects (paginated, ?include_self=)
//   GET    /projects/{id}                  single project META + member/exec summary
//   GET    /projects/{id}/members          active members (?include_revoked=true for audit)
//   GET    /projects/{id}/executions       ledger (paginated, ?from=&to=&status=&agent=&skill=)
//   GET    /feed                            workforce activity feed, reverse-chrono (Epic-011 Story 5)
//   GET    /feed/{post_id}                  single post + full body (Epic-011 Story 5)
//   PATCH  /feed/{post_id}                  hide a post (IAM-auth at API GW; Epic-011 Story 5)
//   GET    /threads                         operator inbox, reverse-chrono (Epic-013 Story 1; ?cursor=&page_size=&filter=unread|starred)
//   GET    /threads/{id}                    single thread + messages, S3-hydrated bodies (Epic-013 Story 1)
//   POST   /threads                         operator starts a thread (Epic-013 Story 2; AWS_IAM at GW)
//   POST   /threads/{id}/messages           operator appends a message (Epic-013 Story 2; AWS_IAM at GW)
//   POST   /threads/{id}/read               clear operator unread (Epic-013 Story 2; AWS_IAM at GW)
//   POST   /threads/{id}/star               set operator star (Epic-013 Story 2; AWS_IAM at GW)
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
  IDENTITY_PATCHABLE_FIELDS,
  validateAgentCreate,
  validateBudgetOverride,
  validateIdentityPatch,
  type ConfigViolation,
} from "../shared/agent-config.js";
import {
  appendAgentAudit,
  diffChanges,
  listAgentAudit,
  type AgentAuditKind,
} from "../shared/agent-audit.js";
import {
  type SkillMetaRow,
  skillPk,
  toSkillApiView,
} from "../shared/skill-row.js";
import {
  SKILL_PATCHABLE_FIELDS,
  validateSkillPatch,
  type SkillConfigViolation,
} from "../shared/skill-config.js";
import { appendSkillAudit, listSkillAudit } from "../shared/skill-audit.js";
import {
  ConditionalCheckFailedException,
  conditionalPutItem,
  getItem,
  queryBySkPrefix,
  scanAllPrefix,
  scanPrefix,
  updateOperational,
} from "../shared/ddb.js";
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
import {
  type PerfLifecycleRow,
  type PerfPrRow,
  composeSeries,
  perfPk,
} from "../shared/performance.js";
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
  BODY_PREVIEW_MAX_CHARS,
  createPost,
  fetchPostBody,
  getPost,
  hidePost,
  listAgentPosts,
  listFeed,
  toFeedPostApiView,
  toFeedPostListView,
  type FeedPostDetailView,
  type PostKind,
} from "../shared/post.js";
import {
  getThreadDetail,
  getThreadMeta,
  listInbox,
  toThreadSummaryView,
  createThread,
  sendMessage,
  markThreadRead,
  setThreadStar,
  MESSAGING_OPERATOR_ID,
  type ThreadFilter,
} from "../shared/messaging.js";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { DOCS_HTML, OPENAPI_YAML } from "./openapi.js";

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

    // API reference (single source: ./openapi.ts — keep in lockstep with
    // this route table). Public reads; YAML + a Redoc shell.
    if (routeKey === "GET /docs/openapi") {
      return { statusCode: 200, headers: { "content-type": "application/yaml; charset=utf-8" }, body: OPENAPI_YAML };
    }
    if (routeKey === "GET /docs/api") {
      return { statusCode: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: DOCS_HTML };
    }
    if (routeKey === "GET /agents") return listAgents(event);
    // ADR-0007 Decision §2 sanctions full CRUD over identity fields; this
    // is the C. IAM-auth at API GW like the other config writes. `return
    // await` so the audit-append throw routes through the 500 mapping.
    if (routeKey === "POST /agents") return await createAgent(event);
    if (routeKey === "GET /stats") return listStats(event);
    // Epic-016 Phase 2 — performance analytics (lifecycle funnel + PR
    // automation). Public read, same CORS-gated shape as /stats. Serves the
    // reducer's live lifecycle roll-up; 404 (→ client illustrative fallback)
    // until the first reducer run lands a PERF#{scope}/LIFECYCLE item.
    if (routeKey === "GET /performance") return getPerformanceRoute("workforce");
    if (routeKey === "GET /skills") return listSkills(event);
    if (routeKey === "GET /skills/{name}/audit" && skillName) return listSkillAuditRoute(skillName, event);
    if (routeKey === "GET /skills/{name}" && skillName) return getSkill(skillName);
    // ADR-0008: judgment-side skill fields are DDB-authoritative and
    // API-writable (IAM-auth). `return await` for the 500 mapping.
    if (routeKey === "PATCH /skills/{name}" && skillName) return await patchSkill(skillName, event);
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
    if (routeKey === "GET /agents/{slug}/audit" && slug) return listAgentAuditRoute(slug, event);
    if (routeKey === "GET /agents/{slug}" && slug) return getAgent(slug);
    // `return await` so the audit-append throw (W-4 fail-loud contract,
    // see shared/agent-audit.ts) routes through the outer 500 mapping.
    if (routeKey === "PATCH /agents/{slug}" && slug) return await patchAgent(slug, event);
    if (routeKey === "DELETE /agents/{slug}" && slug) return await deleteAgent(slug, event);
    if (routeKey === "GET /projects") return listProjects(event);
    if (routeKey === "GET /projects/{id}/members" && projectId) return listProjectMembers(projectId, event);
    if (routeKey === "GET /projects/{id}/executions" && projectId) return listProjectExecutions(projectId, event);
    if (routeKey === "GET /projects/{id}/credentials" && projectId) return listProjectCredentials(projectId);
    if (routeKey === "GET /projects/{id}/performance" && projectId) return getPerformanceRoute(projectId);
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
    // the writes (Story 2, #249) sit behind the AWS_IAM authorizer at
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

  // Drain the whole AGENT#/META set (scanAllPrefix), never a single
  // Limit-capped scan window: a `scanPrefix` page bounds items EVALUATED,
  // not matched, so a paged list silently drops agents outside the first
  // window (FU-PROJ-SCAN — same root cause as the projects-console
  // disappearance). The roster is ≤ a few hundred at C-3 scale.
  const agentRows = await scanAllPrefix<AgentMetaRow>("AGENT#", "META");
  const items = agentRows
    .filter((r) => wantArchived || !r.archived)
    .filter((r) => !filterStream || r.streams.includes(filterStream))
    // The inline persona prompt (ADR-0007 step 2) and the profile decks
    // (step 6a) are KBs per agent — serve them on GET /agents/{slug},
    // keep the list payload lean. Org edges stay: the directory and the
    // manifest's org graph read them from the list. `about` is the
    // build-manifest's snippet derivation moved server-side (ADR-0008
    // Decision §7) so the live-reading SPA index doesn't need N detail
    // fetches just for the card blurbs.
    .map((r) => {
      const { system_prompt: _sp, jd: _jd, identity: _id, experience: _ex, memory: _me, ...lean } = toApiView(r);
      return { ...lean, about: pickAboutSnippet(r.system_prompt ?? "") };
    });

  // next_cursor retained for response-shape stability; the set is fully
  // drained above, so it is always absent (no client-side paging needed).
  return reply(200, { items, next_cursor: undefined });
}

/** First non-heading, non-framing prose paragraph of the persona prompt —
 *  the "about" blurb. Same derivation build-agent-manifest.mjs uses for
 *  the newsletter byline manifest; duplicated here because that script is
 *  build-time JS and this is the runtime path (ADR-0008 Decision §7). */
function pickAboutSnippet(md: string): string {
  const paragraphs = md
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  for (const p of paragraphs) {
    if (p.startsWith("#")) continue;
    if (p.startsWith("You are")) continue;
    return p.replace(/\s+/g, " ").slice(0, 400);
  }
  return "";
}

async function getAgent(slug: string): Promise<APIGatewayProxyResultV2> {
  const row = await getItem<AgentMetaRow>(agentPk(slug), "META");
  if (!row) return reply(404, { error: "not_found", slug });
  return reply(200, { ...toApiView(row), about: pickAboutSnippet(row.system_prompt ?? "") });
}

// ─── GET /stats — dashboard aggregate (real EXEC-ledger roll-up) ─────────
//
// The console's /workforce landing page historically fell back to the
// static `public/workforce-mock-stats.json` because no live aggregate
// endpoint existed. This route replaces that with figures computed from
// the EXEC ledger (PROJECT#…/EXEC# via the GSI1 AGENT#{slug} partition):
// runs · MTD, deliverables · MTD, the 30-day heat strip, and the
// live-trace ribbon.
//
// It deliberately reports NO cost or token figures. Per-run token usage
// is not observable from the CCR execution path — the agent's Claude Code
// session writes its EXEC row via POST /agents/{slug}/engagements but has
// no access to its own usage, and the orchestrator's CCR fire returns
// only a session id. Inventing a dollar/token number would violate C-1
// (no fabricated truth on the operator surface), so the 4th KPI is run
// DURATION, a real proxy for compute that IS derivable from started_at /
// ended_at on every row.

const STATS_HEAT_DAYS = 30;
const STATS_RECENT_RUNS = 8;
// Per-agent ledger read cap. The roster is single-operator-small; this is
// a generous ceiling that still bounds a pathological busy partition.
const STATS_PER_AGENT_EXEC_LIMIT = 1000;

/** Collapse the 4 EXEC statuses into the 3 the console paints. `skipped`
 *  is a clean no-op (not a failure), so it renders as non-throwing. */
function mapExecStatus(s: ExecStatus): "ok" | "throw" | "dlq" {
  return s === "throw" || s === "failed_artefact_redaction" ? "throw" : "ok";
}

/** Wall-clock run duration in seconds. Guards malformed / clock-skewed
 *  rows (missing or ended<started) to 0 rather than emitting a negative. */
function execDurationSeconds(r: ExecutionRow): number {
  const started = Date.parse(r.started_at);
  const ended = Date.parse(r.ended_at);
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return 0;
  const secs = (ended - started) / 1000;
  return secs > 0 ? secs : 0;
}

async function listStats(
  _event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const now = new Date();
  const monthStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const monthStartIso = new Date(monthStartMs).toISOString();

  // 30-day heat window: one bucket per UTC day, oldest-first, ending today.
  const dayMs = 24 * 60 * 60 * 1000;
  const todayMidnightMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const heatStartMs = todayMidnightMs - (STATS_HEAT_DAYS - 1) * dayMs;
  const days: string[] = [];
  for (let i = 0; i < STATS_HEAT_DAYS; i++) {
    days.push(new Date(heatStartMs + i * dayMs).toISOString().slice(0, 10));
  }

  // Read back to whichever window opens earlier (MTD vs the 30-day heat).
  const queryFromIso = new Date(Math.min(monthStartMs, heatStartMs)).toISOString();

  // Enumerate every agent META row, paginating the scan to completion — the
  // roster is small but a silently-truncated dashboard would be worse than
  // a slightly slower one.
  const agentRows: AgentMetaRow[] = [];
  let cursor: string | undefined;
  do {
    const page = await scanPrefix<AgentMetaRow>("AGENT#", "META", 100, cursor);
    agentRows.push(...page.items);
    cursor = page.cursor;
  } while (cursor);

  interface AgentStat {
    paused: boolean;
    archived: boolean;
    last_run_at: string;
    last_run_status: "ok" | "throw" | "dlq";
    runs_this_month: number;
    deliv_this_month: number;
    compute_seconds_this_month: number;
    avg_duration_s: number;
  }
  const agents: Record<string, AgentStat> = {};
  const bySlug: Record<string, number[]> = {};
  const allRecent: Array<{
    slug: string;
    started_at: string;
    duration_s: number;
    status: "ok" | "throw" | "dlq";
    skill: string;
  }> = [];

  let totalRuns = 0;
  let totalDeliv = 0;
  let totalComputeSeconds = 0;
  let agentsRunning = 0;
  let agentsPaused = 0;
  let agentsThrowing = 0;

  for (const meta of agentRows) {
    const slug = meta.slug;
    // Archived agents stay on the roster (an all-zero heat row the operator
    // can see) but we skip the ledger read — they're retired, not idle.
    const rows = meta.archived
      ? []
      : await listExecutions({
          agent_slug: slug,
          from: queryFromIso,
          limit: STATS_PER_AGENT_EXEC_LIMIT,
        });
    // Don't depend on the caller's ordering for the "last run" pick — sort
    // newest-first explicitly (the live path already does, but the unit
    // mock doesn't, and the cost is trivial).
    rows.sort((a, b) => (a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : 0));

    const heat = new Array<number>(STATS_HEAT_DAYS).fill(0);
    let runsThisMonth = 0;
    let delivThisMonth = 0;
    let computeThisMonth = 0;

    for (const r of rows) {
      const tsMs = Date.parse(r.started_at);
      if (Number.isFinite(tsMs)) {
        const idx = Math.floor((tsMs - heatStartMs) / dayMs);
        if (idx >= 0 && idx < STATS_HEAT_DAYS) heat[idx] = (heat[idx] ?? 0) + 1;
      }
      if (r.started_at >= monthStartIso) {
        runsThisMonth += 1;
        if (r.artifact_ref) delivThisMonth += 1;
        computeThisMonth += execDurationSeconds(r);
      }
      allRecent.push({
        slug,
        started_at: r.started_at,
        duration_s: Math.round(execDurationSeconds(r)),
        status: mapExecStatus(r.status),
        skill: r.skill_name,
      });
    }

    bySlug[slug] = heat;

    const lastRow = rows[0];
    const lastRunStatus = lastRow
      ? mapExecStatus(lastRow.status)
      : meta.last_run_status === "throw" || meta.last_run_status === "dlq"
        ? "throw"
        : "ok";
    const avgDurationS = runsThisMonth > 0 ? computeThisMonth / runsThisMonth : 0;

    agents[slug] = {
      paused: meta.paused,
      archived: meta.archived,
      last_run_at: lastRow?.started_at ?? meta.last_run_at ?? "",
      last_run_status: lastRunStatus,
      runs_this_month: runsThisMonth,
      deliv_this_month: delivThisMonth,
      compute_seconds_this_month: Math.round(computeThisMonth),
      avg_duration_s: Math.round(avgDurationS),
    };

    // Status rollup — mirrors deriveStatus() on the client (throwing wins
    // over paused; archived agents count in none of the three).
    if (!meta.archived) {
      if (lastRunStatus === "throw") agentsThrowing += 1;
      else if (meta.paused) agentsPaused += 1;
      else agentsRunning += 1;
    }

    totalRuns += runsThisMonth;
    totalDeliv += delivThisMonth;
    totalComputeSeconds += computeThisMonth;
  }

  allRecent.sort((a, b) =>
    a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : 0,
  );

  return reply(200, {
    generated_at: now.toISOString(),
    month: monthStartIso.slice(0, 7),
    totals: {
      agents_running: agentsRunning,
      agents_paused: agentsPaused,
      agents_throwing: agentsThrowing,
      runs_this_month: totalRuns,
      deliv_count_this_month: totalDeliv,
      compute_seconds_this_month: Math.round(totalComputeSeconds),
      avg_duration_s: totalRuns > 0 ? Math.round(totalComputeSeconds / totalRuns) : 0,
    },
    agents,
    activity: { days, by_slug: bySlug },
    recent_runs: allRecent.slice(0, STATS_RECENT_RUNS),
  });
}

// ADR-0007: PATCH /agents/{slug} is the single write path for agent config.
// Operational fields (paused / archived / budget override) behave as before;
// identity fields (model, bindings, streams, …) became writable when the
// DDB row was promoted to the authoritative store. Every accepted mutation:
//   1. passes write-time validation (shared/agent-config.ts) — the schema
//      checks that used to run in CI plus the blast-radius guards;
//   2. appends an AUDIT# item (shared/agent-audit.ts) — the git-history
//      replacement the weekly review digest compiles.
// (The step-1..6a transitional machinery — config_owner stamping and the
// identity_hash write condition that guarded against a concurrent seed —
// retired with the seed itself in step 6b. This Lambda is the only writer.)
async function patchAgent(
  slug: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  if (!event.body) return reply(400, { error: "missing_body" });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(event.body) as Record<string, unknown>;
  } catch {
    return reply(400, { error: "invalid_json" });
  }

  const patch: Record<string, unknown> = {};
  const identityKeys: string[] = [];
  const invalid: string[] = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (PATCHABLE_FIELDS.includes(k as keyof AgentOperational)) {
      patch[k] = v;
    } else if ((IDENTITY_PATCHABLE_FIELDS as readonly string[]).includes(k)) {
      patch[k] = v;
      identityKeys.push(k);
    } else {
      invalid.push(k);
    }
  }
  if (invalid.length > 0) {
    return reply(400, {
      error: "non_patchable_fields",
      detail: `the following fields are immutable or computed and cannot be PATCHed: ${invalid.join(", ")}`,
      patchable: [...PATCHABLE_FIELDS, ...IDENTITY_PATCHABLE_FIELDS],
    });
  }
  if (Object.keys(patch).length === 0) {
    return reply(400, { error: "empty_patch" });
  }

  const existing = await getItem<AgentMetaRow>(agentPk(slug), "META");
  if (!existing) return reply(404, { error: "not_found", slug });

  const violations: ConfigViolation[] = [];
  const budgetTouched =
    "budget_monthly_usd_default" in patch || "budget_monthly_usd_override" in patch;
  const otherAgentsEffectiveBudgetUsd = budgetTouched
    ? await sumOtherEffectiveBudgets(slug)
    : 0;

  if (identityKeys.length > 0) {
    const skillOwners = await buildSkillOwnersLookup(patch.bindings);
    violations.push(
      ...validateIdentityPatch(patch, { otherAgentsEffectiveBudgetUsd, skillOwners }),
    );
  }
  if ("budget_monthly_usd_override" in patch) {
    // The override is the effective budget when set, so it is what counts
    // against the W-3 headroom (a default sent in the same PATCH is checked
    // by validateIdentityPatch against the same sum, conservatively).
    violations.push(
      ...validateBudgetOverride(patch.budget_monthly_usd_override, {
        otherAgentsEffectiveBudgetUsd,
      }),
    );
  }
  if ("paused" in patch && typeof patch.paused !== "boolean") {
    violations.push({ rule: "S12-paused", field: "paused", msg: "paused must be a boolean" });
  }
  if ("archived" in patch && typeof patch.archived !== "boolean") {
    violations.push({ rule: "S13-archived", field: "archived", msg: "archived must be a boolean" });
  }
  if (violations.length > 0) {
    return reply(422, { error: "config_validation_failed", violations });
  }

  const changes = diffChanges(existing as unknown as Record<string, unknown>, patch);
  if (changes.length === 0) {
    // Patch re-sends current values; nothing to write, nothing to audit.
    return reply(200, toApiView(existing));
  }

  const kind: AgentAuditKind = identityKeys.length > 0 ? "identity" : "operational";
  const updated = await updateOperational<AgentMetaRow>(agentPk(slug), "META", patch);
  await appendAgentAudit(slug, actorFromEvent(event), kind, changes);
  return reply(200, toApiView(updated));
}

// ADR-0007: POST /agents — create a new agent META row. Identity fields
// come from the body (same writable set as PATCH, plus the immutable slug);
// `created_at` and the operational/computed slices are server-initialised.
// Validation reuses the PATCH rules (shared/agent-config.ts) so a created
// row can never carry config a PATCH would have rejected, including the
// W-3 aggregate budget ceiling. The put is conditional on the slug not
// existing (409 on duplicate — a create is never an update), and every
// accepted create appends a kind="create" AUDIT item.
async function createAgent(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  if (!event.body) return reply(400, { error: "missing_body" });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(event.body) as Record<string, unknown>;
  } catch {
    return reply(400, { error: "invalid_json" });
  }

  const writable = ["slug", ...IDENTITY_PATCHABLE_FIELDS] as readonly string[];
  const invalid = Object.keys(parsed).filter((k) => !writable.includes(k));
  if (invalid.length > 0) {
    return reply(400, {
      error: "non_writable_fields",
      detail: `the following fields are server-set or computed and cannot be supplied on create: ${invalid.join(", ")}`,
      writable: [...writable],
    });
  }

  const slug = typeof parsed.slug === "string" ? parsed.slug : "";
  const otherAgentsEffectiveBudgetUsd = await sumOtherEffectiveBudgets(slug);
  const skillOwners = await buildSkillOwnersLookup(parsed.bindings);
  const violations = validateAgentCreate(parsed, {
    otherAgentsEffectiveBudgetUsd,
    skillOwners,
  });
  if (violations.length > 0) {
    return reply(422, { error: "config_validation_failed", violations });
  }

  const now = new Date().toISOString();
  const row: AgentMetaRow = {
    ...(parsed as unknown as Omit<AgentMetaRow, "pk" | "sk" | "created_at" | "updated_at" | "paused" | "archived" | "runs_this_month" | "cost_this_month_usd" | "deliv_count_total">),
    pk: agentPk(slug),
    sk: "META",
    // Day-resolution created_at matches the rows the retired seed wrote.
    created_at: now.slice(0, 10),
    updated_at: now,
    paused: false,
    archived: false,
    runs_this_month: 0,
    cost_this_month_usd: 0,
    deliv_count_total: 0,
  };

  try {
    await conditionalPutItem(row, "attribute_not_exists(pk)");
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return reply(409, { error: "already_exists", slug });
    }
    throw err;
  }

  // diffChanges against an empty row records every supplied field as
  // null→value, with the long-string digest applied to system_prompt.
  await appendAgentAudit(slug, actorFromEvent(event), "create", diffChanges({}, parsed));
  return reply(201, toApiView(row));
}

async function deleteAgent(
  slug: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const existing = await getItem<AgentMetaRow>(agentPk(slug), "META");
  if (!existing) return reply(404, { error: "not_found", slug });
  if (existing.archived) {
    return reply(200, { ...toApiView(existing), already_archived: true });
  }
  const updated = await updateOperational<AgentMetaRow>(agentPk(slug), "META", {
    archived: true,
  });
  await appendAgentAudit(slug, actorFromEvent(event), "operational", [
    { field: "archived", before: false, after: true },
  ]);
  return reply(200, toApiView(updated));
}

// IAM principal from the API GW HTTP API authorizer context. PATCH/DELETE
// sit behind AWS_IAM, so this is the operator's (or a future role's) ARN;
// it lands in the AUDIT item as the actor.
function actorFromEvent(event: APIGatewayProxyEventV2): string {
  const iam = (
    event.requestContext as unknown as {
      authorizer?: { iam?: { userArn?: string } };
    }
  ).authorizer?.iam;
  return iam?.userArn ?? "operator";
}

// Sum of effective (override ?? default) monthly budgets across all OTHER
// non-archived agents — the W-3 aggregate context for budget writes. Pages
// the full AGENT#/META scan; at C-3 scale this is one page.
async function sumOtherEffectiveBudgets(slug: string): Promise<number> {
  let total = 0;
  let cursor: string | undefined;
  do {
    const page = await scanPrefix<AgentMetaRow>("AGENT#", "META", PAGE_SIZE_MAX, cursor);
    for (const row of page.items) {
      if (row.slug === slug || row.archived) continue;
      total += row.budget_monthly_usd_override ?? row.budget_monthly_usd_default;
    }
    cursor = page.cursor;
  } while (cursor);
  return total;
}

// Prefetch SKILL#{name}/META owners for every skill named in a prospective
// bindings[] write, so the pure validator can cross-check existence and
// ownership without doing I/O itself.
async function buildSkillOwnersLookup(
  bindings: unknown,
): Promise<(name: string) => readonly string[] | undefined> {
  const owners = new Map<string, readonly string[] | undefined>();
  if (Array.isArray(bindings)) {
    const names = [
      ...new Set(
        bindings
          .map((b) => (typeof b === "object" && b !== null ? (b as { skill?: unknown }).skill : undefined))
          .filter((s): s is string => typeof s === "string"),
      ),
    ];
    await Promise.all(
      names.map(async (name) => {
        const row = await getItem<SkillMetaRow>(skillPk(name), "META");
        owners.set(name, row ? (row.owners ?? []) : undefined);
      }),
    );
  }
  return (name) => owners.get(name);
}

async function listAgentAuditRoute(
  slug: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const qs = event.queryStringParameters ?? {};
  const pageSize = Math.min(
    Math.max(parseInt(qs.page_size ?? `${PAGE_SIZE_DEFAULT}`, 10) || PAGE_SIZE_DEFAULT, 1),
    PAGE_SIZE_MAX,
  );
  const existing = await getItem<AgentMetaRow>(agentPk(slug), "META");
  if (!existing) return reply(404, { error: "not_found", slug });
  const page = await listAgentAudit(slug, pageSize, qs.cursor);
  return reply(200, { items: page.items, next_cursor: page.cursor });
}

// ----- Skills (Epic-008 PR-D) -----

async function listSkills(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const qs = event.queryStringParameters ?? {};
  const filterStatus = qs.status as "active" | "stale" | "deprecated" | undefined;
  const filterOwner = qs.owner; // agent slug — show skills the given agent owns

  // Drain the whole SKILL#/META set (see scanAllPrefix / FU-PROJ-SCAN): a
  // Limit-capped scan window would hide skills that scan past it.
  const skillRows = await scanAllPrefix<SkillMetaRow>("SKILL#", "META");
  const items = skillRows
    .filter((r) => !filterStatus || r.status === filterStatus)
    .filter((r) => !filterOwner || r.owners.includes(filterOwner))
    .map(toSkillApiView);

  // Fully drained above — next_cursor retained for shape, always absent.
  return reply(200, { items, next_cursor: undefined });
}

async function getSkill(name: string): Promise<APIGatewayProxyResultV2> {
  const row = await getItem<SkillMetaRow>(skillPk(name), "META");
  if (!row) return reply(404, { error: "not_found", name });
  return reply(200, toSkillApiView(row));
}

// ADR-0008: PATCH /skills/{name} — the single write path for a skill's
// judgment-side config (body / description / version / status / owners /
// cost_class / improvement_agent[_override]). Code-side fields (write-
// scripts, requires[], archetype, deliverable) stay git-owned and are not
// patchable. Same contract as the agent config writes: write-time
// validation (shared/skill-config.ts), then a SKILL#{name}/AUDIT# item
// the weekly digest compiles. There is no POST /skills — a new skill
// enters via the git scaffold because it needs its write-script.
async function patchSkill(
  name: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  if (!event.body) return reply(400, { error: "missing_body" });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(event.body) as Record<string, unknown>;
  } catch {
    return reply(400, { error: "invalid_json" });
  }

  const invalid = Object.keys(parsed).filter(
    (k) => !(SKILL_PATCHABLE_FIELDS as readonly string[]).includes(k),
  );
  if (invalid.length > 0) {
    return reply(400, {
      error: "non_patchable_fields",
      detail: `the following fields are git-owned, immutable, or computed and cannot be PATCHed: ${invalid.join(", ")} (write-scripts / requires / archetype / deliverable stay in workforce/skills/{name}/ per ADR-0008)`,
      patchable: [...SKILL_PATCHABLE_FIELDS],
    });
  }
  if (Object.keys(parsed).length === 0) {
    return reply(400, { error: "empty_patch" });
  }

  const existing = await getItem<SkillMetaRow>(skillPk(name), "META");
  if (!existing) return reply(404, { error: "not_found", name });

  // Owners / improvement-agent existence + archived cross-check against
  // live AGENT rows (a retired agent can neither own a skill nor run its
  // improvement loop — M4, PR #304 review).
  const candidateSlugs = new Set<string>();
  if (Array.isArray(parsed.owners)) {
    for (const s of parsed.owners) if (typeof s === "string") candidateSlugs.add(s);
  }
  for (const f of ["improvement_agent", "improvement_agent_override"] as const) {
    if (typeof parsed[f] === "string") candidateSlugs.add(parsed[f] as string);
  }
  const stateMap = new Map<string, "active" | "archived">();
  await Promise.all(
    [...candidateSlugs].map(async (slug) => {
      const row = await getItem<AgentMetaRow>(agentPk(slug), "META");
      if (row) stateMap.set(slug, row.archived ? "archived" : "active");
    }),
  );

  const violations: SkillConfigViolation[] = validateSkillPatch(parsed, {
    agentState: (slug) => stateMap.get(slug),
  });

  // Reverse-R8 retired by adr-0012: binding no longer requires ownership, so
  // shrinking owners[] can never orphan a binding. owners[] is now purely the
  // authorship/Rule-11/improvement set; editing it is independent of bindings.

  if (violations.length > 0) {
    return reply(422, { error: "config_validation_failed", violations });
  }

  const changes = diffChanges(existing as unknown as Record<string, unknown>, parsed);
  if (changes.length === 0) {
    return reply(200, toSkillApiView(existing));
  }

  const updated = await updateOperational<SkillMetaRow>(skillPk(name), "META", parsed);
  await appendSkillAudit(name, actorFromEvent(event), changes);
  return reply(200, toSkillApiView(updated));
}

async function listSkillAuditRoute(
  name: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const qs = event.queryStringParameters ?? {};
  const pageSize = Math.min(
    Math.max(parseInt(qs.page_size ?? `${PAGE_SIZE_DEFAULT}`, 10) || PAGE_SIZE_DEFAULT, 1),
    PAGE_SIZE_MAX,
  );
  const existing = await getItem<SkillMetaRow>(skillPk(name), "META");
  if (!existing) return reply(404, { error: "not_found", name });
  const page = await listSkillAudit(name, pageSize, qs.cursor);
  return reply(200, { items: page.items, next_cursor: page.cursor });
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
  /** Human-readable project name (project.json `name`). */
  name?: string;
  /** Standard project attribute: the GitHub repo this project ships work
   *  against. Non-confidential project variable (the PAT is a separate
   *  credential under `wf/projects/{id}/github.token`). Both present or
   *  both absent. Surfaced so the console can render the repo link. */
  github_owner?: string;
  github_repo?: string;
}

function toProjectApiView(row: ProjectMetaRow): ProjectApiView {
  return {
    project_id: row.project_id,
    status: row.status,
    owner_agent: row.owner_agent,
    created_at: row.created_at,
    archived_at: row.archived_at,
    name: row.name,
    github_owner: row.github_owner,
    github_repo: row.github_repo,
  };
}

async function listProjects(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const qs = event.queryStringParameters ?? {};
  const includeSelf = qs.include_self === "true";
  const filterStatus = qs.status as "active" | "archived" | undefined;
  const filterOwner = qs.owner;

  // Drain EVERY PROJECT#/META row (scanAllPrefix), not a single
  // Limit-capped scan page. A `scanPrefix` page bounds items EVALUATED,
  // not matched, so on a single table dominated by EXEC#/MSG#/AGENT# rows
  // only the handful of PROJECT#/META rows that happen to land in the
  // first scan window come back — which is exactly how `agent-workforce`
  // vanished from the console on 2026-06-15 while its row sat intact in
  // DDB (FU-PROJ-SCAN). Projects are ≤ a few dozen at C-3 scale.
  const projectRows = await scanAllPrefix<ProjectMetaRow>("PROJECT#", "META");

  // Defence-in-depth: skip rows that don't match the canonical
  // `ProjectMetaRow` shape rather than throwing the whole request.
  // This catches data-integrity regressions from operator-side bootstrap
  // runbooks (the prod bug found in OP-001 verification — a META row
  // missing `project_id` would 500 the entire listProjects call) and
  // emits a structured log + `WfMalformedProjectMeta` metric so the
  // operator sees the gap. The per-route GETs still expose the shape
  // honestly (a single-row GET 404s on a row that the brand validator
  // rejects), so this is *list-route defence*, not a silent papering-over.
  const wellFormed = projectRows.filter((r) =>
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

  // Fully drained above (scanAllPrefix) — next_cursor retained for
  // response-shape stability, always absent.
  return reply(200, { items, next_cursor: undefined });
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

// ── Talent reply dispatch (Epic-013 Story 3, ADR-0006) ──────────────────
// After the operator's message persists, fire the real-time reply Lambda so
// the addressed talent answers within seconds. Async ("Event") invoke +
// best-effort: a dispatch failure must NOT fail the operator's send — the
// message already landed (W-4: "delivery pending", never a silent drop).
const lambda = new LambdaClient({});
const MESSAGING_REPLY_FUNCTION = process.env.MESSAGING_REPLY_FUNCTION;

/** Choose which talent should reply to an operator message. 1:1 → the sole
 *  talent. Group → the first @-addressed participant, else the primary
 *  (`participants[0]`). Keeps a group post to ONE reply (Epic §6/§7). */
function pickAddressedSlug(participants: readonly string[], body: string): string | undefined {
  if (participants.length === 0) return undefined;
  if (participants.length === 1) return participants[0];
  const at = body.match(/@([a-z0-9-]+)/i);
  if (at && at[1]) {
    const slug = at[1].toLowerCase();
    if (participants.includes(slug)) return slug;
  }
  return participants[0];
}

async function dispatchReply(threadId: string, addressedSlug: string | undefined): Promise<void> {
  if (!addressedSlug) return;
  if (!MESSAGING_REPLY_FUNCTION) {
    console.warn(
      JSON.stringify({ event: "messaging_reply_function_unset", thread_id: threadId }),
    );
    return;
  }
  try {
    await lambda.send(
      new InvokeCommand({
        FunctionName: MESSAGING_REPLY_FUNCTION,
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify({ thread_id: threadId, addressed_slug: addressedSlug })),
      }),
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "messaging_reply_dispatch_failed",
        thread_id: threadId,
        addressed_slug: addressedSlug,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    cw.send(
      new PutMetricDataCommand({
        Namespace: "Workforce/Messaging",
        MetricData: [
          {
            MetricName: "WfMsgReplyDispatchFailed",
            Value: 1,
            Unit: "Count",
            Dimensions: [{ Name: "Stage", Value: STAGE }],
          },
        ],
      }),
    ).catch(() => {
      /* metric emission is itself best-effort */
    });
  }
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

// Epic-016 Phase 2 — assemble one scope's PerformanceSeries from the two
// roll-up items: LIFECYCLE (reducer-owned, the live funnel) + PR (git-derived,
// published by build-pr-metrics.mjs). LIFECYCLE is the live differentiator: its
// absence means the reducer has not run for this scope yet, so we 404 and let
// the client serve its illustrative fallback (Epic-016 §"Data contract" — a
// missing live roll-up is graceful degradation, not a masked outage). The PR
// item is optional — a scope with lifecycle but no published PR sections serves
// an empty PR block rather than 404ing the whole series.
async function getPerformanceRoute(scope: string): Promise<APIGatewayProxyResultV2> {
  const [lifecycleRow, prRow] = await Promise.all([
    getItem<PerfLifecycleRow>(perfPk(scope), "LIFECYCLE"),
    getItem<PerfPrRow>(perfPk(scope), "PR"),
  ]);
  if (!lifecycleRow) return reply(404, { error: "not_found", scope });
  const series = composeSeries(scope, new Date().toISOString(), lifecycleRow, prRow);
  return reply(200, series);
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
    summary: r.summary,
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
  // partitions. No GSI for this access pattern yet; a full drain
  // (scanAllPrefix) is fine at workforce scale (≤ 20 projects). A single
  // Limit-capped scanPrefix page would drop memberships outside the first
  // scan window (FU-PROJ-SCAN). When this grows hot, add a GSI on
  // (gsi3pk=AGENT#slug, gsi3sk=PROJECT#id) at MEMBER write time.
  const memberRows = await scanAllPrefix<ProjectMemberRow>("PROJECT#", `MEMBER#${slug}`);
  const items = memberRows
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
// The route is PUBLIC (no AWS_IAM auth) — the EXEC row fields surfaced
// here (skill / status / started_at / ended_at / artifact_ref uri-shape)
// are operational metadata, no more sensitive than the public projects
// read API on this same Lambda. The Cognito-on-hostname gate
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
    summary: r.summary,
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
    summary: row.summary,
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
    // Full body, not a 320-char preview — the feed renders the whole post
    // (PostCard owns the client-side "read more" collapse). Hydrations fan
    // out in parallel; short posts skip S3 (see resolveFeedBody).
    posts: await Promise.all(page.items.map(toFeedPostListView)),
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
    posts: await Promise.all(page.items.map(toFeedPostListView)),
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
  // (< BODY_PREVIEW_MAX_CHARS, per data-model.md). Most posts at 280–600
  // chars do NOT fit, so the round-trip is the common case; cheap-path the
  // rest. Detail stays fail-loud on S3 error (unlike the best-effort list
  // path) — a detail request is about this one post.
  if (row.body_preview.length < BODY_PREVIEW_MAX_CHARS) {
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
 * Auth: AWS_IAM (SigV4) at the gateway (decision D3); the author is always
 * the operator in v1.
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
    await dispatchReply(out.thread_id, pickAddressedSlug(participants as string[], messageBody));
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
    const meta = await getThreadMeta(threadId);
    if (meta) await dispatchReply(threadId, pickAddressedSlug(meta.participants, body.body));
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
// shared bearer token, client-supplied project_id, and — since 2026-06-08 —
// no project-membership gate at all (the cross-project denial that
// appendExecution() used to throw was removed; membership is informational).

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
    // Prefer the explicit top-level business summary; fall back to the
    // artifact preview for CCR/legacy rows that only carried an artifact.
    summary: row.summary ?? row.artifact_ref?.summary ?? "",
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

  // Optional top-level business summary of the engagement — what the unit of
  // work accomplished, in the client's words. This is what the portfolio /
  // RUNS·DELIVERABLES UI renders; without it an artifact-less engagement
  // (e.g. a pr-review) shows "no summary". Distinct from artifact.summary
  // (a file-deliverable preview). Sliced to 512 to match that convention and
  // keep the EXEC item small; a non-string or empty value is simply dropped.
  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim().length > 0
      ? parsed.summary.slice(0, 512)
      : undefined;

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
      summary,
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
    // Membership write-gate removed 2026-06-08 (C-3): appendExecution no
    // longer throws "cross-project denial", so there is no 403 not_a_member
    // path here anymore. Any holder of the engagement-write Bearer token may
    // record an engagement against any project_id.
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
