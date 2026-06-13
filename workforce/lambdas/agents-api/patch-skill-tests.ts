// Unit tests for the ADR-0008 skill config write path in agents-api:
//
//   - PATCH /skills/{name} accepts judgment-side fields, validates them via
//     shared/skill-config.ts, and appends a SKILL#{name}/AUDIT# item
//   - code-side / immutable fields are rejected 400 (they stay git-owned)
//   - invalid configs are rejected 422 and write NOTHING
//   - owners cross-check runs against live AGENT rows
//   - a no-op patch (re-sending current values) writes nothing
//   - GET /skills/{name}/audit pages the trail newest-first
//
// Pattern modelled on patch-agent-tests.ts: in-memory row map behind the
// DDB mock, real route dispatcher + real skill-config / skill-audit
// modules under test.

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
  queryBySkPrefix: vi.fn(async () => []),
  queryByGsi: vi.fn(async () => []),
  updateOperational: vi.fn(
    async (pk: string, sk: string, patch: Record<string, unknown>) => {
      const row = rows.get(key(pk, sk));
      if (!row) throw new Error("no row");
      for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) row[k] = v;
      }
      row.updated_at = "2026-06-12T22:00:00.000Z";
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
  name: string,
  body?: unknown,
): APIGatewayProxyEventV2 {
  return {
    routeKey,
    pathParameters: { name },
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: {
      http: { method, path: (routeKey.split(" ")[1] ?? "").replace("{name}", name) },
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
    deliverable: { type: "notification", publish_notion: false },
    cost_class: "small",
    owners: ["grace"],
    improvement_agent: null,
    created_at: "2026-06-12",
    description: "Daily research digest.",
    body: "# grid-watch\n\nDo the one thing.",
    invocations_this_month: 0,
    identity_hash: "abc",
    updated_at: "2026-06-12T00:00:00.000Z",
    ...over,
  };
  rows.set(key(row.pk, "META"), row);
  return row;
}

function seedAgent(slug: string): void {
  rows.set(key(`AGENT#${slug}`, "META"), {
    pk: `AGENT#${slug}`,
    sk: "META",
    slug,
    archived: false,
    bindings: [],
  });
}

function auditRows(name: string): AnyRow[] {
  return Array.from(rows.values()).filter(
    (r) => r.pk === `SKILL#${name}` && r.sk.startsWith("AUDIT#"),
  );
}

beforeEach(() => {
  rows.clear();
  seedAgent("grace");
  seedAgent("sana");
});

describe("PATCH /skills/{name} — judgment-config writes (ADR-0008)", () => {
  it("accepts a body + status patch and audits actor + diff", async () => {
    seedSkill("grid-watch");
    const { status, json } = await call(
      makeEvent("PATCH", "PATCH /skills/{name}", "grid-watch", {
        body: "# grid-watch v2\n\nSharper skip rule.",
        version: "0.2.0",
      }),
    );
    expect(status).toBe(200);
    expect(json.version).toBe("0.2.0");
    expect(rows.get(key("SKILL#grid-watch", "META"))!.body).toContain("Sharper skip rule");

    const audits = auditRows("grid-watch");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.kind).toBe("config");
    expect(audits[0]!.actor).toBe(OPERATOR_ARN);
    expect(audits[0]!.changes).toEqual(
      expect.arrayContaining([
        { field: "version", before: "0.1.0", after: "0.2.0" },
      ]),
    );
  });

  it("digests a long body in the audit instead of storing it verbatim", async () => {
    seedSkill("grid-watch");
    const next = `# grid-watch\n\n${"x".repeat(3000)}`;
    const { status } = await call(
      makeEvent("PATCH", "PATCH /skills/{name}", "grid-watch", { body: next }),
    );
    expect(status).toBe(200);
    const change = (auditRows("grid-watch")[0]!.changes as Array<{ field: string; after: { truncated?: boolean; length?: number } }>)[0]!;
    expect(change.field).toBe("body");
    expect(change.after.truncated).toBe(true);
    expect(change.after.length).toBe(next.length);
  });

  it("amends owners when the agents exist; rejects a ghost owner", async () => {
    seedSkill("grid-watch");
    const ok = await call(
      makeEvent("PATCH", "PATCH /skills/{name}", "grid-watch", { owners: ["grace", "sana"] }),
    );
    expect(ok.status).toBe(200);
    expect(ok.json.owners).toEqual(["grace", "sana"]);

    const ghost = await call(
      makeEvent("PATCH", "PATCH /skills/{name}", "grid-watch", { owners: ["grace", "ghostagent"] }),
    );
    expect(ghost.status).toBe(422);
    expect(ghost.json.violations.map((v: { rule: string }) => v.rule)).toContain("J7-owner-exists");
  });

  it("rejects an archived owner / improvement agent (M4)", async () => {
    seedSkill("grid-watch");
    rows.set(key("AGENT#oldtimer", "META"), {
      pk: "AGENT#oldtimer", sk: "META", slug: "oldtimer", archived: true,
    });
    const owner = await call(
      makeEvent("PATCH", "PATCH /skills/{name}", "grid-watch", { owners: ["grace", "oldtimer"] }),
    );
    expect(owner.status).toBe(422);
    expect(owner.json.violations.map((v: { rule: string }) => v.rule)).toContain("J7-owner-archived");
    const imp = await call(
      makeEvent("PATCH", "PATCH /skills/{name}", "grid-watch", { improvement_agent: "oldtimer" }),
    );
    expect(imp.status).toBe(422);
    expect(imp.json.violations.map((v: { rule: string }) => v.rule)).toContain("J8-improvement-agent-archived");
  });

  it("blocks an owners-shrink that would orphan an existing binding (R8-reverse, M2)", async () => {
    seedSkill("grid-watch", { owners: ["grace", "sana"] });
    rows.get(key("AGENT#grace", "META"))!.bindings = [
      { skill: "grid-watch", executor: "claude-code-routine", trigger: { scheduler: "manual" } },
    ];
    const shrink = await call(
      makeEvent("PATCH", "PATCH /skills/{name}", "grid-watch", { owners: ["sana"] }),
    );
    expect(shrink.status).toBe(422);
    expect(shrink.json.violations.map((v: { rule: string }) => v.rule)).toContain("R8-reverse");
    expect(rows.get(key("SKILL#grid-watch", "META"))!.owners).toEqual(["grace", "sana"]);

    // Unbound owner removal passes.
    rows.get(key("AGENT#grace", "META"))!.bindings = [];
    const ok = await call(
      makeEvent("PATCH", "PATCH /skills/{name}", "grid-watch", { owners: ["sana"] }),
    );
    expect(ok.status).toBe(200);
  });

  it("rejects git-owned / immutable fields 400", async () => {
    seedSkill("grid-watch");
    const { status, json } = await call(
      makeEvent("PATCH", "PATCH /skills/{name}", "grid-watch", {
        requires: ["github.token"],
        archetype: "cadence",
        name: "other",
      }),
    );
    expect(status).toBe(400);
    expect(json.error).toBe("non_patchable_fields");
    expect(auditRows("grid-watch")).toHaveLength(0);
  });

  it("rejects invalid shapes 422 and writes nothing", async () => {
    const before = seedSkill("grid-watch");
    const { status, json } = await call(
      makeEvent("PATCH", "PATCH /skills/{name}", "grid-watch", {
        version: "two",
        status: "retired",
        cost_class: "huge",
      }),
    );
    expect(status).toBe(422);
    const rulesHit = json.violations.map((v: { rule: string }) => v.rule);
    expect(rulesHit).toEqual(expect.arrayContaining(["J3-version", "J4-status", "J6-cost-class"]));
    expect(rows.get(key("SKILL#grid-watch", "META"))!.version).toBe(before.version);
    expect(auditRows("grid-watch")).toHaveLength(0);
  });

  it("enforces the body blast-radius ceiling", async () => {
    seedSkill("grid-watch");
    const { status, json } = await call(
      makeEvent("PATCH", "PATCH /skills/{name}", "grid-watch", { body: "y".repeat(64 * 1024 + 1) }),
    );
    expect(status).toBe(422);
    expect(json.violations.map((v: { rule: string }) => v.rule)).toContain("G4-body-size");
  });

  it("treats a patch re-sending current values as a no-op (no audit)", async () => {
    seedSkill("grid-watch");
    const { status } = await call(
      makeEvent("PATCH", "PATCH /skills/{name}", "grid-watch", { version: "0.1.0" }),
    );
    expect(status).toBe(200);
    expect(auditRows("grid-watch")).toHaveLength(0);
  });

  it("404s on an unknown skill", async () => {
    const { status } = await call(
      makeEvent("PATCH", "PATCH /skills/{name}", "ghost-skill", { version: "1.0.0" }),
    );
    expect(status).toBe(404);
  });
});

describe("GET /skills/{name}/audit", () => {
  it("404s on unknown skill, returns newest-first items otherwise", async () => {
    const missing = await call(makeEvent("GET", "GET /skills/{name}/audit", "ghost-skill"));
    expect(missing.status).toBe(404);

    seedSkill("grid-watch");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T22:00:00.000Z"));
    await call(makeEvent("PATCH", "PATCH /skills/{name}", "grid-watch", { status: "stale" }));
    vi.setSystemTime(new Date("2026-06-12T22:00:01.000Z"));
    await call(makeEvent("PATCH", "PATCH /skills/{name}", "grid-watch", { status: "active" }));
    vi.useRealTimers();

    const { status, json } = await call(makeEvent("GET", "GET /skills/{name}/audit", "grid-watch"));
    expect(status).toBe(200);
    expect(json.items).toHaveLength(2);
    expect(json.items[0].at >= json.items[1].at).toBe(true);
    expect(json.items[0].changes[0]).toEqual({ field: "status", before: "stale", after: "active" });
  });
});

describe("GET /docs/* — live API reference", () => {
  it("serves the OpenAPI YAML with the right content type", async () => {
    const res = (await handler({
      routeKey: "GET /docs/openapi",
      requestContext: { http: { method: "GET", path: "/docs/openapi" } },
    } as any)) as { statusCode?: number; headers?: Record<string, string>; body?: string };
    expect(res.statusCode).toBe(200);
    expect(res.headers?.["content-type"]).toContain("application/yaml");
    expect(res.body).toContain("openapi: 3.0");
    expect(res.body).toContain("/skills/{name}");
    expect(res.body).toContain("/agents/{slug}");
  });

  it("serves the Redoc shell pointing at the sibling spec route", async () => {
    const res = (await handler({
      routeKey: "GET /docs/api",
      requestContext: { http: { method: "GET", path: "/docs/api" } },
    } as any)) as { statusCode?: number; headers?: Record<string, string>; body?: string };
    expect(res.statusCode).toBe(200);
    expect(res.headers?.["content-type"]).toContain("text/html");
    expect(res.body).toContain('spec-url="./openapi"');
  });
});
