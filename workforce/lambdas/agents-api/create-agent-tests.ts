// Unit tests for POST /agents (ADR-0007 Decision §2 — the Create of the
// "full CRUD over identity fields" the decision sanctions):
//
//   - a valid create body lands a META row with server-initialised
//     operational/computed fields and appends a kind="create" AUDIT item
//   - required-field / schema violations are rejected 422 and write NOTHING
//   - server-set fields supplied by the client are rejected 400
//   - a duplicate slug is rejected 409 (create is never an update)
//   - the W-3 aggregate budget cap counts the existing roster
//
// Pattern modelled on patch-agent-tests.ts: in-memory row map behind the
// DDB mock, real route dispatcher + real agent-config / agent-audit
// modules under test.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { W3_BUDGET_CAP_USD } from "../shared/agent-config";

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
  queryBySkPrefix: vi.fn(async () => []),
  queryByGsi: vi.fn(async () => []),
  updateOperational: vi.fn(),
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

vi.mock("../shared/project.js", () => ({
  asProjectId: (s: string) => s,
  projectPk: (id: string) => `PROJECT#${id}`,
  getProject: vi.fn(async () => undefined),
  archive: vi.fn(),
  unarchive: vi.fn(),
  listExecutions: vi.fn(async () => []),
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

function makeCreateEvent(body: unknown): APIGatewayProxyEventV2 {
  return {
    routeKey: "POST /agents",
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: {
      http: { method: "POST", path: "/agents" },
      authorizer: { iam: { userArn: OPERATOR_ARN } },
    },
  } as unknown as APIGatewayProxyEventV2;
}

async function call(event: APIGatewayProxyEventV2): Promise<{ status: number; json: any }> {
  const res = (await handler(event)) as Exclude<APIGatewayProxyResultV2, string>;
  return { status: res.statusCode ?? 0, json: res.body ? JSON.parse(res.body as string) : undefined };
}

function validBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: "tessa",
    first_name: "Tessa",
    last_name: "Whitfield",
    residence: "Washington, DC, US",
    role: "VP, Policy & Government Affairs",
    model: "anthropic:claude-sonnet-4-6",
    prompt_version: "0.1.0",
    budget_monthly_usd_default: 7,
    default_project: "workforce-self",
    streams: ["internal", "editorial"],
    bindings: [],
    system_prompt: "# Tessa Whitfield\n\nYou are Tessa.",
    reports_to: ["maya"],
    lateral: ["priya", "sora"],
    jd: { mission: "Own the policy watch.", key_responsibilities: ["x"], success_measures: ["y"] },
    ...over,
  };
}

function seedAgent(slug: string, over: Record<string, unknown> = {}): AnyRow {
  const row: AnyRow = {
    pk: `AGENT#${slug}`,
    sk: "META",
    slug,
    first_name: "Sora",
    last_name: "Petersen",
    residence: "Copenhagen, DK",
    role: "Researcher / Analyst",
    model: "anthropic:claude-sonnet-4-6",
    prompt_version: "1.0.0",
    budget_monthly_usd_default: 10,
    default_project: "editorial",
    streams: ["editorial"],
    bindings: [],
    created_at: "2026-05-01",
    paused: false,
    archived: false,
    runs_this_month: 0,
    cost_this_month_usd: 0,
    deliv_count_total: 0,
    updated_at: "2026-06-01T00:00:00.000Z",
    ...over,
  };
  rows.set(key(row.pk, "META"), row);
  return row;
}

function auditRows(slug: string): AnyRow[] {
  return Array.from(rows.values()).filter(
    (r) => r.pk === `AGENT#${slug}` && r.sk.startsWith("AUDIT#"),
  );
}

beforeEach(() => {
  rows.clear();
  rows.set(key("SKILL#feed-post", "META"), {
    pk: "SKILL#feed-post",
    sk: "META",
    name: "feed-post",
    owners: ["tessa"],
  });
});

describe("POST /agents — create (ADR-0007)", () => {
  it("creates the META row, initialises operational/computed fields, audits kind=create", async () => {
    const { status, json } = await call(makeCreateEvent(validBody()));
    expect(status).toBe(201);
    expect(json.slug).toBe("tessa");
    expect(json.budget_monthly_usd_effective).toBe(7);

    const row = rows.get(key("AGENT#tessa", "META"))!;
    expect(row.paused).toBe(false);
    expect(row.archived).toBe(false);
    expect(row.runs_this_month).toBe(0);
    expect(row.cost_this_month_usd).toBe(0);
    expect(row.deliv_count_total).toBe(0);
    expect(typeof row.created_at).toBe("string");
    expect(row.reports_to).toEqual(["maya"]);

    const audits = auditRows("tessa");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.kind).toBe("create");
    expect(audits[0]!.actor).toBe(OPERATOR_ARN);
    expect(audits[0]!.changes).toEqual(
      expect.arrayContaining([
        { field: "slug", before: null, after: "tessa" },
        { field: "role", before: null, after: "VP, Policy & Government Affairs" },
      ]),
    );
  });

  it("accepts bindings naming a skill this agent owns", async () => {
    const binding = {
      skill: "feed-post",
      executor: "claude-code-routine",
      routine_spec: "workforce/docs/routines/agent-runner.md",
      project_id: "agent-workforce",
      trigger: { scheduler: "external", invoked_by: "api", cron: "cron(15 3 ? * * *)" },
    };
    const { status } = await call(makeCreateEvent(validBody({ bindings: [binding] })));
    expect(status).toBe(201);
  });

  it("rejects a missing required field 422 and writes nothing", async () => {
    const body = validBody();
    delete body.system_prompt;
    const { status, json } = await call(makeCreateEvent(body));
    expect(status).toBe(422);
    expect(json.violations.map((v: { rule: string }) => v.rule)).toContain("S0-required");
    expect(rows.get(key("AGENT#tessa", "META"))).toBeUndefined();
    expect(auditRows("tessa")).toHaveLength(0);
  });

  it("rejects a malformed slug 422", async () => {
    const { status, json } = await call(makeCreateEvent(validBody({ slug: "Tessa-2" })));
    expect(status).toBe(422);
    expect(json.violations.map((v: { rule: string }) => v.rule)).toContain("S2-slug");
  });

  it("runs the PATCH field rules on the body (bad model rejected)", async () => {
    const { status, json } = await call(makeCreateEvent(validBody({ model: "openai:gpt-5" })));
    expect(status).toBe(422);
    expect(json.violations.map((v: { rule: string }) => v.rule)).toContain("S5-model");
  });

  it("rejects server-set fields 400 (created_at, paused, computed)", async () => {
    const { status, json } = await call(
      makeCreateEvent(validBody({ created_at: "2020-01-01", paused: true, runs_this_month: 9 })),
    );
    expect(status).toBe(400);
    expect(json.error).toBe("non_writable_fields");
  });

  it("409s on a duplicate slug without touching the existing row or audit", async () => {
    const before = seedAgent("tessa", { role: "Existing role" });
    const { status, json } = await call(makeCreateEvent(validBody()));
    expect(status).toBe(409);
    expect(json.error).toBe("already_exists");
    expect(rows.get(key("AGENT#tessa", "META"))!.role).toBe(before.role);
    expect(auditRows("tessa")).toHaveLength(0);
  });

  it("enforces the W-3 aggregate budget cap against the existing roster", async () => {
    // Fixtures anchor to W3_BUDGET_CAP_USD so they track cap raises: seed the
    // roster to (cap - 10), then (cap-10) + 11 = cap+1 trips it, + 10 = cap fits.
    seedAgent("ren", {
      slug: "ren",
      pk: "AGENT#ren",
      budget_monthly_usd_default: W3_BUDGET_CAP_USD - 10,
    });
    seedAgent("maya", {
      slug: "maya",
      pk: "AGENT#maya",
      budget_monthly_usd_default: 50,
      archived: true, // archived agents don't count against the cap
    });
    const over = await call(makeCreateEvent(validBody({ budget_monthly_usd_default: 11 })));
    expect(over.status).toBe(422);
    expect(over.json.violations.map((v: { rule: string }) => v.rule)).toContain("W3-cap");

    const ok = await call(makeCreateEvent(validBody({ budget_monthly_usd_default: 10 })));
    expect(ok.status).toBe(201);
  });
});
