// Unit tests for workforce/lambdas/shared/project.ts.
//
// Covers the Story 1 (#90) acceptance criteria that are testable at the
// helper layer, plus the cycle-1 review findings from Dario + Ren:
//   - appendExecution writes regardless of membership (write-gate removed)
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

// CloudWatch capture — getCredential() emits WfLegacyCredentialReads on
// every fallback hit (Story 2-B / #91). The mock collects batches and
// the per-tier tests below assert on Namespace + Dimensions.
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
  queryBySkPrefix: vi.fn(
    async (pk: string, skPrefix: string, limit = 100, scanIndexForward = true) => {
      const matched = Array.from(store.values()).filter(
        (r) => r.pk === pk && typeof r.sk === "string" && (r.sk as string).startsWith(skPrefix),
      );
      // Mirror DDB: sort by sort-key, apply scan direction, THEN cap by
      // Limit — so the regression (Limit keeping the oldest rows on an
      // ascending scan) is reproducible in the mock.
      matched.sort((a, b) => (a.sk as string).localeCompare(b.sk as string));
      if (!scanIndexForward) matched.reverse();
      return matched.slice(0, limit);
    },
  ),
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
        scanIndexForward?: boolean;
      } = {},
    ) => {
      const pkAttr = indexName === "GSI1" ? "gsi1pk" : "gsi2pk";
      const skAttr = indexName === "GSI1" ? "gsi1sk" : "gsi2sk";
      const matched = Array.from(store.values()).filter((r) => {
        if (r[pkAttr] !== partitionKey) return false;
        const skVal = r[skAttr];
        if (typeof skVal !== "string") return false; // not projected
        if (query.skPrefix && !skVal.startsWith(query.skPrefix)) return false;
        if (query.skGte !== undefined && skVal < query.skGte) return false;
        if (query.skLte !== undefined && skVal > query.skLte) return false;
        return true;
      });
      // Mirror DDB: sort by GSI sort-key, apply scan direction, THEN cap
      // by Limit — so an ascending scan keeps the oldest `limit` rows.
      matched.sort((a, b) => (a[skAttr] as string).localeCompare(b[skAttr] as string));
      if (query.scanIndexForward === false) matched.reverse();
      return matched.slice(0, query.limit ?? 100);
    },
  ),
}));

const project = await import("./project.js");
const secrets = await import("./secrets.js");
const getSecretMock = vi.mocked(secrets.getSecret);

beforeEach(() => {
  store.clear();
  getSecretMock.mockReset();
  metricBatches.length = 0;
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

  it("unarchive flips status back to active + CLEARS archived_at (Issue #158 PR-β)", async () => {
    const id = project.asProjectId("u");
    await project.create({ project_id: id, owner_agent: "_operator" });
    await project.archive(id, "2026-06-01T00:00:00.000Z");
    await project.unarchive(id);
    const got = await project.getProject(id);
    expect(got?.status).toBe("active");
    expect(got?.archived_at).toBeUndefined();
  });

  it("unarchive on an already-active project is a no-op (idempotent)", async () => {
    const id = project.asProjectId("u2");
    await project.create({ project_id: id, owner_agent: "_operator" });
    // Should not throw, should not change anything.
    await project.unarchive(id);
    const got = await project.getProject(id);
    expect(got?.status).toBe("active");
  });

  it("unarchive throws when project doesn't exist (symmetric with archive)", async () => {
    await expect(project.unarchive(project.asProjectId("ghost"))).rejects.toThrow(/not found/);
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

  // Membership write-gate removed 2026-06-08 (operator decision; C-3).
  // appendExecution writes the ledger row regardless of membership.
  it("writes the row even when the agent is NOT a member (gate removed)", async () => {
    const row = await project.appendExecution({
      project_id: b, // ren is not a member of "b"
      agent_slug: "ren",
      exec_ulid: "01HXY",
      skill_name: "code-task-brief",
      skill_version: "0.1.0",
      started_at: "2026-05-26T00:00:00.000Z",
      ended_at: "2026-05-26T00:00:01.000Z",
      status: "ok",
    });
    expect(row.pk).toBe("PROJECT#b");
    expect(row.sk).toBe("EXEC#01HXY");
    expect(row.agent_slug).toBe("ren");
  });

  it("writes the row even when membership has been revoked (gate removed)", async () => {
    await project.removeMember(a, "ren");
    const row = await project.appendExecution({
      project_id: a,
      agent_slug: "ren",
      exec_ulid: "01HXY",
      skill_name: "code-task-brief",
      skill_version: "0.1.0",
      started_at: "2026-05-26T00:00:00.000Z",
      ended_at: "2026-05-26T00:00:01.000Z",
      status: "ok",
    });
    expect(row.sk).toBe("EXEC#01HXY");
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

  it("returns the NEWEST rows when limit truncates (engagement-ledger read regression)", async () => {
    // ren already has 01A (05-20) + 01B (05-22) from beforeEach. Add a row
    // newer than both; with limit:1, an ascending scan would keep the
    // OLDEST (01A) and today's engagement would never surface — the exact
    // bug that hid a busy agent's just-written EXEC row from /executions.
    await project.appendExecution({
      project_id: alpha,
      agent_slug: "ren",
      exec_ulid: "01Z",
      skill_name: "code-task-brief",
      skill_version: "0.1.0",
      started_at: "2026-06-07T11:29:58.000Z",
      ended_at: "2026-06-07T11:30:00.000Z",
      status: "ok",
    });
    const rows = await project.listExecutions({ agent_slug: "ren", limit: 1 });
    expect(rows.map((r) => r.sk)).toEqual(["EXEC#01Z"]);
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

  // ── Story 4 (#93) — caller_agent_slug read-gate ────────────────────
  // Defence-in-depth: even when a row has a GSI1 partition pointing at
  // an agent, the row is dropped if the caller is not an active member
  // of that row's project. `_operator` and the unset (legacy) case both
  // see all rows.
  describe("Story 4 — caller_agent_slug read-gate", () => {
    it("ren as caller sees ONLY rows from projects ren is a member of", async () => {
      // Add a row in beta with agent_slug=maya but a forged GSI1 pointing
      // at AGENT#ren (simulating an upstream bug / attack surface).
      store.set("PROJECT#beta|EXEC#01LEAK", {
        pk: "PROJECT#beta",
        sk: "EXEC#01LEAK",
        project_id: beta,
        agent_slug: "ren",
        skill_name: "leak",
        skill_version: "0.1.0",
        started_at: "2026-05-25T00:00:00.000Z",
        ended_at: "2026-05-25T00:00:01.000Z",
        status: "ok",
        gsi1pk: "AGENT#ren",
        gsi1sk: "2026-05-25T00:00:00.000Z",
        gsi2pk: "SKILL#leak",
        gsi2sk: "2026-05-25T00:00:00.000Z",
      });

      // ren is now a member of alpha (per beforeEach) and we ADD ren to
      // beta in this fixture's outer scope. So set up: remove ren from
      // beta and verify the leak row is dropped.
      await project.removeMember(beta, "ren");

      const gated = await project.listExecutions({
        agent_slug: "ren",
        caller_agent_slug: "ren",
      });
      expect(gated.map((r) => r.sk)).toContain("EXEC#01A"); // ren ∈ alpha
      expect(gated.map((r) => r.sk)).not.toContain("EXEC#01LEAK"); // ren ∉ beta
      expect(gated.map((r) => r.sk)).not.toContain("EXEC#01B"); // also dropped — ren ∉ beta now
    });

    it("_operator caller sees everything (gate short-circuits)", async () => {
      // Same setup as the previous test but caller is _operator.
      store.set("PROJECT#beta|EXEC#01LEAK", {
        pk: "PROJECT#beta",
        sk: "EXEC#01LEAK",
        project_id: beta,
        agent_slug: "ren",
        skill_name: "leak",
        skill_version: "0.1.0",
        started_at: "2026-05-25T00:00:00.000Z",
        ended_at: "2026-05-25T00:00:01.000Z",
        status: "ok",
        gsi1pk: "AGENT#ren",
        gsi1sk: "2026-05-25T00:00:00.000Z",
        gsi2pk: "SKILL#leak",
        gsi2sk: "2026-05-25T00:00:00.000Z",
      });
      await project.removeMember(beta, "ren");

      const all = await project.listExecutions({
        agent_slug: "ren",
        caller_agent_slug: "_operator",
      });
      expect(all.map((r) => r.sk).sort()).toContain("EXEC#01LEAK");
    });

    it("absent caller_agent_slug is BACKWARD-COMPATIBLE — gate does not run", async () => {
      // Pre-Story-4 callers (existing agent-runner, agents-api) MUST
      // continue to see un-gated results so we don't break their tests.
      // Bare listExecutions({ agent_slug }) keeps the legacy behaviour.
      const rows = await project.listExecutions({ agent_slug: "ren" });
      expect(rows.map((r) => r.sk).sort()).toEqual(["EXEC#01A", "EXEC#01B"]);
    });
  });
});

// --- appendExecution: embedding sidecar (Story 4) -------------------------

describe("appendExecution — embedding sidecar (Story 4)", () => {
  let alpha: ProjectId;

  beforeEach(async () => {
    alpha = project.asProjectId("alpha");
    await project.create({ project_id: alpha, owner_agent: "_operator" });
    await project.addMember(alpha, "ren");
  });

  function baseInput(opts: Partial<Parameters<typeof project.appendExecution>[0]> = {}) {
    return {
      project_id: alpha,
      agent_slug: "ren" as const,
      exec_ulid: "01E",
      skill_name: "s",
      skill_version: "0.1.0",
      started_at: "2026-05-20T00:00:00.000Z",
      ended_at: "2026-05-20T00:00:01.000Z",
      status: "ok" as const,
      ...opts,
    };
  }

  it("ok-status with all four embedding attrs lands cleanly", async () => {
    const bytes = new Uint8Array(12); // dim 3 * 4 bytes
    const row = await project.appendExecution(
      baseInput({
        embedding_bytes: bytes,
        embedding_model_id: "voyage-3-lite",
        embedding_dim: 3,
        embedding_status: "ok",
      }),
    );
    expect(row.embedding_status).toBe("ok");
    expect(row.embedding_dim).toBe(3);
  });

  it("pending-status with no byte/model/dim attrs lands cleanly", async () => {
    const row = await project.appendExecution(
      baseInput({ embedding_status: "pending" }),
    );
    expect(row.embedding_status).toBe("pending");
    expect(row.embedding_bytes).toBeUndefined();
  });

  it("throws on partial sidecar — bytes without model_id (W-4)", async () => {
    await expect(
      project.appendExecution(
        baseInput({
          embedding_bytes: new Uint8Array(12),
          embedding_dim: 3,
          embedding_status: "ok",
        }),
      ),
    ).rejects.toThrow(/all-present or all-absent/);
  });

  it("throws on embedding_status='ok' without bytes (would silently break recall)", async () => {
    await expect(
      project.appendExecution(baseInput({ embedding_status: "ok" })),
    ).rejects.toThrow(/embedding_status='ok' requires/);
  });

  it("throws on bytes-present + non-ok status (corrupt sidecar state)", async () => {
    await expect(
      project.appendExecution(
        baseInput({
          embedding_bytes: new Uint8Array(12),
          embedding_model_id: "voyage-3-lite",
          embedding_dim: 3,
          embedding_status: "pending",
        }),
      ),
    ).rejects.toThrow(/expected 'ok' when bytes are present/);
  });

  it("throws on byteLength vs embedding_dim mismatch", async () => {
    await expect(
      project.appendExecution(
        baseInput({
          embedding_bytes: new Uint8Array(8), // 2 floats
          embedding_model_id: "voyage-3-lite",
          embedding_dim: 3, // says 3 floats
          embedding_status: "ok",
        }),
      ),
    ).rejects.toThrow(/byteLength=8 does not match embedding_dim=3/);
  });

  it("pre-Story-4 row shape (no sidecar attrs at all) still lands", async () => {
    const row = await project.appendExecution(baseInput());
    expect(row.embedding_status).toBeUndefined();
    expect(row.embedding_bytes).toBeUndefined();
  });
});

// --- getCredential -------------------------------------------------------

describe("getCredential", () => {
  const id = "x" as ProjectId;

  /** Fire-and-forget metric emission inside getCredential() doesn't
   *  await the CloudWatch send, so tests need to drain microtasks /
   *  macrotasks before observing `metricBatches`. */
  async function flushMetrics(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  function notFoundErr(): Error {
    const err = new Error("Secrets Manager: no such secret");
    err.name = "ResourceNotFoundException";
    return err;
  }

  it("returns the project-scoped secret on the happy path (no fallback, no metric)", async () => {
    getSecretMock.mockResolvedValueOnce({ token: "proj-scoped" });
    const got = await project.getCredential<{ token: string }>(id, "github.token");
    expect(got).toEqual({ token: "proj-scoped" });
    expect(getSecretMock).toHaveBeenCalledOnce();
    expect(getSecretMock).toHaveBeenCalledWith("wf/projects/x/github.token");
    await flushMetrics();
    expect(metricBatches).toHaveLength(0);
  });

  it("falls back to wf/projects/_default/{type} when project-scoped is NotFound + emits fallback_default metric", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    getSecretMock
      .mockRejectedValueOnce(notFoundErr())
      .mockResolvedValueOnce({ token: "shared-default" });

    const got = await project.getCredential<{ token: string }>(id, "github.token");
    expect(got).toEqual({ token: "shared-default" });
    expect(getSecretMock).toHaveBeenCalledTimes(2);
    expect(getSecretMock).toHaveBeenNthCalledWith(1, "wf/projects/x/github.token");
    expect(getSecretMock).toHaveBeenNthCalledWith(2, "wf/projects/_default/github.token");

    const logged = JSON.parse(warnSpy.mock.calls[0]![0] as string);
    expect(logged).toMatchObject({
      event: "legacy_credential_read",
      project_id: "x",
      credential_type: "github.token",
      reason: "fallback_default",
    });

    await flushMetrics();
    expect(metricBatches).toHaveLength(1);
    const batch = metricBatches[0]!;
    expect(batch.Namespace).toBe("Workforce/Credentials");
    expect(batch.MetricData[0]!.MetricName).toBe("WfLegacyCredentialReads");
    expect(batch.MetricData[0]!.Value).toBe(1);
    expect(batch.MetricData[0]!.Dimensions).toEqual(
      expect.arrayContaining([{ Name: "Reason", Value: "fallback_default" }]),
    );
    warnSpy.mockRestore();
  });

  it("falls all the way back to wf/{type} when BOTH project-scoped + _default are NotFound + emits fallback_bare metric", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    getSecretMock
      .mockRejectedValueOnce(notFoundErr())
      .mockRejectedValueOnce(notFoundErr())
      .mockResolvedValueOnce({ token: "legacy-bare" });

    const got = await project.getCredential<{ token: string }>(id, "github.token");
    expect(got).toEqual({ token: "legacy-bare" });
    expect(getSecretMock).toHaveBeenCalledTimes(3);
    expect(getSecretMock).toHaveBeenNthCalledWith(1, "wf/projects/x/github.token");
    expect(getSecretMock).toHaveBeenNthCalledWith(2, "wf/projects/_default/github.token");
    expect(getSecretMock).toHaveBeenNthCalledWith(3, "wf/github.token");

    const logged = JSON.parse(warnSpy.mock.calls[0]![0] as string);
    expect(logged).toMatchObject({
      event: "legacy_credential_read",
      reason: "fallback_bare",
    });

    await flushMetrics();
    expect(metricBatches).toHaveLength(1);
    expect(metricBatches[0]!.MetricData[0]!.Dimensions).toEqual(
      expect.arrayContaining([{ Name: "Reason", Value: "fallback_bare" }]),
    );
    warnSpy.mockRestore();
  });

  it("throws loudly when ALL three tiers are NotFound (W-4)", async () => {
    getSecretMock
      .mockRejectedValueOnce(notFoundErr())
      .mockRejectedValueOnce(notFoundErr())
      .mockRejectedValueOnce(notFoundErr());
    await expect(
      project.getCredential<{ token: string }>(id, "github.token"),
    ).rejects.toThrow();
    expect(getSecretMock).toHaveBeenCalledTimes(3);
  });

  it("re-throws non-NotFound at tier 1 (project-scoped) — does NOT fall through", async () => {
    const denied = new Error("not authorised");
    denied.name = "AccessDeniedException";
    getSecretMock.mockRejectedValueOnce(denied);
    await expect(
      project.getCredential<{ token: string }>(id, "github.token"),
    ).rejects.toThrow(/not authorised/);
    expect(getSecretMock).toHaveBeenCalledOnce();
  });

  it("re-throws non-NotFound at tier 2 (_default) — does NOT fall through to bare", async () => {
    const denied = new Error("throttled");
    denied.name = "ThrottlingException";
    getSecretMock.mockRejectedValueOnce(notFoundErr()).mockRejectedValueOnce(denied);
    await expect(
      project.getCredential<{ token: string }>(id, "github.token"),
    ).rejects.toThrow(/throttled/);
    expect(getSecretMock).toHaveBeenCalledTimes(2);
  });
});
