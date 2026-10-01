// Unit tests for the ADR-0017 skill lifecycle surface in agents-api:
//
//   - POST /skills creates a judgment-only skill (validated, audited, 201),
//     409s on a duplicate slug, 422s on bad input / code-side keys
//   - GET /skills hides archived skills by default; ?include_archived=true
//     (or ?status=archived) reveals them
//   - PATCH /skills/{name} accepts display_name and status=archived
//   - GET /skills/{name}/executions serves the per-skill run ledger
//     (?agent= post-filter) and 404s on an unknown skill
//
// Pattern modelled on patch-skill-tests.ts: in-memory row map behind the
// DDB mock, real route dispatcher + real skill-config module under test.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

process.env.STAGE = "test";

interface AnyRow {
  pk: string;
  sk: string;
  [k: string]: unknown;
}
class FakeConditionalCheckFailed extends Error {}
const rows = new Map<string, AnyRow>();
const key = (pk: string, sk: string) => `${pk}|${sk}`;

vi.mock("@aws-sdk/client-cloudwatch", () => ({
  CloudWatchClient: class {
    async send() {}
  },
  PutMetricDataCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock("../shared/ddb.js", () => ({
  getItem: vi.fn(async (pk: string, sk: string) => rows.get(key(pk, sk))),
  scanPrefix: vi.fn(async (pkPrefix: string, sk: string, limit: number) => {
    const items = Array.from(rows.values()).filter(
      (r) => r.pk.startsWith(pkPrefix) && r.sk === sk,
    );
    return { items: items.slice(0, limit), cursor: undefined };
  }),
  scanAllPrefix: vi.fn(async (pkPrefix: string, sk: string) =>
    Array.from(rows.values()).filter((r) => r.pk.startsWith(pkPrefix) && r.sk === sk),
  ),
  queryBySkPrefix: vi.fn(async () => []),
  queryByGsi: vi.fn(async () => []),
  updateOperational: vi.fn(
    async (pk: string, sk: string, patch: Record<string, unknown>) => {
      const row = rows.get(key(pk, sk));
      if (!row) throw new Error("no row");
      for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) row[k] = v;
      }
      row.updated_at = "2026-07-03T00:00:00.000Z";
      return { ...row };
    },
  ),
  putItem: vi.fn(async (item: AnyRow) => {
    rows.set(key(item.pk, item.sk), item);
  }),
  ConditionalCheckFailedException: FakeConditionalCheckFailed,
  conditionalPutItem: vi.fn(async (item: AnyRow) => {
    if (rows.has(key(item.pk, item.sk))) {
      throw new FakeConditionalCheckFailed("conditional request failed");
    }
    rows.set(key(item.pk, item.sk), item);
  }),
  queryBySkPrefixPaged: vi.fn(
    async (pk: string, skPrefix: string, limit: number, _cursor?: string, asc?: boolean) => {
      const items = Array.from(rows.values())
        .filter((r) => r.pk === pk && r.sk.startsWith(skPrefix))
        .sort((a, b) => (asc === false ? (a.sk < b.sk ? 1 : -1) : a.sk < b.sk ? -1 : 1))
        .slice(0, limit);
      return { items, cursor: undefined };
    },
  ),
}));

// listExecutions is exercised through the project.js mock — the GSI2 query
// itself is covered by shared/project-tests.ts; here we assert the route's
// filtering + shaping contract.
const execFixtures: Array<Record<string, unknown>> = [];

// pr-remediate cycle 1 (finding O1): the original mock ignored `from` and
// `limit` entirely, so it could not reproduce the SKILL_ACTIVITY_EXEC_LIMIT
// truncation boundary `computeSkillActivity` depends on, nor the bounded
// `from`-scoped month query it now issues (A1). This mirrors the real
// `listExecutions` contract: filter by scope, then by the `from`/`to`
// range, sort newest-first (DDB's ScanIndexForward:false), then apply
// `limit` — in that order, since DDB applies Limit AFTER sorting. Defined
// as a standalone default (rather than inline in the `vi.fn()` call) so
// finding A2's degrade test can `.mockImplementationOnce` a throw for one
// skill and fall back to this for every other call.
async function defaultListExecutions(filter: {
  skill_name?: string;
  from?: string;
  to?: string;
  limit?: number;
}) {
  const scoped = execFixtures.filter(
    (e) => !filter.skill_name || e.skill_name === filter.skill_name,
  );
  const ranged = scoped.filter((e) => {
    const startedAt = e.started_at as string;
    if (filter.from && startedAt < filter.from) return false;
    if (filter.to && startedAt > filter.to) return false;
    return true;
  });
  const sorted = [...ranged].sort((a, b) => {
    const as = a.started_at as string;
    const bs = b.started_at as string;
    return as < bs ? 1 : as > bs ? -1 : 0;
  });
  return filter.limit ? sorted.slice(0, filter.limit) : sorted;
}
const listExecutionsMock = vi.fn(defaultListExecutions);
vi.mock("../shared/project.js", () => ({
  asProjectId: (s: string) => s,
  projectPk: (id: string) => `PROJECT#${id}`,
  getProject: vi.fn(async () => undefined),
  archive: vi.fn(),
  unarchive: vi.fn(),
  rename: vi.fn(),
  listExecutions: (...args: [Parameters<typeof defaultListExecutions>[0]]) =>
    listExecutionsMock(...args),
  appendExecution: vi.fn(),
}));
vi.mock("../shared/credential-injector.js", () => ({
  CREDENTIAL_TYPES: new Set(["github.token"]),
}));
vi.mock("../shared/recall.js", () => ({ recall: vi.fn(async () => []) }));
vi.mock("../shared/engagement-token.js", () => ({
  isValidEngagementToken: vi.fn(async () => false),
}));
vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: class {
    async send() {
      throw new Error("not used in these tests");
    }
  },
  DescribeSecretCommand: class {},
  GetSecretValueCommand: class {},
  ResourceNotFoundException: class extends Error {},
}));

// SUT must be imported AFTER all vi.mock() calls.
const { handler } = await import("./handler.js");

const OPERATOR_ARN = "arn:aws:iam::123456789012:user/operator";

function makeEvent(
  routeKey: string,
  opts: { name?: string; body?: unknown; qs?: Record<string, string> } = {},
): APIGatewayProxyEventV2 {
  const [method, path] = routeKey.split(" ") as [string, string];
  return {
    routeKey,
    pathParameters: opts.name ? { name: opts.name } : {},
    queryStringParameters: opts.qs,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    requestContext: {
      http: { method, path: path.replace("{name}", opts.name ?? "") },
      authorizer: { iam: { userArn: OPERATOR_ARN } },
    },
  } as unknown as APIGatewayProxyEventV2;
}

async function call(event: APIGatewayProxyEventV2): Promise<{ status: number; json: any }> {
  const res = (await handler(event)) as Exclude<APIGatewayProxyResultV2, string>;
  return { status: res.statusCode ?? 0, json: res.body ? JSON.parse(res.body as string) : undefined };
}

function seedSkill(name: string, over: Record<string, unknown> = {}): AnyRow {
  const row: AnyRow = {
    pk: `SKILL#${name}`,
    sk: "META",
    name,
    version: "0.1.0",
    status: "active",
    cost_class: "small",
    owners: ["grace"],
    improvement_agent: null,
    created_at: "2026-06-12",
    description: "A skill.",
    body: "# body",
    invocations_this_month: 0,
    identity_hash: "abc",
    updated_at: "2026-06-12T00:00:00.000Z",
    ...over,
  };
  rows.set(key(row.pk, "META"), row);
  return row;
}

function seedAgent(slug: string, archived = false): void {
  rows.set(key(`AGENT#${slug}`, "META"), {
    pk: `AGENT#${slug}`,
    sk: "META",
    slug,
    archived,
    bindings: [],
  });
}

const CREATE_BODY = {
  name: "meeting-brief",
  display_name: "Meeting Brief（会議ブリーフ）",
  description: "Summarise the week's meetings into one brief.",
  body: "# meeting-brief\n\nWrite the brief.",
  owners: ["grace"],
};

beforeEach(() => {
  rows.clear();
  execFixtures.length = 0;
  seedAgent("grace");
  seedAgent("oldtimer", true);
});

describe("POST /skills — judgment-only creation (ADR-0017)", () => {
  it("creates the skill (201), defaults version/status/cost_class, audits kind=create", async () => {
    const { status, json } = await call(makeEvent("POST /skills", { body: CREATE_BODY }));
    expect(status).toBe(201);
    expect(json.name).toBe("meeting-brief");
    expect(json.display_name).toBe("Meeting Brief（会議ブリーフ）");
    expect(json.version).toBe("0.1.0");
    expect(json.status).toBe("active");
    expect(json.cost_class).toBe("small");
    const row = rows.get(key("SKILL#meeting-brief", "META"));
    expect(row).toBeDefined();
    const audits = Array.from(rows.values()).filter(
      (r) => r.pk === "SKILL#meeting-brief" && r.sk.startsWith("AUDIT#"),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actor).toBe(OPERATOR_ARN);
  });

  it("409s on a duplicate slug", async () => {
    seedSkill("meeting-brief");
    const { status, json } = await call(makeEvent("POST /skills", { body: CREATE_BODY }));
    expect(status).toBe(409);
    expect(json.error).toBe("already_exists");
  });

  it("422s on a bad slug (the name is the immutable id, not a label)", async () => {
    const { status, json } = await call(
      makeEvent("POST /skills", { body: { ...CREATE_BODY, name: "Meeting Brief!" } }),
    );
    expect(status).toBe(422);
    expect(json.violations.some((v: any) => v.rule === "S0-name")).toBe(true);
  });

  it("422s when owners are missing or archived", async () => {
    const missing = await call(
      makeEvent("POST /skills", { body: { ...CREATE_BODY, owners: undefined } }),
    );
    expect(missing.status).toBe(422);
    const archived = await call(
      makeEvent("POST /skills", { body: { ...CREATE_BODY, owners: ["oldtimer"] } }),
    );
    expect(archived.status).toBe(422);
    expect(archived.json.violations.some((v: any) => v.rule === "J7-owner-archived")).toBe(true);
  });

  it("422s on code-side keys — requires/deliverable enter via the git scaffold only", async () => {
    const { status, json } = await call(
      makeEvent("POST /skills", { body: { ...CREATE_BODY, requires: ["github.token"] } }),
    );
    expect(status).toBe(422);
    expect(json.violations.some((v: any) => v.rule === "S1-unknown-key")).toBe(true);
  });
});

describe("GET /skills — archived skills are soft-deleted from the default list", () => {
  beforeEach(() => {
    seedSkill("alive");
    seedSkill("retired", { status: "archived" });
  });

  it("hides archived by default", async () => {
    const { json } = await call(makeEvent("GET /skills"));
    expect(json.items.map((s: any) => s.name)).toEqual(["alive"]);
  });

  it("?include_archived=true reveals them", async () => {
    const { json } = await call(makeEvent("GET /skills", { qs: { include_archived: "true" } }));
    expect(json.items.map((s: any) => s.name).sort()).toEqual(["alive", "retired"]);
  });

  it("?status=archived is an explicit opt-in", async () => {
    const { json } = await call(makeEvent("GET /skills", { qs: { status: "archived" } }));
    expect(json.items.map((s: any) => s.name)).toEqual(["retired"]);
  });
});

describe("PATCH /skills/{name} — display_name + archive lifecycle", () => {
  it("renames the display label without touching the slug", async () => {
    seedSkill("alive");
    const { status, json } = await call(
      makeEvent("PATCH /skills/{name}", { name: "alive", body: { display_name: "生存確認" } }),
    );
    expect(status).toBe(200);
    expect(json.display_name).toBe("生存確認");
    expect(json.name).toBe("alive");
  });

  it("accepts status=archived (soft delete) and back to active", async () => {
    seedSkill("alive");
    const a = await call(
      makeEvent("PATCH /skills/{name}", { name: "alive", body: { status: "archived" } }),
    );
    expect(a.status).toBe(200);
    expect(a.json.status).toBe("archived");
    const b = await call(
      makeEvent("PATCH /skills/{name}", { name: "alive", body: { status: "active" } }),
    );
    expect(b.json.status).toBe("active");
  });

  it("rejects an over-long display_name", async () => {
    seedSkill("alive");
    const { status } = await call(
      makeEvent("PATCH /skills/{name}", { name: "alive", body: { display_name: "x".repeat(121) } }),
    );
    expect(status).toBe(422);
  });
});

describe("GET /skills/{name}/executions — per-skill run ledger (ADR-0017 observability)", () => {
  beforeEach(() => {
    seedSkill("alive");
    execFixtures.push(
      {
        pk: "PROJECT#p",
        sk: "EXEC#01A",
        project_id: "p",
        agent_slug: "grace",
        skill_name: "alive",
        skill_version: "0.1.0",
        started_at: "2026-07-01T00:00:00Z",
        ended_at: "2026-07-01T00:01:00Z",
        status: "ok",
        summary: "did the thing",
      },
      {
        pk: "PROJECT#p",
        sk: "EXEC#01B",
        project_id: "p",
        agent_slug: "sana",
        skill_name: "alive",
        skill_version: "0.1.0",
        started_at: "2026-07-02T00:00:00Z",
        ended_at: "2026-07-02T00:01:00Z",
        status: "throw",
        error: "boom",
      },
    );
  });

  it("returns the skill's rows with exec_ulid derived from the sort key", async () => {
    const { status, json } = await call(
      makeEvent("GET /skills/{name}/executions", { name: "alive" }),
    );
    expect(status).toBe(200);
    expect(json.items.map((i: any) => i.exec_ulid).sort()).toEqual(["01A", "01B"]);
  });

  it("?agent= post-filters to one agent's runs", async () => {
    const { json } = await call(
      makeEvent("GET /skills/{name}/executions", { name: "alive", qs: { agent: "sana" } }),
    );
    expect(json.items).toHaveLength(1);
    expect(json.items[0]!.agent_slug).toBe("sana");
    expect(json.items[0]!.error).toBe("boom");
  });

  it("404s on an unknown skill", async () => {
    const { status } = await call(
      makeEvent("GET /skills/{name}/executions", { name: "ghost" }),
    );
    expect(status).toBe(404);
  });
});

describe("invocations_this_month / last_invoked_at — computed from the EXEC ledger (#767)", () => {
  // pr-remediate cycle 1 (finding O2): the original version read `new
  // Date()` here at test-definition time and relied on the SUT reading
  // `new Date()` again, independently, inside the request — two real-clock
  // reads that happen to agree almost always, but a UTC month rollover
  // landing between them (however rare) still flakes exactly the boundary
  // this suite exists to pin down. Freeze the clock instead: `now` below is
  // the only "current time" either side ever sees, so the flake this
  // comment claims to avoid is actually eliminated, not narrowed.
  const now = new Date("2026-06-15T12:00:00.000Z");
  const monthStartIso = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
  const lastMonthIso = new Date(
    Date.parse(monthStartIso) - 24 * 60 * 60 * 1000,
  ).toISOString();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    seedSkill("alive", { invocations_this_month: 0 }); // the stored field stays the stale literal
    // Pushed newest-first, matching listExecutions' documented contract
    // (queryByGsi ScanIndexForward:false) that the mock stands in for.
    execFixtures.push(
      {
        pk: "PROJECT#p",
        sk: "EXEC#02B",
        project_id: "p",
        agent_slug: "grace",
        skill_name: "alive",
        skill_version: "0.1.0",
        started_at: monthStartIso,
        ended_at: monthStartIso,
        status: "ok",
      },
      {
        pk: "PROJECT#p",
        sk: "EXEC#02A",
        project_id: "p",
        agent_slug: "grace",
        skill_name: "alive",
        skill_version: "0.1.0",
        started_at: lastMonthIso,
        ended_at: lastMonthIso,
        status: "ok",
      },
    );
  });

  it("GET /skills/{name} reports the real count instead of the stale stored 0", async () => {
    const { status, json } = await call(
      makeEvent("GET /skills/{name}", { name: "alive" }),
    );
    expect(status).toBe(200);
    expect(json.invocations_this_month).toBe(1); // only the in-month row counts
    expect(json.last_invoked_at).toBe(monthStartIso); // the newest row overall, in- or out-of-month
  });

  it("GET /skills list computes it per-item too", async () => {
    const { json } = await call(makeEvent("GET /skills"));
    const alive = json.items.find((s: any) => s.name === "alive");
    expect(alive.invocations_this_month).toBe(1);
    expect(alive.last_invoked_at).toBe(monthStartIso);
  });

  it("a skill with zero EXEC rows still reads 0 / undefined, not stale data", async () => {
    seedSkill("untouched");
    const { json } = await call(makeEvent("GET /skills/{name}", { name: "untouched" }));
    expect(json.invocations_this_month).toBe(0);
    expect(json.last_invoked_at).toBeUndefined();
  });

  // pr-remediate cycle 1 (finding O1): the count query is separately bounded
  // by SKILL_ACTIVITY_EXEC_LIMIT (1000, handler.ts) from the last-invoked
  // query (limit:1) — this seeds past that ceiling to prove the month count
  // truncates there instead of silently overcounting past it (or, before
  // this fix's mock update, being unable to exercise the ceiling at all).
  it("invocations_this_month truncates at SKILL_ACTIVITY_EXEC_LIMIT (1000) instead of overcounting past it", async () => {
    seedSkill("prolific");
    const minuteMs = 60 * 1000;
    const monthStartMs = Date.parse(monthStartIso);
    for (let i = 0; i < 1005; i++) {
      const ts = new Date(monthStartMs + i * minuteMs).toISOString();
      execFixtures.push({
        pk: "PROJECT#p",
        sk: `EXEC#${String(i).padStart(4, "0")}`,
        project_id: "p",
        agent_slug: "grace",
        skill_name: "prolific",
        skill_version: "0.1.0",
        started_at: ts,
        ended_at: ts,
        status: "ok",
      });
    }
    const { json } = await call(makeEvent("GET /skills/{name}", { name: "prolific" }));
    expect(json.invocations_this_month).toBe(1000); // capped, not 1005
    // last_invoked_at is a separate limit:1 query — unaffected by the count
    // ceiling, so it still reports the true newest row (index 1004).
    expect(json.last_invoked_at).toBe(
      new Date(monthStartMs + 1004 * minuteMs).toISOString(),
    );
  });

  // pr-remediate cycle 1 (finding A2): one skill's EXEC-ledger read failing
  // must degrade that row to its stored fields, not fail the whole list —
  // matching the endpoint's pre-#767 resilience (a scan-then-read shape
  // where one bad row could never take the list down).
  it("GET /skills degrades one skill to its stored fields when its ledger query throws, without failing the list", async () => {
    seedSkill("flaky", { invocations_this_month: 0 });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    listExecutionsMock.mockImplementation(async (filter) => {
      if (filter.skill_name === "flaky") throw new Error("ledger unavailable");
      return defaultListExecutions(filter);
    });
    const { status, json } = await call(makeEvent("GET /skills"));
    expect(status).toBe(200);
    const flaky = json.items.find((s: any) => s.name === "flaky");
    expect(flaky.invocations_this_month).toBe(0); // stored literal, not thrown through
    expect(flaky.last_invoked_at).toBeUndefined();
    const alive = json.items.find((s: any) => s.name === "alive");
    expect(alive.invocations_this_month).toBe(1); // sibling row still computed normally
    expect(errorSpy).toHaveBeenCalled(); // C-4: degraded silently to the caller, but not to the logs
    errorSpy.mockRestore();
  });

  afterEach(() => {
    vi.useRealTimers();
    listExecutionsMock.mockImplementation(defaultListExecutions);
  });
});
