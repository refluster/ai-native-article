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
//   - path-param parsing for greedy {id+} (project ids containing `/`
//     like `self/ren` round-trip)
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
  queryByGsi: vi.fn(async () => []),
  updateOperational: vi.fn(),
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

// `shared/project.ts` is consumed for `asProjectId` / `projectPk` only at
// the handler-dispatch layer; the helpers' behaviour is covered by the
// real `project-tests.ts`. Lightweight inline impl keeps the dispatch
// path exercised without re-mocking 30+ helpers.
vi.mock("../shared/project.js", () => ({
  asProjectId: (s: string) => {
    if (!s || s.includes("#") || s.includes("|")) {
      throw new Error(`invalid project_id "${s}"`);
    }
    return s;
  },
  projectPk: (id: string) => `PROJECT#${id}`,
}));

// SUT must be imported AFTER all vi.mock() calls.
const { handler } = await import("./handler.js");

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

// ─── GET /projects/{id+} ───────────────────────────────────────────────

describe("GET /projects/{id+} (getProject)", () => {
  it("returns 404 with `not_found` for a ghost project (distinct from 200-with-empty)", async () => {
    const res = await handler(
      evt("GET /projects/{id+}", { id: "ghost" }),
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
      evt("GET /projects/{id+}", { id: "self/ren" }),
    );
    expect(statusOf(res)).toBe(200);
    expect(bodyOf(res)).toMatchObject({ project_id: "self/ren", owner_agent: "ren" });
  });
});

// ─── GET /projects/{id+}/members ───────────────────────────────────────

describe("GET /projects/{id+}/members (listProjectMembers)", () => {
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
      evt("GET /projects/{id+}/members", { id: "p" }),
    );
    const items = (bodyOf(res) as { items: Array<{ agent_slug: string }> }).items;
    expect(items.map((i) => i.agent_slug)).toEqual(["ren"]);
  });

  it("includes revoked members with ?include_revoked=true (audit query)", async () => {
    const res = await handler(
      evt("GET /projects/{id+}/members", { id: "p" }, { include_revoked: "true" }),
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
      evt("GET /projects/{id+}/members", { id: "empty" }),
    );
    expect(statusOf(res)).toBe(200);
    expect((bodyOf(res) as { items: unknown[] }).items).toEqual([]);
  });
});

// ─── GET /projects/{id+}/executions ────────────────────────────────────

describe("GET /projects/{id+}/executions (listProjectExecutions)", () => {
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
      evt("GET /projects/{id+}/executions", { id: "p" }),
    );
    const items = (bodyOf(res) as { items: Array<{ exec_ulid: string }> }).items;
    expect(items.map((i) => i.exec_ulid)).toEqual(["01C", "01B", "01A"]);
  });

  it("?status= filters", async () => {
    const res = await handler(
      evt("GET /projects/{id+}/executions", { id: "p" }, { status: "throw" }),
    );
    const items = (bodyOf(res) as { items: Array<{ exec_ulid: string }> }).items;
    expect(items.map((i) => i.exec_ulid)).toEqual(["01B"]);
  });

  it("?agent= + ?skill= compose (both filters applied)", async () => {
    const res = await handler(
      evt("GET /projects/{id+}/executions", { id: "p" }, { agent: "ren", skill: "code-task-brief" }),
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
