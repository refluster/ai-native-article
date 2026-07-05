// Unit tests for workforce/lambdas/credentials-api/handler.ts.
//
// Covers the Epic-010 Story 2-C (#91) acceptance criteria:
//   - GET returns metadata only — body never contains the secret value
//     (the canonical secret-leak guard)
//   - PUT writes to wf/projects/{slug}/{type}; CreateSecret first, then
//     PutSecretValue on rotation (idempotent shape — rotation overwrites
//     value AND bumps last_changed_at)
//   - DELETE calls DeleteSecret(ForceDeleteWithoutRecovery=false) and
//     returns the recovery_window_days + deletion_date timestamp
//   - 404 when the project doesn't exist
//   - 400 when the credential type is not in the allowlist (including
//     malformed `type@variant` variants)
//   - Every successful PUT / DELETE appends an EXEC row attributed to
//     `_operator` with skill_name = credentials-write / credentials-delete
//   - Operator membership is still recorded on first PUT per project (the
//     appendExecution membership write-gate was removed 2026-06-08, so this
//     is now an informational membership row, not a gate bypass)
//
// Secrets Manager and the appendExecution / project helpers are mocked
// at the module boundary; project + membership state lives in an
// in-memory map so the tests exercise the real wiring of validation +
// audit ordering, not the DDB schema.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";

// ─── Secrets Manager fakes ─────────────────────────────────────────────

const secrets = new Map<
  string,
  { value: string; createdDate: Date; lastChangedDate: Date; lastRotatedDate?: Date }
>();

// Per-test injection point for one-off failures (e.g. AccessDenied).
const sendFailureQueue: Array<{ kind: string; id: string; err: Error }> = [];

class FakeResourceNotFoundException extends Error {
  override name = "ResourceNotFoundException";
  constructor() {
    super("Secrets Manager: not found");
  }
}
class FakeResourceExistsException extends Error {
  override name = "ResourceExistsException";
  constructor() {
    super("Secrets Manager: already exists");
  }
}

function arnOf(name: string): string {
  return `arn:aws:secretsmanager:us-east-1:000000000000:secret:${name}-AbCdEf`;
}

vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: class {
    async send(cmd: { _kind: string; input: Record<string, unknown> }) {
      const id =
        (cmd.input.SecretId as string | undefined) ??
        (cmd.input.Name as string | undefined) ??
        "";
      const fail = sendFailureQueue.find((f) => f.kind === cmd._kind && f.id === id);
      if (fail) {
        sendFailureQueue.splice(sendFailureQueue.indexOf(fail), 1);
        throw fail.err;
      }
      if (cmd._kind === "create") {
        const name = cmd.input.Name as string;
        if (secrets.has(name)) throw new FakeResourceExistsException();
        const now = new Date();
        secrets.set(name, {
          value: cmd.input.SecretString as string,
          createdDate: now,
          lastChangedDate: now,
        });
        return { ARN: arnOf(name), Name: name };
      }
      if (cmd._kind === "put") {
        const sid = cmd.input.SecretId as string;
        const existing = secrets.get(sid);
        if (!existing) throw new FakeResourceNotFoundException();
        existing.value = cmd.input.SecretString as string;
        existing.lastChangedDate = new Date();
        return { ARN: arnOf(sid), Name: sid };
      }
      if (cmd._kind === "describe") {
        const sid = cmd.input.SecretId as string;
        const existing = secrets.get(sid);
        if (!existing) throw new FakeResourceNotFoundException();
        return {
          ARN: arnOf(sid),
          Name: sid,
          CreatedDate: existing.createdDate,
          LastChangedDate: existing.lastChangedDate,
          LastRotatedDate: existing.lastRotatedDate,
        };
      }
      if (cmd._kind === "delete") {
        const sid = cmd.input.SecretId as string;
        if (!secrets.has(sid)) throw new FakeResourceNotFoundException();
        const window = (cmd.input.RecoveryWindowInDays as number) ?? 30;
        const deletionDate = new Date(Date.now() + window * 24 * 60 * 60 * 1000);
        secrets.delete(sid);
        return { ARN: arnOf(sid), Name: sid, DeletionDate: deletionDate };
      }
      throw new Error(`unexpected command kind ${cmd._kind}`);
    }
  },
  CreateSecretCommand: class {
    _kind = "create";
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
  PutSecretValueCommand: class {
    _kind = "put";
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
  DescribeSecretCommand: class {
    _kind = "describe";
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
  DeleteSecretCommand: class {
    _kind = "delete";
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
  ResourceExistsException: FakeResourceExistsException,
  ResourceNotFoundException: FakeResourceNotFoundException,
}));

// ─── Project + audit fakes ─────────────────────────────────────────────

interface FakeProject {
  project_id: string;
}
interface FakeExecRow {
  project_id: string;
  agent_slug: string;
  skill_name: string;
  used_credential_types: string[];
  exec_ulid: string;
  status: string;
}

const projects = new Map<string, FakeProject>();
const execRows: FakeExecRow[] = [];

vi.mock("../shared/project.js", () => ({
  asProjectId: (s: string) => {
    if (!s) throw new Error("invalid project_id: empty string");
    if (s.includes("#") || s.includes("|")) {
      throw new Error(`invalid project_id "${s}": must not contain '#' or '|'`);
    }
    return s as string;
  },
  getProject: async (id: string) => projects.get(id),
  appendExecution: async (input: {
    project_id: string;
    agent_slug: string;
    skill_name: string;
    used_credential_types?: string[];
    exec_ulid: string;
    status: string;
  }) => {
    // Membership write-gate removed 2026-06-08 (C-3): appendExecution writes
    // unconditionally now, so this mock no longer throws cross-project denial.
    execRows.push({
      project_id: input.project_id,
      agent_slug: input.agent_slug,
      skill_name: input.skill_name,
      used_credential_types: input.used_credential_types ?? [],
      exec_ulid: input.exec_ulid,
      status: input.status,
    });
    return { sk: `EXEC#${input.exec_ulid}` };
  },
}));

vi.mock("../shared/task.js", () => {
  let counter = 0;
  return {
    newUlid: () => `01TESTULID${(++counter).toString().padStart(4, "0")}`,
  };
});

// The SUT must be imported AFTER all vi.mock() calls.
const { handler } = await import("./handler.js");

// ─── Event factory ────────────────────────────────────────────────────

function event(
  routeKey: string,
  pathParameters: Record<string, string>,
  body?: unknown,
): APIGatewayProxyEventV2 {
  return {
    routeKey,
    pathParameters,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: {
      http: { method: routeKey.split(" ")[0]!, path: "/test" },
    },
  } as unknown as APIGatewayProxyEventV2;
}

function bodyOf<T>(res: APIGatewayProxyResultV2): T {
  // The handler always returns the structured object — never `string`
  // (the type union exists because the lambda runtime accepts both).
  const r = res as { body?: string };
  return JSON.parse(r.body ?? "{}") as T;
}

beforeEach(() => {
  secrets.clear();
  projects.clear();
  execRows.length = 0;
  sendFailureQueue.length = 0;
  projects.set("editorial", { project_id: "editorial" });
  projects.set("workforce-meta", {
    project_id: "workforce-meta",
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Routing + input validation ───────────────────────────────────────

describe("routing + path validation", () => {
  it("404s an unknown route", async () => {
    const res = await handler(
      event("PATCH /projects/{slug}/credentials/{type}", {
        slug: "editorial",
        type: "github.token",
      }),
    );
    expect(res).toMatchObject({ statusCode: 404 });
    expect(bodyOf<{ error: string }>(res).error).toBe("route_not_found");
  });

  it("400s when slug or type is missing", async () => {
    const res = await handler(
      event("GET /projects/{slug}/credentials/{type}", { slug: "editorial" }),
    );
    expect(res).toMatchObject({ statusCode: 400 });
    expect(bodyOf<{ error: string }>(res).error).toBe("missing_path_param");
  });

  it("400s when the credential_type is not in the allowlist", async () => {
    const res = await handler(
      event("GET /projects/{slug}/credentials/{type}", {
        slug: "editorial",
        type: "openai.api_key",
      }),
    );
    expect(res).toMatchObject({ statusCode: 400 });
    const body = bodyOf<{ error: string; allowed: string[] }>(res);
    expect(body.error).toBe("unknown_credential_type");
    expect(body.allowed).toContain("github.token");
  });

  it("400s when slug contains a DDB delimiter (asProjectId throws)", async () => {
    const res = await handler(
      event("GET /projects/{slug}/credentials/{type}", {
        slug: "bad#slug",
        type: "github.token",
      }),
    );
    expect(res).toMatchObject({ statusCode: 400 });
    expect(bodyOf<{ error: string }>(res).error).toBe("invalid_project_slug");
  });

  it("accepts a `type@variant` key when the base type + variant are valid", async () => {
    await handler(
      event(
        "PUT /projects/{slug}/credentials/{type}",
        { slug: "editorial", type: "notion.integration_token@editorial" },
        { value: { apiKey: "k", databaseId: "d" } },
      ),
    );
    expect(secrets.has("wf/projects/editorial/notion.integration_token@editorial")).toBe(
      true,
    );
  });

  it("400s an empty variant (`type@`)", async () => {
    const res = await handler(
      event("GET /projects/{slug}/credentials/{type}", {
        slug: "editorial",
        type: "github.token@",
      }),
    );
    expect(res).toMatchObject({ statusCode: 400 });
    expect(bodyOf<{ error: string }>(res).error).toBe("invalid_variant");
  });

  it("400s a variant that doesn't match the kebab/snake pattern", async () => {
    const res = await handler(
      event("GET /projects/{slug}/credentials/{type}", {
        slug: "editorial",
        type: "github.token@HasCaps",
      }),
    );
    expect(res).toMatchObject({ statusCode: 400 });
    expect(bodyOf<{ error: string }>(res).error).toBe("invalid_variant");
  });
});

// ─── GET — metadata only, no secret leak ──────────────────────────────

describe("GET /projects/{slug}/credentials/{type}", () => {
  it("404s when the project does not exist", async () => {
    const res = await handler(
      event("GET /projects/{slug}/credentials/{type}", {
        slug: "ghost",
        type: "github.token",
      }),
    );
    expect(res).toMatchObject({ statusCode: 404 });
    expect(bodyOf<{ error: string }>(res).error).toBe("project_not_found");
  });

  it("404s when the credential has not been provisioned", async () => {
    const res = await handler(
      event("GET /projects/{slug}/credentials/{type}", {
        slug: "editorial",
        type: "github.token",
      }),
    );
    expect(res).toMatchObject({ statusCode: 404 });
    expect(bodyOf<{ error: string }>(res).error).toBe("credential_not_found");
  });

  it("returns metadata only — body MUST NEVER contain the secret value (AC: secret-leak guard)", async () => {
    const SECRET = "super-secret-token-abc123-DO-NOT-LEAK";
    // Seed via PUT so the secret value flows through the real handler
    // path (not just the test-harness map).
    await handler(
      event(
        "PUT /projects/{slug}/credentials/{type}",
        { slug: "editorial", type: "github.token" },
        { value: { token: SECRET } },
      ),
    );
    expect(secrets.get("wf/projects/editorial/github.token")?.value).toContain(SECRET);

    const res = await handler(
      event("GET /projects/{slug}/credentials/{type}", {
        slug: "editorial",
        type: "github.token",
      }),
    );
    expect(res).toMatchObject({ statusCode: 200 });

    // The canonical secret-leak guard: full-text scan of the response
    // body. Any future field that "helpfully" surfaces the SecretString
    // (e.g. echoing it back in an error message) gets caught here.
    const raw = (res as { body?: string }).body ?? "";
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain("super-secret");

    const body = bodyOf<{
      project_id: string;
      credential_type: string;
      name: string;
      secret_arn: string;
      last_changed_at: string;
      created_date: string;
    }>(res);
    expect(body.project_id).toBe("editorial");
    expect(body.credential_type).toBe("github.token");
    expect(body.name).toBe("wf/projects/editorial/github.token");
    expect(body.secret_arn).toMatch(/^arn:aws:secretsmanager:/);
    expect(body.last_changed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.created_date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Defence-in-depth: there must be no `value` / `SecretString` /
    // `token` / `apiKey` field on the response body.
    expect(body).not.toHaveProperty("value");
    expect(body).not.toHaveProperty("SecretString");
    expect(body).not.toHaveProperty("token");
    expect(body).not.toHaveProperty("apiKey");
  });

  it("does NOT write an EXEC row (reads are not audited via the ledger)", async () => {
    secrets.set("wf/projects/editorial/github.token", {
      value: JSON.stringify({ token: "x" }),
      createdDate: new Date(),
      lastChangedDate: new Date(),
    });
    await handler(
      event("GET /projects/{slug}/credentials/{type}", {
        slug: "editorial",
        type: "github.token",
      }),
    );
    expect(execRows).toHaveLength(0);
  });
});

// ─── PUT — create then rotate, idempotent, audited ────────────────────

describe("PUT /projects/{slug}/credentials/{type}", () => {
  it("400s when the body is missing or malformed", async () => {
    const r1 = await handler(
      event("PUT /projects/{slug}/credentials/{type}", {
        slug: "editorial",
        type: "github.token",
      }),
    );
    expect(r1).toMatchObject({ statusCode: 400 });
    expect(bodyOf<{ error: string }>(r1).error).toBe("missing_body");

    const r2 = await handler({
      routeKey: "PUT /projects/{slug}/credentials/{type}",
      pathParameters: { slug: "editorial", type: "github.token" },
      body: "not-json",
      requestContext: { http: { method: "PUT", path: "/test" } },
    } as unknown as APIGatewayProxyEventV2);
    expect(r2).toMatchObject({ statusCode: 400 });
    expect(bodyOf<{ error: string }>(r2).error).toBe("invalid_json");

    const r3 = await handler(
      event(
        "PUT /projects/{slug}/credentials/{type}",
        { slug: "editorial", type: "github.token" },
        { not_value: "x" },
      ),
    );
    expect(r3).toMatchObject({ statusCode: 400 });
    expect(bodyOf<{ error: string }>(r3).error).toBe("missing_value");
  });

  it("404s when the project doesn't exist (no secret write happens)", async () => {
    const res = await handler(
      event(
        "PUT /projects/{slug}/credentials/{type}",
        { slug: "ghost", type: "github.token" },
        { value: { token: "x" } },
      ),
    );
    expect(res).toMatchObject({ statusCode: 404 });
    expect(secrets.size).toBe(0);
    expect(execRows).toHaveLength(0);
  });

  it("first write uses CreateSecret and reports outcome=created", async () => {
    const res = await handler(
      event(
        "PUT /projects/{slug}/credentials/{type}",
        { slug: "editorial", type: "github.token" },
        { value: { token: "v1" } },
      ),
    );
    expect(res).toMatchObject({ statusCode: 200 });
    const body = bodyOf<{ outcome: string; name: string; last_changed_at: string }>(res);
    expect(body.outcome).toBe("created");
    expect(body.name).toBe("wf/projects/editorial/github.token");
    expect(secrets.get("wf/projects/editorial/github.token")?.value).toBe(
      JSON.stringify({ token: "v1" }),
    );
  });

  it("second write rotates via PutSecretValue and reports outcome=rotated; value overwritten + last_changed_at bumps", async () => {
    await handler(
      event(
        "PUT /projects/{slug}/credentials/{type}",
        { slug: "editorial", type: "github.token" },
        { value: { token: "v1" } },
      ),
    );
    const before = secrets.get("wf/projects/editorial/github.token")!.lastChangedDate;

    // Sleep so the rotated timestamp is strictly greater.
    await new Promise((r) => setTimeout(r, 5));

    const res = await handler(
      event(
        "PUT /projects/{slug}/credentials/{type}",
        { slug: "editorial", type: "github.token" },
        { value: { token: "v2" } },
      ),
    );
    expect(res).toMatchObject({ statusCode: 200 });
    expect(bodyOf<{ outcome: string }>(res).outcome).toBe("rotated");
    const after = secrets.get("wf/projects/editorial/github.token")!;
    expect(after.value).toBe(JSON.stringify({ token: "v2" }));
    expect(after.lastChangedDate.getTime()).toBeGreaterThan(before.getTime());
  });

  it("accepts a string value (not just an object)", async () => {
    await handler(
      event(
        "PUT /projects/{slug}/credentials/{type}",
        { slug: "editorial", type: "github.token" },
        { value: "raw-string-token" },
      ),
    );
    expect(secrets.get("wf/projects/editorial/github.token")?.value).toBe("raw-string-token");
  });

  it("writes no membership state on PUT (membership removed 2026-07-03) — only the EXEC audit row", async () => {
    await handler(
      event(
        "PUT /projects/{slug}/credentials/{type}",
        { slug: "editorial", type: "github.token" },
        { value: "v1" },
      ),
    );
    // The mock's project.js surface no longer even exposes addMember/isMember;
    // the only DDB side effect besides the secret is the EXEC audit row.
    expect(execRows).toHaveLength(1);
    expect(execRows[0]!.agent_slug).toBe("_operator");
  });

  it("appends an EXEC row attributed to `_operator` with skill_name=credentials-write", async () => {
    await handler(
      event(
        "PUT /projects/{slug}/credentials/{type}",
        { slug: "editorial", type: "github.token" },
        { value: "v1" },
      ),
    );
    expect(execRows).toHaveLength(1);
    expect(execRows[0]).toMatchObject({
      project_id: "editorial",
      agent_slug: "_operator",
      skill_name: "credentials-write",
      status: "ok",
    });
    expect(execRows[0]!.used_credential_types).toEqual(["github.token"]);
  });

  it("variant key (`type@variant`) writes to the canonical wf/projects/{id}/{type@variant} path", async () => {
    await handler(
      event(
        "PUT /projects/{slug}/credentials/{type}",
        { slug: "editorial", type: "notion.integration_token@editorial" },
        { value: { apiKey: "k", databaseId: "d" } },
      ),
    );
    expect(
      secrets.has("wf/projects/editorial/notion.integration_token@editorial"),
    ).toBe(true);
  });
});

// ─── DELETE — soft delete with recovery window ────────────────────────

describe("DELETE /projects/{slug}/credentials/{type}", () => {
  it("404s when the project does not exist", async () => {
    const res = await handler(
      event("DELETE /projects/{slug}/credentials/{type}", {
        slug: "ghost",
        type: "github.token",
      }),
    );
    expect(res).toMatchObject({ statusCode: 404 });
  });

  it("404s when the credential has never been provisioned", async () => {
    const res = await handler(
      event("DELETE /projects/{slug}/credentials/{type}", {
        slug: "editorial",
        type: "github.token",
      }),
    );
    expect(res).toMatchObject({ statusCode: 404 });
    expect(bodyOf<{ error: string }>(res).error).toBe("credential_not_found");
  });

  it("returns recovery_window_days + deletion_date and removes the secret", async () => {
    // Seed
    await handler(
      event(
        "PUT /projects/{slug}/credentials/{type}",
        { slug: "editorial", type: "github.token" },
        { value: "v1" },
      ),
    );
    expect(secrets.has("wf/projects/editorial/github.token")).toBe(true);

    const res = await handler(
      event("DELETE /projects/{slug}/credentials/{type}", {
        slug: "editorial",
        type: "github.token",
      }),
    );
    expect(res).toMatchObject({ statusCode: 200 });
    const body = bodyOf<{
      project_id: string;
      credential_type: string;
      deletion_date: string;
      recovery_window_days: number;
    }>(res);
    expect(body.project_id).toBe("editorial");
    expect(body.credential_type).toBe("github.token");
    expect(body.recovery_window_days).toBe(7);
    // deletion_date should be ~7 days from now (ISO-8601).
    const ms = new Date(body.deletion_date).getTime() - Date.now();
    expect(ms).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(ms).toBeLessThan(8 * 24 * 60 * 60 * 1000);
    expect(secrets.has("wf/projects/editorial/github.token")).toBe(false);
  });

  it("appends an EXEC row attributed to `_operator` with skill_name=credentials-delete", async () => {
    await handler(
      event(
        "PUT /projects/{slug}/credentials/{type}",
        { slug: "editorial", type: "github.token" },
        { value: "v1" },
      ),
    );
    execRows.length = 0;

    await handler(
      event("DELETE /projects/{slug}/credentials/{type}", {
        slug: "editorial",
        type: "github.token",
      }),
    );
    expect(execRows).toHaveLength(1);
    expect(execRows[0]).toMatchObject({
      project_id: "editorial",
      agent_slug: "_operator",
      skill_name: "credentials-delete",
      status: "ok",
    });
  });
});

// ─── W-4 fail-loud ────────────────────────────────────────────────────

describe("fail-loud (W-4)", () => {
  it("surfaces non-NotFound DescribeSecret errors as 500", async () => {
    secrets.set("wf/projects/editorial/github.token", {
      value: "x",
      createdDate: new Date(),
      lastChangedDate: new Date(),
    });
    sendFailureQueue.push({
      kind: "describe",
      id: "wf/projects/editorial/github.token",
      err: Object.assign(new Error("AccessDeniedException"), {
        name: "AccessDeniedException",
      }),
    });
    const res = await handler(
      event("GET /projects/{slug}/credentials/{type}", {
        slug: "editorial",
        type: "github.token",
      }),
    );
    expect(res).toMatchObject({ statusCode: 500 });
    expect(bodyOf<{ message: string }>(res).message).toMatch(/AccessDenied/);
  });

  it("surfaces non-Exists CreateSecret errors as 500 (no audit row written)", async () => {
    sendFailureQueue.push({
      kind: "create",
      id: "wf/projects/editorial/github.token",
      err: Object.assign(new Error("InternalServiceError"), {
        name: "InternalServiceError",
      }),
    });
    const res = await handler(
      event(
        "PUT /projects/{slug}/credentials/{type}",
        { slug: "editorial", type: "github.token" },
        { value: "v1" },
      ),
    );
    expect(res).toMatchObject({ statusCode: 500 });
    expect(execRows).toHaveLength(0);
  });
});
