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

import { beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("../shared/project.js", () => ({
  asProjectId: (s: string) => s,
  projectPk: (id: string) => `PROJECT#${id}`,
  getProject: vi.fn(async () => undefined),
  archive: vi.fn(),
  unarchive: vi.fn(),
  rename: vi.fn(),
  listExecutions: vi.fn(async (filter: { skill_name?: string }) =>
    execFixtures.filter((e) => !filter.skill_name || e.skill_name === filter.skill_name),
  ),
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
