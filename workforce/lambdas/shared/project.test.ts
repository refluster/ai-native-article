// Unit tests for workforce/lambdas/shared/project.ts.
//
// Covers the Story 1 (#90) acceptance criteria that are testable at the
// helper layer:
//
//   1. cross-project denial — append_execution() throws when the agent
//      is not a member of the named project
//   2. self project helper — selfProjectId() returns the canonical shape
//   3. GSI1 cross-project query — list_executions({agent_slug}) hits GSI1
//      regardless of which project's partition the rows live under
//   4. GSI2 cross-project query — list_executions({skill_name}) hits GSI2
//   5. shape correctness — created rows have the right pk/sk/gsi*pk/gsi*sk
//
// The dual-write integration test and the backfill-Lambda idempotency
// test belong in Story 1-B (the wire-up PR).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the secrets module before importing project.ts so getSecret is
// safely mockable (none of these tests actually exercise get_credential
// against AWS).
vi.mock("./secrets.js", () => ({
  getSecret: vi.fn(async (name: string) => {
    throw new Error(`unexpected getSecret call in unit test: ${name}`);
  }),
}));

// In-memory DDB. Keyed by `${pk}|${sk}`. Tests pre-populate / inspect via
// the exported helpers in `mock-ddb.ts` (kept private to this file).
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
  deleteItem: vi.fn(async (pk: string, sk: string) => {
    store.delete(key(pk, sk));
  }),
  queryBySkPrefix: vi.fn(async (pk: string, skPrefix: string, _limit?: number) => {
    return Array.from(store.values()).filter(
      (r) => r.pk === pk && typeof r.sk === "string" && (r.sk as string).startsWith(skPrefix),
    );
  }),
  queryByGsi: vi.fn(
    async (
      indexName: "GSI1" | "GSI2",
      partitionKey: string,
      query: { skBetween?: [string, string]; skPrefix?: string; limit?: number } = {},
    ) => {
      const pkAttr = indexName === "GSI1" ? "gsi1pk" : "gsi2pk";
      const skAttr = indexName === "GSI1" ? "gsi1sk" : "gsi2sk";
      return Array.from(store.values()).filter((r) => {
        if (r[pkAttr] !== partitionKey) return false;
        const skVal = r[skAttr] as string | undefined;
        if (query.skBetween && skVal !== undefined) {
          if (skVal < query.skBetween[0] || skVal > query.skBetween[1]) return false;
        }
        if (query.skPrefix && skVal !== undefined) {
          if (!skVal.startsWith(query.skPrefix)) return false;
        }
        return true;
      });
    },
  ),
}));

// Import AFTER vi.mock so the module under test resolves the mocked deps.
const project = await import("./project.js");

beforeEach(() => {
  store.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// --- Helpers -------------------------------------------------------------

describe("selfProjectId", () => {
  it("returns self/{slug}", () => {
    expect(project.selfProjectId("ren")).toBe("self/ren");
    expect(project.selfProjectId("maya")).toBe("self/maya");
  });
});

describe("projectPk", () => {
  it("prefixes with PROJECT#", () => {
    expect(project.projectPk("workforce-meta")).toBe("PROJECT#workforce-meta");
    expect(project.projectPk("self/ren")).toBe("PROJECT#self/ren");
  });
});

// --- Lifecycle -----------------------------------------------------------

describe("create + get + archive", () => {
  it("writes a META row that get() can read back", async () => {
    const row = await project.create({
      project_id: "workforce-meta",
      owner_agent: "maya",
      now: "2026-05-26T00:00:00.000Z",
    });
    expect(row).toEqual({
      pk: "PROJECT#workforce-meta",
      sk: "META",
      project_id: "workforce-meta",
      status: "active",
      owner_agent: "maya",
      created_at: "2026-05-26T00:00:00.000Z",
    });
    const got = await project.get("workforce-meta");
    expect(got).toEqual(row);
  });

  it("archive() flips status + sets archived_at; rows remain", async () => {
    await project.create({ project_id: "p", owner_agent: "_operator", now: "2026-01-01T00:00:00.000Z" });
    await project.archive("p", "2026-06-01T00:00:00.000Z");
    const got = await project.get("p");
    expect(got?.status).toBe("archived");
    expect(got?.archived_at).toBe("2026-06-01T00:00:00.000Z");
  });

  it("archive() throws when project doesn't exist", async () => {
    await expect(project.archive("ghost")).rejects.toThrow(/not found/);
  });
});

// --- Membership ----------------------------------------------------------

describe("membership", () => {
  beforeEach(async () => {
    await project.create({ project_id: "p", owner_agent: "_operator", now: "2026-01-01T00:00:00.000Z" });
  });

  it("add_member + is_member + members + remove_member round-trip", async () => {
    expect(await project.is_member("p", "ren")).toBe(false);

    await project.add_member("p", "ren", "2026-01-02T00:00:00.000Z");
    await project.add_member("p", "aoi", "2026-01-03T00:00:00.000Z");

    expect(await project.is_member("p", "ren")).toBe(true);
    expect(await project.is_member("p", "aoi")).toBe(true);
    expect(await project.is_member("p", "yuki")).toBe(false);

    const list = (await project.members("p")).sort();
    expect(list).toEqual(["aoi", "ren"]);

    await project.remove_member("p", "ren");
    expect(await project.is_member("p", "ren")).toBe(false);
    expect((await project.members("p")).sort()).toEqual(["aoi"]);
  });
});

// --- Execution ledger (cross-project denial + GSI fields) ----------------

describe("append_execution", () => {
  beforeEach(async () => {
    await project.create({ project_id: "a", owner_agent: "_operator" });
    await project.create({ project_id: "b", owner_agent: "_operator" });
    await project.add_member("a", "ren");
    // NOTE: ren is NOT a member of "b" — used to trigger cross-project denial.
  });

  it("throws cross-project denial when the agent is not a member", async () => {
    await expect(
      project.append_execution({
        project_id: "b",
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

  it("succeeds when member and populates pk/sk + both GSI fields", async () => {
    const row = await project.append_execution({
      project_id: "a",
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
});

// --- list_executions (cross-project recall via GSIs) ---------------------

describe("list_executions", () => {
  beforeEach(async () => {
    // Two projects, ren is a member of both. We'll write executions to
    // each project's partition and verify GSI1 returns ren's executions
    // across both, GSI2 returns the named skill across both, and the
    // project-partition path returns only that project's executions.
    await project.create({ project_id: "alpha", owner_agent: "_operator" });
    await project.create({ project_id: "beta", owner_agent: "_operator" });
    await project.add_member("alpha", "ren");
    await project.add_member("alpha", "maya");
    await project.add_member("beta", "ren");

    await project.append_execution({
      project_id: "alpha",
      agent_slug: "ren",
      exec_ulid: "01A",
      skill_name: "code-task-brief",
      skill_version: "0.1.0",
      started_at: "2026-05-20T00:00:00.000Z",
      ended_at: "2026-05-20T00:00:01.000Z",
      status: "ok",
    });
    await project.append_execution({
      project_id: "alpha",
      agent_slug: "maya",
      exec_ulid: "01M",
      skill_name: "plan-write",
      skill_version: "0.1.0",
      started_at: "2026-05-21T00:00:00.000Z",
      ended_at: "2026-05-21T00:00:01.000Z",
      status: "ok",
    });
    await project.append_execution({
      project_id: "beta",
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
    const rows = await project.list_executions({ agent_slug: "ren" });
    expect(rows.map((r) => r.sk).sort()).toEqual(["EXEC#01A", "EXEC#01B"]);
  });

  it("skill_name filter returns code-task-brief across BOTH projects (GSI2)", async () => {
    const rows = await project.list_executions({ skill_name: "code-task-brief" });
    expect(rows.map((r) => r.sk).sort()).toEqual(["EXEC#01A", "EXEC#01B"]);
  });

  it("project_id filter returns only that project's executions", async () => {
    const rows = await project.list_executions({ project_id: "alpha" });
    expect(rows.map((r) => r.sk).sort()).toEqual(["EXEC#01A", "EXEC#01M"]);
  });

  it("from/to range filters work on GSI1", async () => {
    const rows = await project.list_executions({
      agent_slug: "ren",
      from: "2026-05-21T00:00:00.000Z",
      to: "2026-05-31T00:00:00.000Z",
    });
    expect(rows.map((r) => r.sk)).toEqual(["EXEC#01B"]);
  });

  it("throws when none of {agent_slug, skill_name, project_id} is provided", async () => {
    await expect(project.list_executions({})).rejects.toThrow(/requires at least one of/);
  });
});
