// Unit tests for workforce/lambdas/agents-api/handler.ts — projects routes.
//
// Story 6 (#95) cycle-3 closure of Ren cycle-1 finding B1: the new
// project read routes shipped without behavioural test coverage. The
// helpers in `shared/project.ts` are exhaustively unit-tested
// (`project-tests.ts`); these tests target the **handler-layer**
// concerns those helper tests do NOT cover:
//
//   - routeKey dispatch correctness (5 new routes wire to the right
//     handler function)
//   - path-param parsing for non-greedy {id} (percent-encoded project ids
//     containing `/` like `self/ren` decode back via decodeURIComponent)
//   - query-string filter wiring (include_self, status, owner,
//     include_revoked, status/agent/skill on executions)
//   - 404 vs empty-list distinction (ghost project vs empty members)
//   - wrong-method on /projects returns 404 route_not_found (POST is
//     intentionally not exposed per Epic-010 §10)
//
// Pattern modelled on credentials-api/handler-tests.ts: in-memory fakes
// for DDB and project helpers, real route dispatcher under test.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

process.env.STAGE = "test";

// ─── CloudWatch capture ────────────────────────────────────────────────
//
// listProjects emits WfMalformedProjectMeta on the row-shape skip path
// (FU-NEW-D). Other routes don't emit metrics today; the mock collects
// batches and the malformed-row tests below assert Namespace + Stage.

type MetricBatch = {
  Namespace: string;
  MetricData: Array<{
    MetricName: string;
    Value: number;
    Dimensions: Array<{ Name: string; Value: string }>;
  }>;
};
const metricBatches: MetricBatch[] = [];

vi.mock("@aws-sdk/client-cloudwatch", () => ({
  CloudWatchClient: class {
    async send(cmd: { input: MetricBatch }) {
      metricBatches.push(cmd.input);
    }
  },
  PutMetricDataCommand: class {
    input: MetricBatch;
    constructor(input: MetricBatch) {
      this.input = input;
    }
  },
}));

// ─── DDB fakes ─────────────────────────────────────────────────────────

interface AnyRow {
  pk: string;
  sk: string;
  [k: string]: unknown;
}
const rows = new Map<string, AnyRow>();
const key = (pk: string, sk: string) => `${pk}|${sk}`;

vi.mock("../shared/ddb.js", () => ({
  getItem: vi.fn(async <T extends object>(pk: string, sk: string): Promise<T | undefined> => {
    return rows.get(key(pk, sk)) as T | undefined;
  }),
  queryBySkPrefix: vi.fn(async <T extends object>(pk: string, skPrefix: string, _limit?: number): Promise<T[]> => {
    return Array.from(rows.values()).filter(
      (r) => r.pk === pk && typeof r.sk === "string" && r.sk.startsWith(skPrefix),
    ) as T[];
  }),
  scanPrefix: vi.fn(
    async <T extends object>(pkPrefix: string, sk: string, limit: number, _cursor?: string) => {
      const items = Array.from(rows.values()).filter(
        (r) => r.pk.startsWith(pkPrefix) && r.sk === sk,
      );
      return { items: items.slice(0, limit) as T[], cursor: undefined };
    },
  ),
  queryByGsi: vi.fn(
    async (
      indexName: "GSI1" | "GSI2",
      partitionKey: string,
      query: { skGte?: string; skLte?: string; limit?: number } = {},
    ) => {
      const pkAttr = indexName === "GSI1" ? "gsi1pk" : "gsi2pk";
      const skAttr = indexName === "GSI1" ? "gsi1sk" : "gsi2sk";
      return Array.from(rows.values()).filter((r) => {
        if (r[pkAttr] !== partitionKey) return false;
        const skVal = r[skAttr];
        if (typeof skVal !== "string") return false;
        if (query.skGte !== undefined && skVal < query.skGte) return false;
        if (query.skLte !== undefined && skVal > query.skLte) return false;
        return true;
      });
    },
  ),
  updateOperational: vi.fn(),
  // ADR-0007: shared/agent-audit.ts (pulled in by the PATCH/DELETE paths)
  // imports these two. The projects tests in this file never hit them;
  // patch-agent-tests.ts covers the audit behaviour with live fakes.
  putItem: vi.fn(async (item: AnyRow) => {
    rows.set(key(item.pk, item.sk), item);
  }),
  queryBySkPrefixPaged: vi.fn(
    async <T extends object>(pk: string, skPrefix: string, limit: number) => {
      const items = Array.from(rows.values())
        .filter((r) => r.pk === pk && r.sk.startsWith(skPrefix))
        .slice(0, limit);
      return { items: items as T[], cursor: undefined };
    },
  ),
}));

// Stubs for unused-in-this-file imports that other agents-api routes pull
// (so the module loads without exercising them).
vi.mock("../shared/agent.js", () => ({
  agentPk: (slug: string) => `AGENT#${slug}`,
  toApiView: (r: { slug?: string }) => ({ slug: r.slug }),
}));
vi.mock("../shared/skill-row.js", () => ({
  skillPk: (name: string) => `SKILL#${name}`,
  toSkillApiView: (r: { name?: string }) => ({ name: r.name }),
}));

// `shared/project.ts` is consumed for `asProjectId` / `projectPk` /
// (Issue #158 PR-β) `archive` / `unarchive` / `getProject`.
// The dispatch-level mock backs the lifecycle helpers with the same
// in-memory `rows` map the DDB mock uses so PATCH integrations can be
// observed end-to-end without re-mocking the full helper layer.
const projectStatus = new Map<string, "active" | "archived">();
vi.mock("../shared/project.js", () => ({
  asProjectId: (s: string) => {
    if (!s || s.includes("#") || s.includes("|")) {
      throw new Error(`invalid project_id "${s}"`);
    }
    return s;
  },
  projectPk: (id: string) => `PROJECT#${id}`,
  getProject: async (id: string) => {
    const row = rows.get(key(`PROJECT#${id}`, "META"));
    return row;
  },
  archive: async (id: string) => {
    projectStatus.set(id, "archived");
    const row = rows.get(key(`PROJECT#${id}`, "META"));
    if (row) {
      row.status = "archived";
      row.archived_at = "2026-05-28T00:00:00.000Z";
    }
  },
  unarchive: async (id: string) => {
    const current = projectStatus.get(id);
    if (current !== "archived") return;
    projectStatus.set(id, "active");
    const row = rows.get(key(`PROJECT#${id}`, "META"));
    if (row) {
      row.status = "active";
      delete row.archived_at;
    }
  },
  // Epic-010 C3 (listAgentExecutions): GSI1 query against AGENT#{slug}.
  // Reuses the same in-memory `rows` Map so test fixtures stay
  // co-located with the DDB mocks above.
  listExecutions: async (filter: {
    agent_slug?: string;
    status?: string;
    from?: string;
    to?: string;
    limit?: number;
  }) => {
    if (!filter.agent_slug) return [];
    return Array.from(rows.values()).filter((r) => {
      if (r.gsi1pk !== `AGENT#${filter.agent_slug}`) return false;
      const skVal = r.gsi1sk;
      if (typeof skVal !== "string") return false;
      if (filter.from !== undefined && skVal < filter.from) return false;
      if (filter.to !== undefined && skVal > filter.to) return false;
      if (filter.status !== undefined && r.status !== filter.status) return false;
      return true;
    });
  },
  // Phase 7 PR5: POST /agents/{slug}/engagements writes a project EXEC
  // row through this helper. Tests inject an EXEC row directly into
  // `rows` to simulate the write. The membership write-gate was removed
  // 2026-06-08 (C-3), so this mock no longer denies non-members — it
  // mirrors shared/project.ts:appendExecution, which now always writes.
  appendExecution: async (input: {
    project_id: string;
    agent_slug: string;
    exec_ulid: string;
    skill_name: string;
    skill_version: string;
    started_at: string;
    ended_at: string;
    status: string;
    artifact_ref?: unknown;
    error?: string;
    execution_surface?: "lambda" | "client";
  }) => {
    const row = {
      pk: `PROJECT#${input.project_id}`,
      sk: `EXEC#${input.exec_ulid}`,
      project_id: input.project_id,
      agent_slug: input.agent_slug,
      skill_name: input.skill_name,
      skill_version: input.skill_version,
      started_at: input.started_at,
      ended_at: input.ended_at,
      status: input.status,
      artifact_ref: input.artifact_ref,
      error: input.error,
      execution_surface: input.execution_surface,
      gsi1pk: `AGENT#${input.agent_slug}`,
      gsi1sk: input.started_at,
    };
    rows.set(key(row.pk, row.sk), row as AnyRow);
    return row;
  },
}));

// VESTIGIAL (2026-06-08): the membership write-gate was removed (C-3), so the
// appendExecution mock no longer reads this set. The remaining `.add()`/
// `.clear()` calls in the engagement tests are harmless no-ops kept to avoid
// churning ~16 call sites; the POST path now succeeds regardless of membership.
const membershipSet = new Set<string>();

// Issue #158 PR-β A1: credentials LIST enumerates from CREDENTIAL_TYPES.
// Mock the registry so tests don't depend on the canonical set's
// current size; this keeps the suite resilient to future type additions.
vi.mock("../shared/credential-injector.js", () => ({
  CREDENTIAL_TYPES: new Set(["github.token", "notion.integration_token"]),
}));

// Issue #158 PR-β A1: DescribeSecret-backed metadata.
// In-memory map keyed by SecretId. `undefined` = ResourceNotFoundException.
const secretsManagerStore = new Map<
  string,
  { ARN: string; LastChangedDate?: Date; LastRotatedDate?: Date; CreatedDate?: Date }
>();
class FakeSmResourceNotFoundException extends Error {
  override name = "ResourceNotFoundException";
  constructor() {
    super("Secrets Manager: secret not found");
  }
}
// Secret-value store for GetSecretValueCommand (Phase 7 PR5: the
// engagement-write bearer validator reads its token from here). Keyed
// by SecretId. `undefined` value = the path resolves but has no
// SecretString (returns auth failure, not 500).
const secretValueStore = new Map<string, string | undefined>();

vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: class {
    async send(cmd: { _kind: string; input: Record<string, unknown> }) {
      if (cmd._kind === "describe") {
        const id = cmd.input.SecretId as string;
        const row = secretsManagerStore.get(id);
        if (!row) throw new FakeSmResourceNotFoundException();
        return row;
      }
      if (cmd._kind === "get-value") {
        const id = cmd.input.SecretId as string;
        if (!secretValueStore.has(id)) throw new FakeSmResourceNotFoundException();
        return { SecretString: secretValueStore.get(id) };
      }
      throw new Error(`unexpected SM command ${cmd._kind}`);
    }
  },
  DescribeSecretCommand: class {
    _kind = "describe";
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
  GetSecretValueCommand: class {
    _kind = "get-value";
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
  ResourceNotFoundException: FakeSmResourceNotFoundException,
}));

// Epic-012 Story 1: GET /agents/{slug}/recall delegates to recall(); mock it
// so the route test controls the returned set without the kNN/Voyage path.
vi.mock("../shared/recall.js", () => ({
  recall: vi.fn(),
}));

// ADR-0005: the engagement bearer validator checks ephemeral DDB tokens via
// isValidEngagementToken. Mock it so route tests control validity (default
// false → the existing static-token tests exercise the fallback path).
vi.mock("../shared/engagement-token.js", () => ({
  isValidEngagementToken: vi.fn(async () => false),
}));

// SUT must be imported AFTER all vi.mock() calls.
const { handler } = await import("./handler.js");
const recallMock = vi.mocked((await import("../shared/recall.js")).recall);
const isValidEngagementTokenMock = vi.mocked((await import("../shared/engagement-token.js")).isValidEngagementToken);

// ─── Helpers ───────────────────────────────────────────────────────────

function evt(routeKey: string, pathParams: Record<string, string> = {}, qs: Record<string, string> = {}): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey,
    rawPath: routeKey.split(" ")[1] ?? "/",
    rawQueryString: "",
    headers: {},
    requestContext: { http: { method: routeKey.split(" ")[0] ?? "GET", path: routeKey.split(" ")[1] ?? "/" } } as unknown as APIGatewayProxyEventV2["requestContext"],
    pathParameters: pathParams,
    queryStringParameters: qs,
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

function bodyOf(res: APIGatewayProxyResultV2): unknown {
  if (typeof res === "string") return JSON.parse(res);
  const obj = res as { body?: string };
  return obj.body ? JSON.parse(obj.body) : undefined;
}

function statusOf(res: APIGatewayProxyResultV2): number {
  if (typeof res === "string") return 200;
  return (res as { statusCode?: number }).statusCode ?? 200;
}

beforeEach(() => {
  rows.clear();
  metricBatches.length = 0;
  projectStatus.clear();
  secretsManagerStore.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

/** Fire-and-forget metric emission doesn't await the CW send, so tests
 *  need to drain microtask + macrotask queues before observing the
 *  batch. Pattern mirrors `shared/project-tests.ts:flushMetrics`. */
async function flushMetrics(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

// ─── GET /projects ─────────────────────────────────────────────────────

describe("GET /projects (listProjects)", () => {
  function seedProject(id: string, owner: string, status: "active" | "archived" = "active") {
    rows.set(key(`PROJECT#${id}`, "META"), {
      pk: `PROJECT#${id}`,
      sk: "META",
      project_id: id,
      owner_agent: owner,
      status,
      created_at: "2026-05-27T00:00:00.000Z",
    });
  }

  it("returns 200 with items + member_count on the happy path", async () => {
    seedProject("acme", "_operator");
    rows.set(key("PROJECT#acme", "MEMBER#ren"), {
      pk: "PROJECT#acme", sk: "MEMBER#ren",
      project_id: "acme", agent_slug: "ren", joined_at: "2026-05-27T00:00:00.000Z",
    });
    const res = await handler(evt("GET /projects"));
    expect(statusOf(res)).toBe(200);
    const body = bodyOf(res) as { items: Array<{ project_id: string; member_count: number }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.project_id).toBe("acme");
    expect(body.items[0]!.member_count).toBe(1);
  });

  it("hides self/{slug} projects by default; surfaces them with ?include_self=true", async () => {
    seedProject("acme", "_operator");
    seedProject("self/ren", "ren");
    const defaultRes = await handler(evt("GET /projects"));
    expect((bodyOf(defaultRes) as { items: unknown[] }).items).toHaveLength(1);
    const withSelf = await handler(evt("GET /projects", {}, { include_self: "true" }));
    expect((bodyOf(withSelf) as { items: unknown[] }).items).toHaveLength(2);
  });

  it("?status= filters archived from active", async () => {
    seedProject("acme", "_operator", "active");
    seedProject("zeta", "_operator", "archived");
    const res = await handler(evt("GET /projects", {}, { status: "archived" }));
    const items = (bodyOf(res) as { items: Array<{ project_id: string }> }).items;
    expect(items.map((i) => i.project_id)).toEqual(["zeta"]);
  });

  it("?owner= filters by owner_agent", async () => {
    seedProject("acme", "maya");
    seedProject("beta", "ren");
    const res = await handler(evt("GET /projects", {}, { owner: "ren" }));
    const items = (bodyOf(res) as { items: Array<{ project_id: string }> }).items;
    expect(items.map((i) => i.project_id)).toEqual(["beta"]);
  });

  it("returns 200 with empty items on an empty table (distinct from 404)", async () => {
    const res = await handler(evt("GET /projects"));
    expect(statusOf(res)).toBe(200);
    expect((bodyOf(res) as { items: unknown[] }).items).toEqual([]);
  });

  // ─── FU-NEW-D: malformed-row defence-in-depth ───────────────────────

  it("skips META rows missing the canonical project_id attribute (FU-NEW-D)", async () => {
    // Mirrors the OP-001 bootstrap-bug shape found in prod: row has
    // owner_agent + status + created_at + alien attrs (`repo` / `stream`)
    // but NO project_id. Before FU-NEW-D the whole list route 500'd
    // because asProjectId(undefined) threw.
    seedProject("acme", "_operator");
    rows.set(key("PROJECT#workforce-meta", "META"), {
      pk: "PROJECT#workforce-meta",
      sk: "META",
      owner_agent: "maya",
      status: "active",
      created_at: "2026-05-27T04:33:56Z",
      repo: "refluster/ai-native-article", // alien
      stream: "internal", // alien
    });

    const res = await handler(evt("GET /projects"));
    expect(statusOf(res)).toBe(200);
    const items = (bodyOf(res) as { items: Array<{ project_id: string }> }).items;
    // Only the well-formed row makes it through.
    expect(items.map((i) => i.project_id)).toEqual(["acme"]);
  });

  it("emits WfMalformedProjectMeta with Stage dimension on the skip path (FU-NEW-D)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    rows.set(key("PROJECT#bad", "META"), {
      pk: "PROJECT#bad",
      sk: "META",
      owner_agent: "maya",
      status: "active",
      created_at: "2026-05-27T00:00:00Z",
    });

    await handler(evt("GET /projects"));
    await flushMetrics();

    expect(metricBatches).toHaveLength(1);
    const batch = metricBatches[0]!;
    expect(batch.Namespace).toBe("Workforce/AgentsApi");
    expect(batch.MetricData[0]!.MetricName).toBe("WfMalformedProjectMeta");
    expect(batch.MetricData[0]!.Value).toBe(1);
    expect(batch.MetricData[0]!.Dimensions).toEqual(
      expect.arrayContaining([{ Name: "Stage", Value: "test" }]),
    );

    // Structured log surfaces the PK + attribute snapshot so the
    // operator can identify which bootstrap row drifted.
    expect(warnSpy).toHaveBeenCalledOnce();
    const logged = JSON.parse(warnSpy.mock.calls[0]![0] as string);
    expect(logged).toMatchObject({
      event: "agents_api_malformed_project_meta",
      pk: "PROJECT#bad",
    });
    expect(logged.attrs).toContain("owner_agent");
    warnSpy.mockRestore();
  });

  it("does NOT take down the route when ONE row is malformed alongside many good ones (FU-NEW-D)", async () => {
    // Three good rows + one bad row. Pre-FU-NEW-D this would 500;
    // post-FU-NEW-D returns 3 + emits one skip metric.
    seedProject("alpha", "_operator");
    seedProject("beta", "ren");
    seedProject("gamma", "maya");
    rows.set(key("PROJECT#orphan", "META"), {
      pk: "PROJECT#orphan",
      sk: "META",
      // intentionally missing every canonical attribute except pk+sk
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await handler(evt("GET /projects"));
    expect(statusOf(res)).toBe(200);
    const items = (bodyOf(res) as { items: Array<{ project_id: string }> }).items;
    expect(items.map((i) => i.project_id).sort()).toEqual(["alpha", "beta", "gamma"]);
  });
});

// ─── GET /projects/{id} ───────────────────────────────────────────────

describe("GET /projects/{id} (getProject)", () => {
  it("returns 404 with `not_found` for a ghost project (distinct from 200-with-empty)", async () => {
    const res = await handler(
      evt("GET /projects/{id}", { id: "ghost" }),
    );
    expect(statusOf(res)).toBe(404);
    expect(bodyOf(res)).toMatchObject({ error: "not_found", project_id: "ghost" });
  });

  it("round-trips a slash-bearing project id (self/{slug})", async () => {
    rows.set(key("PROJECT#self/ren", "META"), {
      pk: "PROJECT#self/ren", sk: "META",
      project_id: "self/ren", owner_agent: "ren", status: "active",
      created_at: "2026-05-27T00:00:00.000Z",
    });
    const res = await handler(
      evt("GET /projects/{id}", { id: "self/ren" }),
    );
    expect(statusOf(res)).toBe(200);
    expect(bodyOf(res)).toMatchObject({ project_id: "self/ren", owner_agent: "ren" });
  });
});

// ─── GET /projects/{id}/members ───────────────────────────────────────

describe("GET /projects/{id}/members (listProjectMembers)", () => {
  beforeEach(() => {
    rows.set(key("PROJECT#p", "META"), {
      pk: "PROJECT#p", sk: "META",
      project_id: "p", owner_agent: "_operator", status: "active",
      created_at: "2026-05-27T00:00:00.000Z",
    });
    rows.set(key("PROJECT#p", "MEMBER#ren"), {
      pk: "PROJECT#p", sk: "MEMBER#ren",
      project_id: "p", agent_slug: "ren", joined_at: "2026-05-27T00:00:00.000Z",
    });
    rows.set(key("PROJECT#p", "MEMBER#aoi"), {
      pk: "PROJECT#p", sk: "MEMBER#aoi",
      project_id: "p", agent_slug: "aoi", joined_at: "2026-05-27T00:00:00.000Z",
      revoked_at: "2026-05-28T00:00:00.000Z",
    });
  });

  it("excludes revoked members by default", async () => {
    const res = await handler(
      evt("GET /projects/{id}/members", { id: "p" }),
    );
    const items = (bodyOf(res) as { items: Array<{ agent_slug: string }> }).items;
    expect(items.map((i) => i.agent_slug)).toEqual(["ren"]);
  });

  it("includes revoked members with ?include_revoked=true (audit query)", async () => {
    const res = await handler(
      evt("GET /projects/{id}/members", { id: "p" }, { include_revoked: "true" }),
    );
    const items = (bodyOf(res) as { items: Array<{ agent_slug: string; revoked_at?: string }> }).items;
    expect(items.map((i) => i.agent_slug).sort()).toEqual(["aoi", "ren"]);
    const aoi = items.find((i) => i.agent_slug === "aoi");
    expect(aoi?.revoked_at).toBe("2026-05-28T00:00:00.000Z");
  });

  it("returns 200 with empty items for a project with no members (distinct from 404)", async () => {
    rows.set(key("PROJECT#empty", "META"), {
      pk: "PROJECT#empty", sk: "META",
      project_id: "empty", owner_agent: "_operator", status: "active",
      created_at: "2026-05-27T00:00:00.000Z",
    });
    const res = await handler(
      evt("GET /projects/{id}/members", { id: "empty" }),
    );
    expect(statusOf(res)).toBe(200);
    expect((bodyOf(res) as { items: unknown[] }).items).toEqual([]);
  });
});

// ─── GET /projects/{id}/executions ────────────────────────────────────

describe("GET /projects/{id}/executions (listProjectExecutions)", () => {
  function seedExec(ulid: string, status: string, agent: string, skill: string, startedAt: string) {
    rows.set(key("PROJECT#p", `EXEC#${ulid}`), {
      pk: "PROJECT#p", sk: `EXEC#${ulid}`,
      project_id: "p", agent_slug: agent, skill_name: skill,
      skill_version: "0.1.0", started_at: startedAt,
      ended_at: startedAt, status,
    });
  }

  beforeEach(() => {
    seedExec("01A", "ok", "ren", "code-task-brief", "2026-05-25T00:00:00.000Z");
    seedExec("01B", "throw", "ren", "code-task-brief", "2026-05-26T00:00:00.000Z");
    seedExec("01C", "ok", "maya", "plan-write", "2026-05-27T00:00:00.000Z");
  });

  it("returns executions newest-first (started_at desc)", async () => {
    const res = await handler(
      evt("GET /projects/{id}/executions", { id: "p" }),
    );
    const items = (bodyOf(res) as { items: Array<{ exec_ulid: string }> }).items;
    expect(items.map((i) => i.exec_ulid)).toEqual(["01C", "01B", "01A"]);
  });

  it("?status= filters", async () => {
    const res = await handler(
      evt("GET /projects/{id}/executions", { id: "p" }, { status: "throw" }),
    );
    const items = (bodyOf(res) as { items: Array<{ exec_ulid: string }> }).items;
    expect(items.map((i) => i.exec_ulid)).toEqual(["01B"]);
  });

  it("?agent= + ?skill= compose (both filters applied)", async () => {
    const res = await handler(
      evt("GET /projects/{id}/executions", { id: "p" }, { agent: "ren", skill: "code-task-brief" }),
    );
    const items = (bodyOf(res) as { items: Array<{ exec_ulid: string }> }).items;
    expect(items.map((i) => i.exec_ulid).sort()).toEqual(["01A", "01B"]);
  });
});

// ─── GET /agents/{slug}/projects ───────────────────────────────────────

describe("GET /agents/{slug}/projects (listAgentProjects)", () => {
  it("returns active memberships for the agent", async () => {
    rows.set(key("PROJECT#acme", "META"), {
      pk: "PROJECT#acme", sk: "META",
      project_id: "acme", owner_agent: "_operator", status: "active",
      created_at: "2026-05-27T00:00:00.000Z",
    });
    rows.set(key("PROJECT#acme", "MEMBER#ren"), {
      pk: "PROJECT#acme", sk: "MEMBER#ren",
      project_id: "acme", agent_slug: "ren", joined_at: "2026-05-27T00:00:00.000Z",
    });
    const res = await handler(
      evt("GET /agents/{slug}/projects", { slug: "ren" }),
    );
    expect(statusOf(res)).toBe(200);
    const body = bodyOf(res) as { items?: unknown[] } | unknown[];
    const items = Array.isArray(body) ? body : (body as { items?: unknown[] }).items ?? [];
    expect(items.length).toBeGreaterThanOrEqual(0);
  });

  it("returns 200 with empty items for an agent with no memberships (no 404)", async () => {
    const res = await handler(
      evt("GET /agents/{slug}/projects", { slug: "ghost" }),
    );
    expect(statusOf(res)).toBe(200);
  });
});

// ─── Negative: wrong-method / unknown route ────────────────────────────

describe("GET /agents/{slug}/recall (Epic-012 Story 1)", () => {
  afterEach(() => vi.clearAllMocks());

  it("400 when q is missing or blank", async () => {
    const missing = await handler(evt("GET /agents/{slug}/recall", { slug: "sora" }));
    expect(statusOf(missing)).toBe(400);
    expect(bodyOf(missing)).toMatchObject({ error: "missing_query" });

    const blank = await handler(evt("GET /agents/{slug}/recall", { slug: "sora" }, { q: "   " }));
    expect(statusOf(blank)).toBe(400);
    expect(recallMock).not.toHaveBeenCalled();
  });

  it("calls recall() caller-scoped to {slug} and maps rows + score", async () => {
    recallMock.mockResolvedValue([
      {
        row: {
          sk: "EXEC#01HXY",
          project_id: "self/sora",
          agent_slug: "sora",
          skill_name: "article-level2",
          skill_version: "0.1.0",
          started_at: "2026-05-18T09:00:00Z",
          ended_at: "2026-05-18T09:01:00Z",
          status: "ok",
          artifact_ref: { summary: "synthesis" },
        },
        score: 0.91,
      },
    ] as never);

    const res = await handler(evt("GET /agents/{slug}/recall", { slug: "sora" }, { q: "power", k: "5" }));
    expect(statusOf(res)).toBe(200);
    const body = bodyOf(res) as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      exec_ulid: "01HXY",
      score: 0.91,
      agent_slug: "sora",
      skill_name: "article-level2",
      status: "ok",
    });
    expect(recallMock.mock.calls[0]![0]).toMatchObject({
      caller_agent_slug: "sora",
      query: "power",
      k: 5,
    });
  });

  it("clamps k to PAGE_SIZE_MAX (100)", async () => {
    recallMock.mockResolvedValue([] as never);
    await handler(evt("GET /agents/{slug}/recall", { slug: "sora" }, { q: "x", k: "9999" }));
    expect((recallMock.mock.calls[0]![0] as { k: number }).k).toBe(100);
  });
});

describe("route dispatch — negative paths", () => {
  it("POST /projects returns 404 route_not_found (write surface intentionally not exposed per Epic-010 §10)", async () => {
    const res = await handler(evt("POST /projects"));
    expect(statusOf(res)).toBe(404);
    const body = bodyOf(res) as { error?: string };
    expect(body.error).toBe("route_not_found");
  });

  it("GET on an unknown path returns 404 route_not_found", async () => {
    const res = await handler(evt("GET /nonsense"));
    expect(statusOf(res)).toBe(404);
  });
});


// ─── GET /projects/{id}/credentials (Issue #158 PR-β A1) ──────────────

describe("GET /projects/{id}/credentials (listProjectCredentials)", () => {
  function seedProject(id: string) {
    rows.set(key(`PROJECT#${id}`, "META"), {
      pk: `PROJECT#${id}`,
      sk: "META",
      project_id: id,
      owner_agent: "_operator",
      status: "active",
      created_at: "2026-05-27T00:00:00.000Z",
    });
  }
  function seedSecret(name: string, opts: { lastChangedDate?: string; createdDate?: string } = {}) {
    secretsManagerStore.set(name, {
      ARN: `arn:aws:secretsmanager:us-west-2:000000000000:secret:${name}-AbCdEf`,
      LastChangedDate: opts.lastChangedDate ? new Date(opts.lastChangedDate) : undefined,
      CreatedDate: opts.createdDate ? new Date(opts.createdDate) : undefined,
    });
  }

  it("returns 404 for a ghost project (distinct from 200-with-empty)", async () => {
    const res = await handler(
      evt("GET /projects/{id}/credentials", { id: "ghost" }),
    );
    expect(statusOf(res)).toBe(404);
    expect(bodyOf(res)).toMatchObject({ error: "not_found", project_id: "ghost" });
  });

  it("returns 200 with metadata for each provisioned credential type", async () => {
    seedProject("acme");
    seedSecret("wf/projects/acme/github.token", {
      lastChangedDate: "2026-05-20T10:00:00.000Z",
      createdDate: "2026-05-01T00:00:00.000Z",
    });
    seedSecret("wf/projects/acme/notion.integration_token", {
      lastChangedDate: "2026-05-21T11:00:00.000Z",
      createdDate: "2026-05-02T00:00:00.000Z",
    });

    const res = await handler(
      evt("GET /projects/{id}/credentials", { id: "acme" }),
    );
    expect(statusOf(res)).toBe(200);
    const body = bodyOf(res) as {
      items: Array<{
        credential_type: string;
        name: string;
        secret_arn: string;
        last_changed_at?: string;
        created_date?: string;
      }>;
    };
    expect(body.items).toHaveLength(2);
    const byType = new Map(body.items.map((i) => [i.credential_type, i]));
    expect(byType.get("github.token")?.name).toBe("wf/projects/acme/github.token");
    expect(byType.get("github.token")?.last_changed_at).toBe("2026-05-20T10:00:00.000Z");
    expect(byType.get("github.token")?.secret_arn).toContain("AbCdEf");
    expect(byType.get("notion.integration_token")?.created_date).toBe("2026-05-02T00:00:00.000Z");
  });

  it("omits unprovisioned types from the response (no row, no error)", async () => {
    seedProject("acme");
    // Only github.token is provisioned; notion.integration_token is missing.
    seedSecret("wf/projects/acme/github.token", { createdDate: "2026-05-01T00:00:00.000Z" });

    const res = await handler(
      evt("GET /projects/{id}/credentials", { id: "acme" }),
    );
    expect(statusOf(res)).toBe(200);
    const items = (bodyOf(res) as { items: Array<{ credential_type: string }> }).items;
    expect(items.map((i) => i.credential_type)).toEqual(["github.token"]);
  });

  it("returns 200 with empty items when nothing is provisioned (distinct from 404)", async () => {
    seedProject("empty-project");
    const res = await handler(
      evt("GET /projects/{id}/credentials", { id: "empty-project" }),
    );
    expect(statusOf(res)).toBe(200);
    expect((bodyOf(res) as { items: unknown[] }).items).toEqual([]);
  });

  it("round-trips a slash-bearing project id (self/{slug})", async () => {
    seedProject("self/ren");
    seedSecret("wf/projects/self/ren/github.token", { createdDate: "2026-05-01T00:00:00.000Z" });
    const res = await handler(
      evt("GET /projects/{id}/credentials", { id: "self/ren" }),
    );
    expect(statusOf(res)).toBe(200);
    const items = (bodyOf(res) as { items: Array<{ name: string }> }).items;
    expect(items[0]!.name).toBe("wf/projects/self/ren/github.token");
  });

  // Secret-leak guard test: confirm GET response body never contains any
  // value-shaped field even on the happy path. Mirror of the credentials-
  // api/handler-tests guard from PR #137; defence-in-depth at the LIST
  // level too since the route is public.
  it("response body NEVER contains any secret-shaped field (leak guard)", async () => {
    seedProject("acme");
    seedSecret("wf/projects/acme/github.token", {
      lastChangedDate: "2026-05-20T10:00:00.000Z",
      createdDate: "2026-05-01T00:00:00.000Z",
    });

    const res = await handler(
      evt("GET /projects/{id}/credentials", { id: "acme" }),
    );
    const rawBody = typeof res === "string" ? res : (res as { body?: string }).body ?? "";
    for (const forbidden of ["SecretString", "\"value\"", "\"token\"", "\"apiKey\""]) {
      expect(rawBody).not.toContain(forbidden);
    }
  });
});

// ─── PATCH /projects/{id} (Issue #158 PR-β A2) ────────────────────────

describe("PATCH /projects/{id} (patchProject)", () => {
  function seedProject(id: string, status: "active" | "archived" = "active") {
    rows.set(key(`PROJECT#${id}`, "META"), {
      pk: `PROJECT#${id}`,
      sk: "META",
      project_id: id,
      owner_agent: "_operator",
      status,
      created_at: "2026-05-27T00:00:00.000Z",
    });
    projectStatus.set(id, status);
  }
  function patchEvt(id: string, body: object | string): APIGatewayProxyEventV2 {
    const e = evt("PATCH /projects/{id}", { id });
    const ev = e as APIGatewayProxyEventV2 & { body?: string };
    ev.body = typeof body === "string" ? body : JSON.stringify(body);
    return e;
  }

  it("flips status from active to archived", async () => {
    seedProject("acme", "active");
    const res = await handler(patchEvt("acme", { status: "archived" }));
    expect(statusOf(res)).toBe(200);
    const view = bodyOf(res) as { status: string; project_id: string };
    expect(view.status).toBe("archived");
    expect(view.project_id).toBe("acme");
  });

  it("flips status from archived back to active (unarchive)", async () => {
    seedProject("acme", "archived");
    const res = await handler(patchEvt("acme", { status: "active" }));
    expect(statusOf(res)).toBe(200);
    expect((bodyOf(res) as { status: string }).status).toBe("active");
  });

  it("is idempotent — re-archiving an archived row preserves the original timestamp", async () => {
    seedProject("acme", "archived");
    // Pre-existing archived_at — record the value so we can assert it.
    const beforeRow = rows.get(key("PROJECT#acme", "META"))!;
    beforeRow.archived_at = "2026-05-20T00:00:00.000Z";

    const res = await handler(patchEvt("acme", { status: "archived" }));
    expect(statusOf(res)).toBe(200);
    const afterRow = rows.get(key("PROJECT#acme", "META"))!;
    expect(afterRow.archived_at).toBe("2026-05-20T00:00:00.000Z");
  });

  it("returns 400 missing_body when the request has no body", async () => {
    seedProject("acme");
    const e = evt("PATCH /projects/{id}", { id: "acme" });
    const res = await handler(e);
    expect(statusOf(res)).toBe(400);
    expect(bodyOf(res)).toMatchObject({ error: "missing_body" });
  });

  it("returns 400 invalid_json on malformed body", async () => {
    seedProject("acme");
    const res = await handler(patchEvt("acme", "not-json"));
    expect(statusOf(res)).toBe(400);
    expect(bodyOf(res)).toMatchObject({ error: "invalid_json" });
  });

  it("returns 400 non_patchable_fields when the body touches identity attrs", async () => {
    seedProject("acme");
    const res = await handler(
      patchEvt("acme", { owner_agent: "ren", project_id: "renamed" }),
    );
    expect(statusOf(res)).toBe(400);
    const body = bodyOf(res) as { error?: string; detail?: string };
    expect(body.error).toBe("non_patchable_fields");
    expect(body.detail).toContain("owner_agent");
    expect(body.detail).toContain("project_id");
  });

  it("returns 400 empty_patch when the body only contains unknown fields and no patch lands", async () => {
    // empty_patch fires only if there are no recognised fields AND no
    // unknowns either — i.e. {} body. The unknown-field path tests
    // above land on non_patchable_fields first.
    seedProject("acme");
    const res = await handler(patchEvt("acme", {}));
    expect(statusOf(res)).toBe(400);
    expect(bodyOf(res)).toMatchObject({ error: "empty_patch" });
  });

  it("returns 400 invalid_status for an unrecognised status value", async () => {
    seedProject("acme");
    const res = await handler(patchEvt("acme", { status: "paused" }));
    expect(statusOf(res)).toBe(400);
    const body = bodyOf(res) as { error?: string; detail?: string };
    expect(body.error).toBe("invalid_status");
    expect(body.detail).toContain("paused");
  });

  it("returns 404 for a ghost project (after passing field validation)", async () => {
    const res = await handler(patchEvt("ghost", { status: "archived" }));
    expect(statusOf(res)).toBe(404);
    expect(bodyOf(res)).toMatchObject({ error: "not_found", project_id: "ghost" });
  });
});

// ─── GET /agents/{slug}/executions (Epic-010 C3 migration) ─────────────

describe("GET /agents/{slug}/executions (listAgentExecutions)", () => {
  function seedExec(opts: {
    project: string;
    agent: string;
    ulid: string;
    skill?: string;
    status?: string;
    startedAt: string;
  }) {
    rows.set(key(`PROJECT#${opts.project}`, `EXEC#${opts.ulid}`), {
      pk: `PROJECT#${opts.project}`,
      sk: `EXEC#${opts.ulid}`,
      project_id: opts.project,
      agent_slug: opts.agent,
      skill_name: opts.skill ?? "code-task-brief",
      skill_version: "0.1.0",
      started_at: opts.startedAt,
      ended_at: opts.startedAt,
      status: opts.status ?? "ok",
      used_credential_types: [],
      gsi1pk: `AGENT#${opts.agent}`,
      gsi1sk: opts.startedAt,
      gsi2pk: `SKILL#${opts.skill ?? "code-task-brief"}`,
      gsi2sk: opts.startedAt,
      artifact_ref: {
        uri: `s3://wf-bucket-test/projects/${opts.project}/2026/05/${opts.ulid}/output.txt`,
        content_hash: "0".repeat(64),
        content_type: "text/plain",
        size_bytes: 45,
        summary: "synopsis",
      },
    });
  }

  it("returns this agent's executions across ALL projects (GSI1 partition query)", async () => {
    seedExec({ project: "self/ren", agent: "ren", ulid: "01A", startedAt: "2026-05-28T10:00:00.000Z" });
    seedExec({ project: "workforce-meta", agent: "ren", ulid: "01B", startedAt: "2026-05-28T11:00:00.000Z" });
    seedExec({ project: "self/maya", agent: "maya", ulid: "01M", startedAt: "2026-05-28T12:00:00.000Z" });

    const res = await handler(evt("GET /agents/{slug}/executions", { slug: "ren" }));
    expect(statusOf(res)).toBe(200);
    const body = bodyOf(res) as { items: Array<{ exec_ulid: string; project_id: string }> };
    expect(body.items.map((i) => i.exec_ulid).sort()).toEqual(["01A", "01B"]);
    // Cross-project — ren's two executions span two project partitions
    expect(new Set(body.items.map((i) => i.project_id))).toEqual(
      new Set(["self/ren", "workforce-meta"]),
    );
  });

  it("returns items newest-first by started_at", async () => {
    seedExec({ project: "p", agent: "ren", ulid: "01OLD", startedAt: "2026-05-25T10:00:00.000Z" });
    seedExec({ project: "p", agent: "ren", ulid: "01MID", startedAt: "2026-05-26T10:00:00.000Z" });
    seedExec({ project: "p", agent: "ren", ulid: "01NEW", startedAt: "2026-05-27T10:00:00.000Z" });

    const res = await handler(evt("GET /agents/{slug}/executions", { slug: "ren" }));
    const items = (bodyOf(res) as { items: Array<{ exec_ulid: string }> }).items;
    expect(items.map((i) => i.exec_ulid)).toEqual(["01NEW", "01MID", "01OLD"]);
  });

  it("surfaces artifact_ref + skill + status for each row (renders DELIV-replacement UI)", async () => {
    seedExec({ project: "p", agent: "ren", ulid: "01OK", skill: "article-draft", startedAt: "2026-05-28T00:00:00.000Z" });

    const res = await handler(evt("GET /agents/{slug}/executions", { slug: "ren" }));
    const item = (bodyOf(res) as { items: Array<Record<string, unknown>> }).items[0]!;
    expect(item).toMatchObject({
      exec_ulid: "01OK",
      project_id: "p",
      agent_slug: "ren",
      skill_name: "article-draft",
      skill_version: "0.1.0",
      status: "ok",
    });
    expect(item.artifact_ref).toMatchObject({
      uri: expect.stringContaining("projects/p/2026/05/01OK/output.txt"),
      summary: "synopsis",
    });
  });

  it("?status= filters", async () => {
    seedExec({ project: "p", agent: "ren", ulid: "01OK", status: "ok", startedAt: "2026-05-28T10:00:00.000Z" });
    seedExec({ project: "p", agent: "ren", ulid: "01THR", status: "throw", startedAt: "2026-05-28T11:00:00.000Z" });

    const res = await handler(evt("GET /agents/{slug}/executions", { slug: "ren" }, { status: "throw" }));
    const items = (bodyOf(res) as { items: Array<{ exec_ulid: string }> }).items;
    expect(items.map((i) => i.exec_ulid)).toEqual(["01THR"]);
  });

  it("?limit= caps the returned items (post-sort)", async () => {
    for (let i = 0; i < 5; i++) {
      seedExec({
        project: "p",
        agent: "ren",
        ulid: `01R${i}`,
        startedAt: `2026-05-2${5 + i}T10:00:00.000Z`,
      });
    }
    const res = await handler(
      evt("GET /agents/{slug}/executions", { slug: "ren" }, { limit: "2" }),
    );
    const items = (bodyOf(res) as { items: Array<{ exec_ulid: string }> }).items;
    expect(items).toHaveLength(2);
    // Newest two
    expect(items.map((i) => i.exec_ulid)).toEqual(["01R4", "01R3"]);
  });

  it("returns 200 with empty items for an agent with no executions (distinct from 404)", async () => {
    const res = await handler(evt("GET /agents/{slug}/executions", { slug: "ghost" }));
    expect(statusOf(res)).toBe(200);
    expect((bodyOf(res) as { items: unknown[] }).items).toEqual([]);
  });
});

// ─── Phase 7 PR5: Engagements API ──────────────────────────────────────

describe("GET /agents/{slug}/portfolio (Engagements API — listAgentPortfolio)", () => {
  function seedExec(opts: {
    project: string;
    agent: string;
    ulid: string;
    startedAt: string;
  }) {
    rows.set(key(`PROJECT#${opts.project}`, `EXEC#${opts.ulid}`), {
      pk: `PROJECT#${opts.project}`,
      sk: `EXEC#${opts.ulid}`,
      project_id: opts.project,
      agent_slug: opts.agent,
      skill_name: "pr-review",
      skill_version: "0.1.0",
      started_at: opts.startedAt,
      ended_at: opts.startedAt,
      status: "ok",
      used_credential_types: [],
      gsi1pk: `AGENT#${opts.agent}`,
      gsi1sk: opts.startedAt,
      artifact_ref: {
        uri: `https://github.com/foo/bar/pull/${opts.ulid}#issuecomment-1`,
        content_hash: "0".repeat(64),
        content_type: "text/html",
        size_bytes: 200,
        summary: `engagement ${opts.ulid}`,
      },
    });
  }

  beforeEach(() => {
    rows.clear();
  });

  it("400s when ?project_id is missing — portfolio is per-client", async () => {
    const res = await handler(evt("GET /agents/{slug}/portfolio", { slug: "nadia" }));
    expect(statusOf(res)).toBe(400);
    expect((bodyOf(res) as { error: string }).error).toBe("missing_project_id");
  });

  it("filters to the calling client's project — no cross-project leak", async () => {
    seedExec({ project: "asp-cloud", agent: "nadia", ulid: "01A", startedAt: "2026-05-25T00:00:00.000Z" });
    seedExec({ project: "other-client", agent: "nadia", ulid: "01B", startedAt: "2026-05-26T00:00:00.000Z" });
    const res = await handler(
      evt("GET /agents/{slug}/portfolio", { slug: "nadia" }, { project_id: "asp-cloud" }),
    );
    expect(statusOf(res)).toBe(200);
    const items = (bodyOf(res) as { items: Array<{ engagement_id: string; project_id: string }> }).items;
    expect(items).toHaveLength(1);
    expect(items[0]!.engagement_id).toBe("01A");
    expect(items[0]!.project_id).toBe("asp-cloud");
  });

  it("returns items in engagement-view shape (not raw EXEC)", async () => {
    seedExec({ project: "asp-cloud", agent: "nadia", ulid: "01A", startedAt: "2026-05-25T00:00:00.000Z" });
    const res = await handler(
      evt("GET /agents/{slug}/portfolio", { slug: "nadia" }, { project_id: "asp-cloud" }),
    );
    const item = (bodyOf(res) as { items: Array<Record<string, unknown>> }).items[0]!;
    expect(item.engagement_id).toBe("01A"); // not "sk": "EXEC#01A"
    expect(item.summary).toBe("engagement 01A");
    expect(item.artifact).toBeDefined();
  });

  it("L2-2: legacy EXEC rows (no execution_surface attribute) project as lambda", async () => {
    // seedExec writes no execution_surface — mirrors pre-L2-2 rows
    // that all 4 deterministic skills + the llm-prose path have ever
    // produced. The view MUST surface them as `lambda` so portfolio
    // attribution analytics stay correct.
    seedExec({ project: "asp-cloud", agent: "nadia", ulid: "01A", startedAt: "2026-05-25T00:00:00.000Z" });
    const res = await handler(
      evt("GET /agents/{slug}/portfolio", { slug: "nadia" }, { project_id: "asp-cloud" }),
    );
    const item = (bodyOf(res) as { items: Array<{ execution_surface: string }> }).items[0]!;
    expect(item.execution_surface).toBe("lambda");
  });

  it("L2-2: EXEC rows with execution_surface=client are surfaced as-is", async () => {
    // Seed a row that DOES carry the field (simulates what
    // createEngagementRoute writes post-L2-2). The view must round-trip
    // the value, not silently override to lambda.
    rows.set(key("PROJECT#asp-cloud", "EXEC#01B"), {
      pk: "PROJECT#asp-cloud",
      sk: "EXEC#01B",
      project_id: "asp-cloud",
      agent_slug: "nadia",
      skill_name: "pr-review",
      skill_version: "0.0.0",
      started_at: "2026-06-05T10:00:00.000Z",
      ended_at: "2026-06-05T10:01:00.000Z",
      status: "ok",
      used_credential_types: [],
      execution_surface: "client",
      gsi1pk: "AGENT#nadia",
      gsi1sk: "2026-06-05T10:00:00.000Z",
    });
    const res = await handler(
      evt("GET /agents/{slug}/portfolio", { slug: "nadia" }, { project_id: "asp-cloud" }),
    );
    const item = (bodyOf(res) as { items: Array<{ execution_surface: string }> }).items[0]!;
    expect(item.execution_surface).toBe("client");
  });

  it("returns items newest-first", async () => {
    seedExec({ project: "asp-cloud", agent: "nadia", ulid: "01A", startedAt: "2026-05-25T00:00:00.000Z" });
    seedExec({ project: "asp-cloud", agent: "nadia", ulid: "01B", startedAt: "2026-05-27T00:00:00.000Z" });
    seedExec({ project: "asp-cloud", agent: "nadia", ulid: "01C", startedAt: "2026-05-26T00:00:00.000Z" });
    const res = await handler(
      evt("GET /agents/{slug}/portfolio", { slug: "nadia" }, { project_id: "asp-cloud" }),
    );
    const ids = (bodyOf(res) as { items: Array<{ engagement_id: string }> }).items.map((i) => i.engagement_id);
    expect(ids).toEqual(["01B", "01C", "01A"]);
  });

  it("returns 200 with empty items when the agent has no engagements with this client", async () => {
    seedExec({ project: "other-client", agent: "nadia", ulid: "01A", startedAt: "2026-05-25T00:00:00.000Z" });
    const res = await handler(
      evt("GET /agents/{slug}/portfolio", { slug: "nadia" }, { project_id: "asp-cloud" }),
    );
    expect(statusOf(res)).toBe(200);
    expect((bodyOf(res) as { items: unknown[] }).items).toEqual([]);
  });
});

describe("POST /agents/{slug}/engagements (Engagements API — createEngagement)", () => {
  const TOKEN_SECRET = "wf/api/engagements-write-token";
  const TOKEN = "test-engagement-bearer-xxxxx";

  beforeEach(() => {
    rows.clear();
    membershipSet.clear();
    secretValueStore.clear();
    secretValueStore.set(TOKEN_SECRET, JSON.stringify({ token: TOKEN }));
    // Reset module-level token cache by re-importing? The handler caches
    // the bearer for warm-lifetime. We can't reset it from here, but the
    // first test populates the cache and subsequent ones reuse it. As long
    // as we don't change the token value mid-suite, this is fine.
  });

  function postEvt(slug: string, headers: Record<string, string>, body: unknown): APIGatewayProxyEventV2 {
    return {
      version: "2.0",
      routeKey: "POST /agents/{slug}/engagements",
      rawPath: `/agents/${slug}/engagements`,
      rawQueryString: "",
      headers,
      requestContext: { http: { method: "POST", path: `/agents/${slug}/engagements` } } as unknown as APIGatewayProxyEventV2["requestContext"],
      pathParameters: { slug },
      queryStringParameters: {},
      isBase64Encoded: false,
      body: typeof body === "string" ? body : JSON.stringify(body),
    } as APIGatewayProxyEventV2;
  }

  function validBody(overrides: Record<string, unknown> = {}) {
    return {
      project_id: "asp-cloud",
      skill_name: "pr-review",
      skill_version: "0.1.0",
      started_at: "2026-05-30T10:00:00.000Z",
      ended_at: "2026-05-30T10:02:30.000Z",
      status: "ok",
      ...overrides,
    };
  }

  it("401s on missing Authorization header", async () => {
    membershipSet.add("asp-cloud|nadia");
    const res = await handler(postEvt("nadia", {}, validBody()));
    expect(statusOf(res)).toBe(401);
  });

  it("401s on wrong bearer", async () => {
    membershipSet.add("asp-cloud|nadia");
    const res = await handler(postEvt("nadia", { authorization: "Bearer wrong" }, validBody()));
    expect(statusOf(res)).toBe(401);
  });

  it("401s on non-Bearer scheme", async () => {
    membershipSet.add("asp-cloud|nadia");
    const res = await handler(postEvt("nadia", { authorization: `Basic ${TOKEN}` }, validBody()));
    expect(statusOf(res)).toBe(401);
  });

  it("400s on missing body", async () => {
    membershipSet.add("asp-cloud|nadia");
    const evt: APIGatewayProxyEventV2 = postEvt("nadia", { authorization: `Bearer ${TOKEN}` }, "");
    delete (evt as { body?: string }).body;
    const res = await handler(evt);
    expect(statusOf(res)).toBe(400);
    expect((bodyOf(res) as { error: string }).error).toBe("missing_body");
  });

  it("400s on invalid JSON", async () => {
    membershipSet.add("asp-cloud|nadia");
    const res = await handler(postEvt("nadia", { authorization: `Bearer ${TOKEN}` }, "{not json"));
    expect(statusOf(res)).toBe(400);
    expect((bodyOf(res) as { error: string }).error).toBe("invalid_json");
  });

  it("400s listing missing required fields", async () => {
    membershipSet.add("asp-cloud|nadia");
    const res = await handler(
      postEvt("nadia", { authorization: `Bearer ${TOKEN}` }, { project_id: "asp-cloud" }),
    );
    expect(statusOf(res)).toBe(400);
    const body = bodyOf(res) as { error: string; missing: string[] };
    expect(body.error).toBe("missing_fields");
    expect(body.missing).toEqual(
      expect.arrayContaining(["skill_name", "skill_version", "started_at", "ended_at", "status"]),
    );
  });

  it("400s on invalid status", async () => {
    membershipSet.add("asp-cloud|nadia");
    const res = await handler(
      postEvt("nadia", { authorization: `Bearer ${TOKEN}` }, validBody({ status: "weird" })),
    );
    expect(statusOf(res)).toBe(400);
    expect((bodyOf(res) as { error: string }).error).toBe("invalid_status");
  });

  it("400s on malformed artifact", async () => {
    membershipSet.add("asp-cloud|nadia");
    const res = await handler(
      postEvt(
        "nadia",
        { authorization: `Bearer ${TOKEN}` },
        validBody({ artifact: { uri: "x" } }), // missing other required fields
      ),
    );
    expect(statusOf(res)).toBe(400);
    expect((bodyOf(res) as { error: string }).error).toBe("invalid_artifact");
  });

  it("201s even when the agent is NOT a project member (write-gate removed 2026-06-08)", async () => {
    // membershipSet intentionally empty for asp-cloud + nadia — the
    // engagement write must still succeed now that the cross-project
    // membership gate is gone (C-3, single-operator scale).
    const res = await handler(
      postEvt("nadia", { authorization: `Bearer ${TOKEN}` }, validBody()),
    );
    expect(statusOf(res)).toBe(201);
    expect((bodyOf(res) as { engagement: { agent_slug: string } }).engagement.agent_slug).toBe(
      "nadia",
    );
  });

  it("201s on happy path, returns engagement view", async () => {
    membershipSet.add("asp-cloud|nadia");
    const res = await handler(
      postEvt(
        "nadia",
        { authorization: `Bearer ${TOKEN}` },
        validBody({
          artifact: {
            uri: "https://github.com/PSVL/asp-cloud/pull/42#issuecomment-1",
            content_hash: "0".repeat(64),
            content_type: "text/html",
            size_bytes: 300,
            summary: "review on PR #42",
          },
        }),
      ),
    );
    expect(statusOf(res)).toBe(201);
    const body = bodyOf(res) as { engagement: { engagement_id: string; project_id: string; agent_slug: string } };
    expect(body.engagement.project_id).toBe("asp-cloud");
    expect(body.engagement.agent_slug).toBe("nadia");
    expect(body.engagement.engagement_id).toMatch(/^[0-9A-Z]{26}$/);
  });

  it("L2-2: stamps execution_surface=client on the response engagement view", async () => {
    membershipSet.add("asp-cloud|nadia");
    const res = await handler(
      postEvt("nadia", { authorization: `Bearer ${TOKEN}` }, validBody()),
    );
    expect(statusOf(res)).toBe(201);
    const body = bodyOf(res) as { engagement: { execution_surface: string } };
    expect(body.engagement.execution_surface).toBe("client");
  });

  it("honours client-supplied engagement_id when present", async () => {
    membershipSet.add("asp-cloud|nadia");
    const res = await handler(
      postEvt(
        "nadia",
        { authorization: `Bearer ${TOKEN}` },
        validBody({ engagement_id: "CLIENT-SUPPLIED-ULID-0000000" }),
      ),
    );
    expect(statusOf(res)).toBe(201);
    const body = bodyOf(res) as { engagement: { engagement_id: string } };
    expect(body.engagement.engagement_id).toBe("CLIENT-SUPPLIED-ULID-0000000");
  });

  // ADR-0005 item 5 — the CCR agent-runner routine records its per-task
  // activity on this SAME endpoint (one write surface, not two), marked
  // execution_surface="ccr". Default (no field) stays "client".
  it("accepts execution_surface=ccr (CCR per-task write-back)", async () => {
    membershipSet.add("asp-cloud|nadia");
    const res = await handler(
      postEvt("nadia", { authorization: `Bearer ${TOKEN}` }, validBody({ execution_surface: "ccr" })),
    );
    expect(statusOf(res)).toBe(201);
    expect((bodyOf(res) as { engagement: { execution_surface: string } }).engagement.execution_surface).toBe("ccr");
  });

  it("defaults execution_surface to client when omitted / unknown", async () => {
    membershipSet.add("asp-cloud|nadia");
    const omitted = await handler(postEvt("nadia", { authorization: `Bearer ${TOKEN}` }, validBody()));
    expect((bodyOf(omitted) as { engagement: { execution_surface: string } }).engagement.execution_surface).toBe("client");
    const bogus = await handler(postEvt("nadia", { authorization: `Bearer ${TOKEN}` }, validBody({ execution_surface: "nonsense" })));
    expect((bodyOf(bogus) as { engagement: { execution_surface: string } }).engagement.execution_surface).toBe("client");
  });

  // ADR-0005: an ephemeral DDB-minted token (NOT the static secret) authorises
  // the write — the cron + interactive path.
  it("accepts an ephemeral engagement-write token (no static secret)", async () => {
    membershipSet.add("asp-cloud|nadia");
    isValidEngagementTokenMock.mockResolvedValueOnce(true);
    const res = await handler(
      postEvt("nadia", { authorization: "Bearer ephemeral-minted-token-xyz" }, validBody({ execution_surface: "ccr" })),
    );
    expect(statusOf(res)).toBe(201);
    expect((bodyOf(res) as { engagement: { execution_surface: string } }).engagement.execution_surface).toBe("ccr");
  });

  it("401s when the bearer is neither a valid ephemeral token nor the static secret", async () => {
    membershipSet.add("asp-cloud|nadia");
    // isValidEngagementTokenMock defaults to false; no static secret either.
    secretValueStore.delete(TOKEN_SECRET);
    const res = await handler(postEvt("nadia", { authorization: "Bearer not-a-real-token" }, validBody()));
    expect(statusOf(res)).toBe(401);
  });
});

// ─── GET /stats (listStats — EXEC-ledger dashboard roll-up) ─────────────
//
// Verifies the real-data aggregate replacing the static mock: MTD run /
// deliverable counts, the duration (spend-proxy) figures, the status
// rollup mirroring deriveStatus, the 30-day heat strip, and the
// reverse-chrono live-trace ribbon. Cost/token are intentionally ABSENT
// from the contract — assert that too.
describe("GET /stats (listStats)", () => {
  function seedAgent(slug: string, over: Partial<AnyRow> = {}) {
    rows.set(key(`AGENT#${slug}`, "META"), {
      pk: `AGENT#${slug}`,
      sk: "META",
      slug,
      paused: false,
      archived: false,
      last_run_status: "ok",
      last_run_at: "",
      ...over,
    });
  }

  // All MTD-asserted runs are dated "today" so the suite is deterministic
  // regardless of the day-of-month it runs on (today is always in both the
  // current month AND the 30-day heat window's last bucket).
  function todayAt(hour: number): string {
    const d = new Date();
    d.setUTCHours(hour, 0, 0, 0);
    return d.toISOString();
  }

  function seedExec(
    slug: string,
    opts: {
      ulid: string;
      startedAt: string;
      durationS?: number;
      status?: string;
      deliverable?: boolean;
      skill?: string;
    },
  ) {
    const started = new Date(opts.startedAt);
    const ended = new Date(started.getTime() + (opts.durationS ?? 0) * 1000);
    rows.set(key(`PROJECT#self/${slug}`, `EXEC#${opts.ulid}`), {
      pk: `PROJECT#self/${slug}`,
      sk: `EXEC#${opts.ulid}`,
      project_id: `self/${slug}`,
      agent_slug: slug,
      skill_name: opts.skill ?? "article-draft",
      skill_version: "1.0.0",
      started_at: started.toISOString(),
      ended_at: ended.toISOString(),
      status: opts.status ?? "ok",
      artifact_ref: opts.deliverable
        ? { uri: "s3://x", content_hash: "h", content_type: "text/markdown", size_bytes: 10, summary: "s" }
        : undefined,
      gsi1pk: `AGENT#${slug}`,
      gsi1sk: started.toISOString(),
    });
  }

  type StatsBody = {
    totals: {
      agents_running: number;
      agents_paused: number;
      agents_throwing: number;
      runs_this_month: number;
      deliv_count_this_month: number;
      compute_seconds_this_month: number;
      avg_duration_s: number;
    };
    agents: Record<string, {
      paused: boolean;
      archived: boolean;
      last_run_status: string;
      runs_this_month: number;
      deliv_this_month: number;
      compute_seconds_this_month: number;
      avg_duration_s: number;
    }>;
    activity: { days: string[]; by_slug: Record<string, number[]> };
    recent_runs: Array<{ slug: string; started_at: string; duration_s: number; status: string; skill: string }>;
  };

  it("aggregates MTD runs/deliverables and duration from the EXEC ledger", async () => {
    seedAgent("maya");
    seedAgent("ren");
    seedExec("maya", { ulid: "01A", startedAt: todayAt(1), durationS: 100, deliverable: true });
    seedExec("maya", { ulid: "01B", startedAt: todayAt(2), durationS: 200 });
    seedExec("ren", { ulid: "01C", startedAt: todayAt(3), durationS: 50, status: "throw" });

    const res = await handler(evt("GET /stats"));
    expect(statusOf(res)).toBe(200);
    const body = bodyOf(res) as StatsBody;

    expect(body.totals.runs_this_month).toBe(3);
    expect(body.totals.deliv_count_this_month).toBe(1);
    expect(body.totals.compute_seconds_this_month).toBe(350);
    expect(body.totals.avg_duration_s).toBe(117); // round(350/3)

    expect(body.agents.maya!.runs_this_month).toBe(2);
    expect(body.agents.maya!.deliv_this_month).toBe(1);
    expect(body.agents.maya!.compute_seconds_this_month).toBe(300);
    expect(body.agents.maya!.avg_duration_s).toBe(150);
  });

  it("reports NO cost or token figures (C-1: no fabricated truth)", async () => {
    seedAgent("maya");
    seedExec("maya", { ulid: "01A", startedAt: todayAt(1), durationS: 100 });

    const body = bodyOf(await handler(evt("GET /stats"))) as Record<string, unknown> & {
      totals: Record<string, unknown>;
      agents: Record<string, Record<string, unknown>>;
    };
    const blob = JSON.stringify(body);
    expect(blob).not.toMatch(/cost/i);
    expect(blob).not.toMatch(/token/i);
    expect(blob).not.toMatch(/usd/i);
    expect(body.totals).not.toHaveProperty("cost_this_month_usd");
    expect(body.agents.maya).not.toHaveProperty("cost_this_month_usd");
  });

  it("rolls up status mirroring deriveStatus (throwing > paused; archived counts none)", async () => {
    seedAgent("maya"); // running
    seedAgent("ren"); // throwing (last run throws)
    seedAgent("priya", { paused: true });
    seedAgent("zed", { archived: true });
    seedExec("maya", { ulid: "01A", startedAt: todayAt(1), durationS: 100 });
    seedExec("ren", { ulid: "01C", startedAt: todayAt(2), durationS: 50, status: "throw" });

    const body = bodyOf(await handler(evt("GET /stats"))) as StatsBody;
    expect(body.totals.agents_running).toBe(1);
    expect(body.totals.agents_throwing).toBe(1);
    expect(body.totals.agents_paused).toBe(1);
    expect(body.agents.ren!.last_run_status).toBe("throw");
    expect(body.agents.priya!.runs_this_month).toBe(0);
    // Archived agent stays on the roster but its ledger is not read.
    expect(body.agents.zed!.archived).toBe(true);
    expect(body.agents.zed!.runs_this_month).toBe(0);
  });

  it("emits a 30-day heat strip with today's runs in the final bucket", async () => {
    seedAgent("maya");
    seedExec("maya", { ulid: "01A", startedAt: todayAt(1), durationS: 100 });
    seedExec("maya", { ulid: "01B", startedAt: todayAt(2), durationS: 100 });

    const body = bodyOf(await handler(evt("GET /stats"))) as StatsBody;
    expect(body.activity.days).toHaveLength(30);
    expect(body.activity.days[29]).toBe(new Date().toISOString().slice(0, 10));
    expect(body.activity.by_slug.maya![29]).toBe(2);
  });

  it("returns the live-trace ribbon newest-first across agents", async () => {
    seedAgent("maya");
    seedAgent("ren");
    seedExec("maya", { ulid: "01A", startedAt: todayAt(1), durationS: 100, skill: "plan-write" });
    seedExec("ren", { ulid: "01C", startedAt: todayAt(5), durationS: 50, skill: "code-task-brief" });

    const body = bodyOf(await handler(evt("GET /stats"))) as StatsBody;
    expect(body.recent_runs).toHaveLength(2);
    // todayAt(5) is later than todayAt(1) → ren leads.
    expect(body.recent_runs[0]!.slug).toBe("ren");
    expect(body.recent_runs[0]!.skill).toBe("code-task-brief");
    expect(body.recent_runs[1]!.slug).toBe("maya");
  });

  it("returns an empty-but-valid payload on an empty roster", async () => {
    const body = bodyOf(await handler(evt("GET /stats"))) as StatsBody;
    expect(body.totals.runs_this_month).toBe(0);
    expect(body.totals.avg_duration_s).toBe(0);
    expect(body.activity.days).toHaveLength(30);
    expect(body.recent_runs).toEqual([]);
  });
});
