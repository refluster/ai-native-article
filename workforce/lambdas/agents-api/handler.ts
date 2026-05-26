// wf-agents-api Lambda handler.
// Routes:
//   GET    /agents                          list (paginated, filterable)
//   GET    /agents/{slug}                   single agent
//   GET    /agents/{slug}/deliverables      recent DELIV rows (paginated)
//   PATCH  /agents/{slug}                   operational fields only (IAM-auth at API GW)
//   DELETE /agents/{slug}                   soft delete -> archived=true (IAM-auth at API GW)
//   GET    /skills                          list of skills (paginated, filterable)
//   GET    /skills/{name}                   single skill
//
// See workforce/docs/epics/epic-007-agent-management-api.md (agents) and
// workforce/docs/epics/epic-008-skill-repository.md (skills) for the
// source-of-truth split and the IAM-auth boundary.

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
    if (routeKey === "GET /agents") return listAgents(event);
    if (routeKey === "GET /skills") return listSkills(event);
    if (routeKey === "GET /skills/{name}" && skillName) return getSkill(skillName);
    if (routeKey === "GET /agents/{slug}/deliverables" && slug) return listAgentDeliverables(slug, event);
    if (routeKey === "GET /agents/{slug}" && slug) return getAgent(slug);
    if (routeKey === "PATCH /agents/{slug}" && slug) return patchAgent(slug, event.body);
    if (routeKey === "DELETE /agents/{slug}" && slug) return deleteAgent(slug);

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
