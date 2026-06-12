// Unit tests for the ADR-0007 config write path in agents-api/handler.ts:
//
//   - PATCH /agents/{slug} accepts identity fields, validates them via
//     shared/agent-config.ts, and appends an AUDIT# item with the
//     field-level diff + IAM actor
//   - invalid configs are rejected 422 with the violation list and write
//     NOTHING (no row update, no audit item)
//   - operational PATCH / DELETE also audit (every config mutation does)
//   - a no-op patch (re-sending current values) writes nothing
//   - GET /agents/{slug}/audit pages the trail newest-first
//
// Pattern modelled on handler-tests.ts: in-memory row map behind the DDB
// mock, real route dispatcher + real agent-config / agent-audit modules
// under test.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

process.env.STAGE = "test";

interface AnyRow {
  pk: string;
  sk: string;
  [k: string]: unknown;
}
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
  // Merge-updating fake of updateOperational.
  updateOperational: vi.fn(
    async (pk: string, sk: string, patch: Record<string, unknown>) => {
      const row = rows.get(key(pk, sk));
      if (!row) throw new Error("no row");
      for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) row[k] = v;
      }
      row.updated_at = "2026-06-11T12:00:00.000Z";
      return { ...row };
    },
  ),
  putItem: vi.fn(async (item: AnyRow) => {
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

function makeEvent(
  method: string,
  routeKey: string,
  slug: string,
  body?: unknown,
  qs?: Record<string, string>,
): APIGatewayProxyEventV2 {
  return {
    routeKey,
    pathParameters: { slug },
    queryStringParameters: qs,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: {
      http: { method, path: (routeKey.split(" ")[1] ?? "").replace("{slug}", slug) },
      authorizer: { iam: { userArn: OPERATOR_ARN } },
    },
  } as unknown as APIGatewayProxyEventV2;
}

async function call(event: APIGatewayProxyEventV2): Promise<{ status: number; json: any }> {
  const res = (await handler(event)) as Exclude<APIGatewayProxyResultV2, string>;
  return { status: res.statusCode ?? 0, json: res.body ? JSON.parse(res.body as string) : undefined };
}

function seedAgent(slug: string, over: Record<string, unknown> = {}): AnyRow {
  const row: AnyRow = {
    pk: `AGENT#${slug}`,
    sk: "META",
    slug,
    first_name: "Sora",
    last_name: "Aoki",
    residence: "Sapporo, Japan",
    role: "Editorial writer",
    model: "anthropic:claude-sonnet-4-6",
    prompt_version: "1.0.0",
    budget_monthly_usd_default: 20,
    default_project: "agent-workforce",
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
    owners: ["sora"],
  });
});

describe("PATCH /agents/{slug} — identity writes (ADR-0007)", () => {
  it("accepts a valid identity patch and audits actor + diff", async () => {
    seedAgent("sora");
    const { status, json } = await call(
      makeEvent("PATCH", "PATCH /agents/{slug}", "sora", {
        model: "anthropic:claude-opus-4-8",
        prompt_version: "1.1.0",
      }),
    );
    expect(status).toBe(200);
    expect(json.model).toBe("anthropic:claude-opus-4-8");

    const audits = auditRows("sora");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.kind).toBe("identity");
    expect(audits[0]!.actor).toBe(OPERATOR_ARN);
    expect(audits[0]!.changes).toEqual(
      expect.arrayContaining([
        { field: "model", before: "anthropic:claude-sonnet-4-6", after: "anthropic:claude-opus-4-8" },
        { field: "prompt_version", before: "1.0.0", after: "1.1.0" },
      ]),
    );
  });

  it("accepts a system_prompt rewrite; the audit stores a digest, not the full text", async () => {
    seedAgent("sora", { system_prompt: `You are Sora. ${"a".repeat(2000)}` });
    const next = `You are Sora v2. ${"b".repeat(3000)}`;
    const { status } = await call(
      makeEvent("PATCH", "PATCH /agents/{slug}", "sora", { system_prompt: next }),
    );
    expect(status).toBe(200);
    expect(rows.get(key("AGENT#sora", "META"))!.system_prompt).toBe(next);

    const audits = auditRows("sora");
    expect(audits).toHaveLength(1);
    const change = (audits[0]!.changes as Array<{ field: string; after: { truncated?: boolean; length?: number } }>)[0]!;
    expect(change.field).toBe("system_prompt");
    expect(change.after.truncated).toBe(true);
    expect(change.after.length).toBe(next.length);
  });

  it("rejects an invalid config 422 with violations and writes nothing", async () => {
    const before = seedAgent("sora");
    const { status, json } = await call(
      makeEvent("PATCH", "PATCH /agents/{slug}", "sora", { model: "openai:gpt-5" }),
    );
    expect(status).toBe(422);
    expect(json.error).toBe("config_validation_failed");
    expect(json.violations.map((v: { rule: string }) => v.rule)).toContain("S5-model");
    expect(rows.get(key("AGENT#sora", "META"))!.model).toBe(before.model);
    expect(auditRows("sora")).toHaveLength(0);
  });

  it("rejects bindings naming a skill with no SKILL row or wrong owner", async () => {
    seedAgent("sora");
    const binding = {
      skill: "ghost-skill",
      executor: "claude-code-routine",
      routine_spec: "workforce/docs/routines/ghost.md",
      trigger: { scheduler: "manual" },
    };
    const { status, json } = await call(
      makeEvent("PATCH", "PATCH /agents/{slug}", "sora", { bindings: [binding] }),
    );
    expect(status).toBe(422);
    expect(json.violations.map((v: { rule: string }) => v.rule)).toContain(
      "R8-binding-skill-exists",
    );
  });

  it("enforces the W-3 aggregate budget cap across other live agents", async () => {
    seedAgent("sora");
    seedAgent("ren", { slug: "ren", pk: "AGENT#ren", budget_monthly_usd_default: 100 });
    seedAgent("maya", {
      slug: "maya",
      pk: "AGENT#maya",
      budget_monthly_usd_default: 50,
      archived: true, // archived agents don't count against the cap
    });
    const ok = await call(
      makeEvent("PATCH", "PATCH /agents/{slug}", "sora", { budget_monthly_usd_default: 60 }),
    );
    expect(ok.status).toBe(200);
    const over = await call(
      makeEvent("PATCH", "PATCH /agents/{slug}", "sora", { budget_monthly_usd_default: 61 }),
    );
    expect(over.status).toBe(422);
    expect(over.json.violations.map((v: { rule: string }) => v.rule)).toContain("W3-cap");
  });

  it("rejects immutable/computed fields 400", async () => {
    seedAgent("sora");
    const { status, json } = await call(
      makeEvent("PATCH", "PATCH /agents/{slug}", "sora", { slug: "other", runs_this_month: 99 }),
    );
    expect(status).toBe(400);
    expect(json.error).toBe("non_patchable_fields");
  });

  it("treats a patch re-sending current values as a no-op (no audit)", async () => {
    seedAgent("sora");
    const { status } = await call(
      makeEvent("PATCH", "PATCH /agents/{slug}", "sora", { model: "anthropic:claude-sonnet-4-6" }),
    );
    expect(status).toBe(200);
    expect(auditRows("sora")).toHaveLength(0);
  });
});

describe("PATCH /agents/{slug} — operational writes still audit", () => {
  it("audits paused flips as kind=operational", async () => {
    seedAgent("sora");
    const { status } = await call(
      makeEvent("PATCH", "PATCH /agents/{slug}", "sora", { paused: true }),
    );
    expect(status).toBe(200);
    const audits = auditRows("sora");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.kind).toBe("operational");
    expect(audits[0]!.changes).toEqual([{ field: "paused", before: false, after: true }]);
  });

  it("type-checks operational fields (W-4: garbage rejected at the boundary)", async () => {
    seedAgent("sora");
    const { status, json } = await call(
      makeEvent("PATCH", "PATCH /agents/{slug}", "sora", { paused: "banana" }),
    );
    expect(status).toBe(422);
    expect(json.violations.map((v: { rule: string }) => v.rule)).toContain("S12-paused");
  });

  it("guards the budget override against the W-3 cap", async () => {
    seedAgent("sora");
    seedAgent("ren", { slug: "ren", pk: "AGENT#ren", budget_monthly_usd_default: 150 });
    const { status, json } = await call(
      makeEvent("PATCH", "PATCH /agents/{slug}", "sora", { budget_monthly_usd_override: 20 }),
    );
    expect(status).toBe(422);
    expect(json.violations.map((v: { rule: string }) => v.rule)).toContain("W3-cap");
  });

  it("DELETE audits the archive flip", async () => {
    seedAgent("sora");
    const { status } = await call(makeEvent("DELETE", "DELETE /agents/{slug}", "sora"));
    expect(status).toBe(200);
    const audits = auditRows("sora");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.changes).toEqual([{ field: "archived", before: false, after: true }]);
  });
});

describe("GET /agents/{slug}/audit", () => {
  it("404s on unknown agent, returns newest-first items otherwise", async () => {
    const missing = await call(makeEvent("GET", "GET /agents/{slug}/audit", "ghost"));
    expect(missing.status).toBe(404);

    seedAgent("sora");
    // Pin time so the two AUDIT sort keys differ deterministically (the
    // sk is AUDIT#{iso-ts}#{nonce}; same-ms writes would order by nonce).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-11T12:00:00.000Z"));
    await call(makeEvent("PATCH", "PATCH /agents/{slug}", "sora", { paused: true }));
    vi.setSystemTime(new Date("2026-06-11T12:00:01.000Z"));
    await call(makeEvent("PATCH", "PATCH /agents/{slug}", "sora", { paused: false }));
    vi.useRealTimers();

    const { status, json } = await call(makeEvent("GET", "GET /agents/{slug}/audit", "sora"));
    expect(status).toBe(200);
    expect(json.items).toHaveLength(2);
    expect(json.items[0].at >= json.items[1].at).toBe(true);
    expect(json.items[0].changes[0]).toEqual({ field: "paused", before: true, after: false });
  });
});
