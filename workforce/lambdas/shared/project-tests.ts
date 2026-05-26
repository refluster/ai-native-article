// Unit tests for workforce/lambdas/shared/project.ts.
//
// Covers the Story 1 (#90) acceptance criteria that are testable at the
// helper layer, plus the cycle-1 review findings from Dario + Ren:
//   - cross-project denial via membership gate
//   - selfProjectId returns the canonical shape
//   - GSI1 / GSI2 cross-project recall
//   - removeMember is SOFT delete (revoked_at, audit row remains)
//   - getCredential narrows catch to ResourceNotFoundException
//   - listExecutions filter type discrimination
//   - addMember idempotency + project-existence gate
//   - members() on empty project + half-bounded range queries
//   - archive does NOT close the ledger (assertion of chosen semantics)
//
// The dual-write integration test + backfill-Lambda idempotency test
// belong in Story 1-B (the wire-up PR).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Type-only import — does not trigger module evaluation, so it sits
// outside the `vi.mock` -> `await import` ordering below.
import type { ProjectId } from "./project.js";

vi.mock("./secrets.js", () => ({
  getSecret: vi.fn(),
}));

type AnyRow = Record<string, unknown>;
const store = new Map<string, AnyRow>();

function key(pk: string, sk: string): string {
  return `${pk}|${sk}`;
}

vi.mock("./ddb.js", () => ({
  getItem: vi.fn(async (pk: string, sk: string) => store.get(key(pk, sk))),
  putItem: vi.fn(async (item: AnyRow) => {
    store.set(key(item.pk as string, item.sk as string), { ...item });
  }),
  conditionalPutItem: vi.fn(async (item: AnyRow, _cond: string) => {
    // Simulate `attribute_not_exists(pk)` — the only condition project.ts
    // currently uses. If the row exists, throw CCF the way the real
    // helper would so callers (seed-agents) can catch + ignore.
    const existing = store.get(key(item.pk as string, item.sk as string));
    if (existing) {
      const err = new Error("conditional check failed");
      err.name = "ConditionalCheckFailedException";
      throw err;
    }
    store.set(key(item.pk as string, item.sk as string), { ...item });
  }),
  deleteItem: vi.fn(async (pk: string, sk: string) => {
    store.delete(key(pk, sk));
  }),
  queryBySkPrefix: vi.fn(async (pk: string, skPrefix: string, _limit?: number) => {
    return Array.from(store.values()).filter(
      (r) => r.pk === pk && typeof r.sk === "string" && (r.sk as string).startsWith(skPrefix),
    );
  }),
  // Mock matches real DDB semantics: rows missing the GSI sort-key
  // attribute are NOT projected into the index, so they never match.
  // (Real DDB drops them at index-build time; the mock filters them out
  // at query time, which produces the same observable behaviour.)
  queryByGsi: vi.fn(
    async (
      indexName: "GSI1" | "GSI2",
      partitionKey: string,
      query: {
        skGte?: string;
        skLte?: string;
        skPrefix?: string;
        limit?: number;
      } = {},
    ) => {
      const pkAttr = indexName === "GSI1" ? "gsi1pk" : "gsi2pk";
      const skAttr = indexName === "GSI1" ? "gsi1sk" : "gsi2sk";
      return Array.from(store.values()).filter((r) => {
        if (r[pkAttr] !== partitionKey) return false;
        const skVal = r[skAttr];
        if (typeof skVal !== "string") return false; // not projected
        if (query.skPrefix && !skVal.startsWith(query.skPrefix)) return false;
        if (query.skGte !== undefined && skVal < query.skGte) return false;
        if (query.skLte !== undefined && skVal > query.skLte) return false;
        return true;
      });
    },
  ),
}));

const project = await import("./project.js");
const secrets = await import("./secrets.js");
const getSecretMock = vi.mocked(secrets.getSecret);

beforeEach(() => {
  store.clear();
  getSecretMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// --- Helpers / ProjectId brand ------------------------------------------

describe("ProjectId helpers", () => {
  it("selfProjectId returns self/{slug}", () => {
    expect(project.selfProjectId("ren")).toBe("self/ren");
    expect(project.selfProjectId("maya")).toBe("self/maya");
  });

  it("projectPk prefixes with PROJECT#", () => {
    expect(project.projectPk(project.asProjectId("workforce-meta"))).toBe(
      "PROJECT#workforce-meta",
    );
    expect(project.projectPk(project.selfProjectId("ren"))).toBe("PROJECT#self/ren");
  });

  it("asProjectId rejects empty + delimiter-bearing strings", () => {
    expect(() => project.asProjectId("")).toThrow(/empty/);
    expect(() => project.asProjectId("foo#bar")).toThrow(/must not contain/);
    expect(() => project.asProjectId("foo|bar")).toThrow(/must not contain/);
    expect(project.asProjectId("valid-id")).toBe("valid-id");
  });
});

// --- Lifecycle -----------------------------------------------------------

describe("create + getProject + archive", () => {
  it("writes a META row that getProject() reads back", async () => {
    const id = project.asProjectId("workforce-meta");
    const row = await project.create({
      project_id: id,
      owner_agent: "maya",
      now: "2026-05-26T00:00:00.000Z",
    });
    expect(row.pk).toBe("PROJECT#workforce-meta");
    expect(row.sk).toBe("META");
    expect(row.status).toBe("active");
    expect(row.owner_agent).toBe("maya");
    expect(await project.getProject(id)).toEqual(row);
  });

  it("archive flips status + sets archived_at; rows remain", async () => {
    const id = project.asProjectId("p");
    await project.create({
      project_id: id,
      owner_agent: "_operator",
      now: "2026-01-01T00:00:00.000Z",
    });
    await project.archive(id, "2026-06-01T00:00:00.000Z");
    const got = await project.getProject(id);
    expect(got?.status).toBe("archived");
    expect(got?.archived_at).toBe("2026-06-01T00:00:00.000Z");
  });

  it("archive throws when project doesn't exist", async () => {
    await expect(project.archive(project.asProjectId("ghost"))).rejects.toThrow(/not found/);
  });

  it("create throws ConditionalCheckFailedException on duplicate pk (race-safe per PR #111 cycle 2)", async () => {
    const id = project.asProjectId("dup");
    await project.create({ project_id: id, owner_agent: "_operator" });
    await expect(
      project.create({ project_id: id, owner_agent: "_operator" }),
    ).rejects.toThrow(/conditional check failed/i);
  });
});

// --- Membership ----------------------------------------------------------

describe("membership", () => {
  let p: ProjectId;
  beforeEach(async () => {
    p = project.asProjectId("p");
    await project.create({ project_id: p, owner_agent: "_operator" });
  });

  it("addMember + isMember + members + removeMember round-trip", async () => {
    expect(await project.isMember(p, "ren")).toBe(false);
    await project.addMember(p, "ren", "2026-01-02T00:00:00.000Z");
    await project.addMember(p, "aoi", "2026-01-03T00:00:00.000Z");
    expect(await project.isMember(p, "ren")).toBe(true);
    expect(await project.isMember(p, "aoi")).toBe(true);
    expect(await project.isMember(p, "yuki")).toBe(false);
    expect((await project.members(p)).sort()).toEqual(["aoi", "ren"]);

    await project.removeMember(p, "ren", "2026-02-01T00:00:00.000Z");
    expect(await project.isMember(p, "ren")).toBe(false);
    expect((await project.members(p)).sort()).toEqual(["aoi"]);
  });

  it("removeMember is SOFT delete — row remains with revoked_at for audit", async () => {
    await project.addMember(p, "ren", "2026-01-02T00:00:00.000Z");
    await project.removeMember(p, "ren", "2026-02-01T00:00:00.000Z");
    const raw = store.get("PROJECT#p|MEMBER#ren");
    expect(raw).toBeDefined();
    expect(raw?.revoked_at).toBe("2026-02-01T00:00:00.000Z");
    expect(raw?.joined_at).toBe("2026-01-02T00:00:00.000Z");
  });

  it("removeMember on a non-member is a no-op (idempotent)", async () => {
    await expect(project.removeMember(p, "ghost")).resolves.toBeUndefined();
    expect(store.get("PROJECT#p|MEMBER#ghost")).toBeUndefined();
  });

  it("addMember is idempotent (same slug twice doesn't duplicate)", async () => {
    await project.addMember(p, "ren");
    await project.addMember(p, "ren");
    expect((await project.members(p)).sort()).toEqual(["ren"]);
  });

  it("addMember on an ACTIVE member preserves joined_at (audit — PR #111 cycle 2)", async () => {
    await project.addMember(p, "ren", "2026-01-02T00:00:00.000Z");
    await project.addMember(p, "ren", "2026-03-01T00:00:00.000Z"); // re-seed
    const raw = store.get("PROJECT#p|MEMBER#ren");
    expect(raw?.joined_at).toBe("2026-01-02T00:00:00.000Z");
  });

  it("addMember on a REVOKED member starts a fresh tenure (new joined_at, revoked_at cleared)", async () => {
    await project.addMember(p, "ren", "2026-01-02T00:00:00.000Z");
    await project.removeMember(p, "ren", "2026-02-01T00:00:00.000Z");
    await project.addMember(p, "ren", "2026-03-01T00:00:00.000Z");
    const raw = store.get("PROJECT#p|MEMBER#ren");
    expect(raw?.joined_at).toBe("2026-03-01T00:00:00.000Z");
    expect(raw?.revoked_at).toBeUndefined();
    expect(await project.isMember(p, "ren")).toBe(true);
  });

  it("addMember throws when project doesn't exist", async () => {
    await expect(project.addMember(project.asProjectId("ghost"), "ren")).rejects.toThrow(
      /not found.*call create/,
    );
  });

  it("members() on a project with no MEMBER#* rows returns []", async () => {
    expect(await project.members(p)).toEqual([]);
  });
});

// --- Execution ledger ----------------------------------------------------

describe("appendExecution", () => {
  let a: ProjectId;
  let b: ProjectId;

  beforeEach(async () => {
    a = project.asProjectId("a");
    b = project.asProjectId("b");
    await project.create({ project_id: a, owner_agent: "_operator" });
    await project.create({ project_id: b, owner_agent: "_operator" });
    await project.addMember(a, "ren");
    // ren is NOT a member of "b" — used to trigger cross-project denial.
  });

  it("throws cross-project denial when the agent is not a member", async () => {
    await expect(
      project.appendExecution({
        project_id: b,
        agent_slug: "ren",
        exec_ulid: "01HXY",
        skill_name: "code-task-brief",
        skill_version: "0.1.0",
        started_at: "2026-05-26T00:00:00.000Z",
        ended_at: "2026-05-26T00:00:01.000Z",
        status: "ok",
      }),
    ).rejects.toThrow(/cross-project denial.*"ren".*not a member.*"b"/);
  });

  it("throws when the agent's membership has been revoked", async () => {
    await project.removeMember(a, "ren");
    await expect(
      project.appendExecution({
        project_id: a,
        agent_slug: "ren",
        exec_ulid: "01HXY",
        skill_name: "code-task-brief",
        skill_version: "0.1.0",
        started_at: "2026-05-26T00:00:00.000Z",
        ended_at: "2026-05-26T00:00:01.000Z",
        status: "ok",
      }),
    ).rejects.toThrow(/cross-project denial/);
  });

  it("succeeds when member; populates pk/sk + both GSI fields", async () => {
    const row = await project.appendExecution({
      project_id: a,
      agent_slug: "ren",
      exec_ulid: "01HXY",
      skill_name: "code-task-brief",
      skill_version: "0.1.0",
      started_at: "2026-05-26T00:00:00.000Z",
      ended_at: "2026-05-26T00:00:01.000Z",
      status: "ok",
      used_credential_types: ["github.token"],
    });
    expect(row.pk).toBe("PROJECT#a");
    expect(row.sk).toBe("EXEC#01HXY");
    expect(row.gsi1pk).toBe("AGENT#ren");
    expect(row.gsi1sk).toBe("2026-05-26T00:00:00.000Z");
    expect(row.gsi2pk).toBe("SKILL#code-task-brief");
    expect(row.gsi2sk).toBe("2026-05-26T00:00:00.000Z");
    expect(row.used_credential_types).toEqual(["github.token"]);
  });

  it("succeeds against an archived project — archive does NOT close the ledger (documented semantics)", async () => {
    // Story 1-A chosen semantics: archive is a status flag only. If
    // "archive closes the ledger" is wanted later, gate inside
    // appendExecution on meta.status === "active" — this test would
    // then need to flip to .rejects.
    await project.archive(a, "2026-05-26T00:00:00.000Z");
    await expect(
      project.appendExecution({
        project_id: a,
        agent_slug: "ren",
        exec_ulid: "01POST",
        skill_name: "code-task-brief",
        skill_version: "0.1.0",
        started_at: "2026-05-27T00:00:00.000Z",
        ended_at: "2026-05-27T00:00:01.000Z",
        status: "ok",
      }),
    ).resolves.toBeDefined();
  });
});

// --- listExecutions ------------------------------------------------------

describe("listExecutions", () => {
  let alpha: ProjectId;
  let beta: ProjectId;

  beforeEach(async () => {
    alpha = project.asProjectId("alpha");
    beta = project.asProjectId("beta");
    await project.create({ project_id: alpha, owner_agent: "_operator" });
    await project.create({ project_id: beta, owner_agent: "_operator" });
    await project.addMember(alpha, "ren");
    await project.addMember(alpha, "maya");
    await project.addMember(beta, "ren");

    await project.appendExecution({
      project_id: alpha,
      agent_slug: "ren",
      exec_ulid: "01A",
      skill_name: "code-task-brief",
      skill_version: "0.1.0",
      started_at: "2026-05-20T00:00:00.000Z",
      ended_at: "2026-05-20T00:00:01.000Z",
      status: "ok",
    });
    await project.appendExecution({
      project_id: alpha,
      agent_slug: "maya",
      exec_ulid: "01M",
      skill_name: "plan-write",
      skill_version: "0.1.0",
      started_at: "2026-05-21T00:00:00.000Z",
      ended_at: "2026-05-21T00:00:01.000Z",
      status: "ok",
    });
    await project.appendExecution({
      project_id: beta,
      agent_slug: "ren",
      exec_ulid: "01B",
      skill_name: "code-task-brief",
      skill_version: "0.1.0",
      started_at: "2026-05-22T00:00:00.000Z",
      ended_at: "2026-05-22T00:00:01.000Z",
      status: "ok",
    });
  });

  it("agent_slug filter returns ren's executions across BOTH projects (GSI1)", async () => {
    const rows = await project.listExecutions({ agent_slug: "ren" });
    expect(rows.map((r) => r.sk).sort()).toEqual(["EXEC#01A", "EXEC#01B"]);
  });

  it("skill_name filter returns code-task-brief across BOTH projects (GSI2)", async () => {
    const rows = await project.listExecutions({ skill_name: "code-task-brief" });
    expect(rows.map((r) => r.sk).sort()).toEqual(["EXEC#01A", "EXEC#01B"]);
  });

  it("project_id filter returns only that project's executions", async () => {
    const rows = await project.listExecutions({ project_id: alpha });
    expect(rows.map((r) => r.sk).sort()).toEqual(["EXEC#01A", "EXEC#01M"]);
  });

  it("both bounds (from + to) push down as BETWEEN on GSI1", async () => {
    const rows = await project.listExecutions({
      agent_slug: "ren",
      from: "2026-05-21T00:00:00.000Z",
      to: "2026-05-31T00:00:00.000Z",
    });
    expect(rows.map((r) => r.sk)).toEqual(["EXEC#01B"]);
  });

  it("half-bounded (from only) pushes down as >= on GSI1", async () => {
    const rows = await project.listExecutions({
      agent_slug: "ren",
      from: "2026-05-22T00:00:00.000Z",
    });
    expect(rows.map((r) => r.sk)).toEqual(["EXEC#01B"]);
  });

  it("half-bounded (to only) pushes down as <= on GSI1", async () => {
    const rows = await project.listExecutions({
      agent_slug: "ren",
      to: "2026-05-21T00:00:00.000Z",
    });
    expect(rows.map((r) => r.sk)).toEqual(["EXEC#01A"]);
  });

  it("status post-filter narrows by exec status", async () => {
    await project.appendExecution({
      project_id: alpha,
      agent_slug: "ren",
      exec_ulid: "01THR",
      skill_name: "code-task-brief",
      skill_version: "0.1.0",
      started_at: "2026-05-23T00:00:00.000Z",
      ended_at: "2026-05-23T00:00:01.000Z",
      status: "throw",
    });
    const rows = await project.listExecutions({ agent_slug: "ren", status: "throw" });
    expect(rows.map((r) => r.sk)).toEqual(["EXEC#01THR"]);
  });

  it("throws at runtime when no scope is provided (defence-in-depth past the type)", async () => {
    await expect(
      // @ts-expect-error - intentionally bypassing the discriminated union to verify the runtime throw
      project.listExecutions({}),
    ).rejects.toThrow(/requires at least one of/);
  });
});

// --- getCredential -------------------------------------------------------

describe("getCredential", () => {
  const id = "x" as ProjectId;

  it("returns the project-scoped secret on the happy path", async () => {
    getSecretMock.mockResolvedValueOnce({ token: "proj-scoped" });
    const got = await project.getCredential<{ token: string }>(id, "github.token");
    expect(got).toEqual({ token: "proj-scoped" });
    expect(getSecretMock).toHaveBeenCalledOnce();
    expect(getSecretMock).toHaveBeenCalledWith("wf/projects/x/github.token");
  });

  it("falls back to wf/{type} ONLY on ResourceNotFoundException + logs structured event", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const notFound = new Error("Secrets Manager: no such secret");
    notFound.name = "ResourceNotFoundException";
    getSecretMock.mockRejectedValueOnce(notFound).mockResolvedValueOnce({ token: "legacy" });

    const got = await project.getCredential<{ token: string }>(id, "github.token");
    expect(got).toEqual({ token: "legacy" });
    expect(getSecretMock).toHaveBeenNthCalledWith(1, "wf/projects/x/github.token");
    expect(getSecretMock).toHaveBeenNthCalledWith(2, "wf/github.token");
    expect(warnSpy).toHaveBeenCalledOnce();
    const logged = JSON.parse(warnSpy.mock.calls[0]![0] as string);
    expect(logged).toMatchObject({
      event: "legacy_credential_read",
      project_id: "x",
      credential_type: "github.token",
    });
    warnSpy.mockRestore();
  });

  it("re-throws non-NotFound errors (W-4 — does NOT silently fall back)", async () => {
    const denied = new Error("not authorised");
    denied.name = "AccessDeniedException";
    getSecretMock.mockRejectedValueOnce(denied);
    await expect(
      project.getCredential<{ token: string }>(id, "github.token"),
    ).rejects.toThrow(/not authorised/);
    // Critically: getSecret was NOT called a second time on the legacy path.
    expect(getSecretMock).toHaveBeenCalledOnce();
  });
});
