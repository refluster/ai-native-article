// Unit tests for workforce/lambdas/shared/recall.ts.
//
// Covers the in-scope #93 acceptance criteria at the helper layer:
//
//   AC1 — agent.recall NEVER returns an EXEC from a project the calling
//         agent is not an active member of (defence in depth: gate at
//         listExecutions caller_agent_slug AND in recall.ts dropForbidden).
//
//   - Structured filter dispatch (project / skill / from / to / status).
//   - Semantic dispatch: brute-force kNN over the agent partition, top-k
//     by cosine, structured post-filter composes correctly.
//   - `query` empty / `_operator` cases throw with actionable messages.
//   - Embedded-only filter: rows with embedding_status !== 'ok' are
//     excluded from the semantic candidate pool but appear in structured.
//   - Query-dim mismatch throws (defence in depth on model drift).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectId } from "./project.js";
import {
  encodeEmbeddingBytes,
} from "./embedding.js";

// ─── Mocks ────────────────────────────────────────────────────────────

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
  conditionalPutItem: vi.fn(async (item: AnyRow) => {
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
  queryBySkPrefix: vi.fn(async (pk: string, skPrefix: string) => {
    return Array.from(store.values()).filter(
      (r) =>
        r.pk === pk &&
        typeof r.sk === "string" &&
        (r.sk as string).startsWith(skPrefix),
    );
  }),
  queryByGsi: vi.fn(
    async (
      indexName: "GSI1" | "GSI2",
      partitionKey: string,
      query: { skGte?: string; skLte?: string; limit?: number } = {},
    ) => {
      const pkAttr = indexName === "GSI1" ? "gsi1pk" : "gsi2pk";
      const skAttr = indexName === "GSI1" ? "gsi1sk" : "gsi2sk";
      return Array.from(store.values()).filter((r) => {
        if (r[pkAttr] !== partitionKey) return false;
        const skVal = r[skAttr];
        if (typeof skVal !== "string") return false;
        if (query.skGte !== undefined && skVal < query.skGte) return false;
        if (query.skLte !== undefined && skVal > query.skLte) return false;
        return true;
      });
    },
  ),
}));

vi.mock("./secrets.js", () => ({
  getSecret: vi.fn(),
}));

// Mock the Voyage embed client. We DON'T call the real network — tests
// inject the exact vector they want returned so the kNN ranking is
// reproducible. `inputType: 'query'` returns the query fixture; the
// 'document' path is exercised via exec-embedding tests, not here.
const embedMock = vi.fn();
vi.mock("./voyage.js", () => ({
  embedText: embedMock,
  VOYAGE_MODEL_ID: "voyage-3-lite",
  VOYAGE_DIM: 3, // tiny dim for fixture clarity
}));

// Import AFTER mocks.
const project = await import("./project.js");
const recall = await import("./recall.js");

// ─── Fixture helpers ──────────────────────────────────────────────────

function unitVec(...components: number[]): Uint8Array {
  return encodeEmbeddingBytes(Float32Array.from(components));
}

async function seedProject(id: ProjectId, members: Array<"ren" | "maya" | "aoi">) {
  await project.create({ project_id: id, owner_agent: "_operator" });
  for (const m of members) await project.addMember(id, m);
}

async function seedExec(
  projectId: ProjectId,
  opts: {
    agent: "ren" | "maya" | "aoi";
    ulid: string;
    skill: string;
    startedAt: string;
    status?: "ok" | "throw" | "skipped";
    embedding?: Float32Array;
    embeddingStatus?: "ok" | "pending" | "skipped";
  },
) {
  const hasEmbedding = opts.embedding !== undefined;
  await project.appendExecution({
    project_id: projectId,
    agent_slug: opts.agent,
    exec_ulid: opts.ulid,
    skill_name: opts.skill,
    skill_version: "0.1.0",
    started_at: opts.startedAt,
    ended_at: opts.startedAt,
    status: opts.status ?? "ok",
    embedding_bytes: hasEmbedding ? encodeEmbeddingBytes(opts.embedding!) : undefined,
    embedding_model_id: hasEmbedding ? "voyage-3-lite" : undefined,
    embedding_dim: hasEmbedding ? opts.embedding!.length : undefined,
    embedding_status: opts.embeddingStatus ?? (hasEmbedding ? "ok" : "pending"),
  });
}

beforeEach(() => {
  store.clear();
  embedMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── AC1 — Cross-project read-gate ────────────────────────────────────

describe("recall — AC1 cross-project read-gate", () => {
  it("structured recall: ren sees rows from project alpha but NOT from project beta (non-member)", async () => {
    const alpha = project.asProjectId("alpha");
    const beta = project.asProjectId("beta");
    await seedProject(alpha, ["ren"]);
    await seedProject(beta, ["maya"]); // ren is NOT a member of beta

    await seedExec(alpha, {
      agent: "ren",
      ulid: "01ALPHA",
      skill: "code-task-brief",
      startedAt: "2026-05-20T00:00:00.000Z",
    });

    // Maya runs in beta; ren is not a member. Inject a row whose GSI1
    // partition happens to also point at AGENT#ren (simulating a
    // historical buggy write — the gate must still catch it).
    await project.appendExecution({
      project_id: beta,
      agent_slug: "maya",
      exec_ulid: "01BETA",
      skill_name: "plan-write",
      skill_version: "0.1.0",
      started_at: "2026-05-21T00:00:00.000Z",
      ended_at: "2026-05-21T00:00:01.000Z",
      status: "ok",
    });
    // Force a GSI1 row pointing at ren to simulate the attack surface.
    store.set("PROJECT#beta|EXEC#01LEAK", {
      pk: "PROJECT#beta",
      sk: "EXEC#01LEAK",
      project_id: beta,
      agent_slug: "ren",
      skill_name: "leak",
      skill_version: "0.1.0",
      started_at: "2026-05-22T00:00:00.000Z",
      ended_at: "2026-05-22T00:00:01.000Z",
      status: "ok",
      gsi1pk: "AGENT#ren",
      gsi1sk: "2026-05-22T00:00:00.000Z",
      gsi2pk: "SKILL#leak",
      gsi2sk: "2026-05-22T00:00:00.000Z",
    });

    const results = await recall.recallStructured({ caller_agent_slug: "ren" });
    const sks = results.map((r) => r.row.sk);
    expect(sks).toContain("EXEC#01ALPHA");
    expect(sks).not.toContain("EXEC#01LEAK");
  });

  it("semantic recall: ren never gets a kNN hit from a project they don't belong to", async () => {
    const alpha = project.asProjectId("alpha");
    const beta = project.asProjectId("beta");
    await seedProject(alpha, ["ren"]);
    await seedProject(beta, ["maya"]);

    // Both rows are GSI1 'AGENT#ren' (simulating the same buggy write
    // shape). The beta row is the better kNN match by construction.
    await seedExec(alpha, {
      agent: "ren",
      ulid: "01ALPHA",
      skill: "s",
      startedAt: "2026-05-20T00:00:00.000Z",
      embedding: Float32Array.from([0, 1, 0]),
    });
    store.set("PROJECT#beta|EXEC#01LEAK", {
      pk: "PROJECT#beta",
      sk: "EXEC#01LEAK",
      project_id: beta,
      agent_slug: "ren",
      skill_name: "leak",
      skill_version: "0.1.0",
      started_at: "2026-05-22T00:00:00.000Z",
      ended_at: "2026-05-22T00:00:01.000Z",
      status: "ok",
      gsi1pk: "AGENT#ren",
      gsi1sk: "2026-05-22T00:00:00.000Z",
      gsi2pk: "SKILL#leak",
      gsi2sk: "2026-05-22T00:00:00.000Z",
      embedding_bytes: encodeEmbeddingBytes(Float32Array.from([1, 0, 0])),
      embedding_model_id: "voyage-3-lite",
      embedding_dim: 3,
      embedding_status: "ok",
    });

    // Query points at (1,0,0) — the LEAK row is a perfect match. Gate
    // must drop it before returning to the caller.
    embedMock.mockResolvedValueOnce({
      embedding: Float32Array.from([1, 0, 0]),
      modelId: "voyage-3-lite",
      dim: 3,
      tokensIn: 5,
    });

    const results = await recall.recallSemantic({
      caller_agent_slug: "ren",
      query: "anything",
      k: 5,
    });
    const sks = results.map((r) => r.row.sk);
    expect(sks).not.toContain("EXEC#01LEAK");
    expect(sks).toContain("EXEC#01ALPHA");
  });
});

// ─── Structured dispatch ──────────────────────────────────────────────

describe("recallStructured", () => {
  let alpha: ProjectId;
  let beta: ProjectId;

  beforeEach(async () => {
    alpha = project.asProjectId("alpha");
    beta = project.asProjectId("beta");
    await seedProject(alpha, ["ren"]);
    await seedProject(beta, ["ren"]);

    await seedExec(alpha, {
      agent: "ren",
      ulid: "01A1",
      skill: "code-task-brief",
      startedAt: "2026-05-20T00:00:00.000Z",
    });
    await seedExec(alpha, {
      agent: "ren",
      ulid: "01A2",
      skill: "plan-write",
      startedAt: "2026-05-21T00:00:00.000Z",
      status: "throw",
    });
    await seedExec(beta, {
      agent: "ren",
      ulid: "01B1",
      skill: "code-task-brief",
      startedAt: "2026-05-22T00:00:00.000Z",
    });
  });

  it("returns newest-first across both projects ren is a member of", async () => {
    const r = await recall.recallStructured({ caller_agent_slug: "ren" });
    expect(r.map((x) => x.row.sk)).toEqual(["EXEC#01B1", "EXEC#01A2", "EXEC#01A1"]);
  });

  it("project filter narrows to that project's rows", async () => {
    const r = await recall.recallStructured({
      caller_agent_slug: "ren",
      project: alpha,
    });
    expect(r.map((x) => x.row.sk).sort()).toEqual(["EXEC#01A1", "EXEC#01A2"]);
  });

  it("skill filter narrows to that skill", async () => {
    const r = await recall.recallStructured({
      caller_agent_slug: "ren",
      skill: "code-task-brief",
    });
    expect(r.map((x) => x.row.sk).sort()).toEqual(["EXEC#01A1", "EXEC#01B1"]);
  });

  it("status filter narrows to that status", async () => {
    const r = await recall.recallStructured({
      caller_agent_slug: "ren",
      status: "throw",
    });
    expect(r.map((x) => x.row.sk)).toEqual(["EXEC#01A2"]);
  });

  it("time range push-down (from inclusive)", async () => {
    const r = await recall.recallStructured({
      caller_agent_slug: "ren",
      from: "2026-05-21T00:00:00.000Z",
    });
    expect(r.map((x) => x.row.sk).sort()).toEqual(["EXEC#01A2", "EXEC#01B1"]);
  });

  it("k caps the returned set", async () => {
    const r = await recall.recallStructured({ caller_agent_slug: "ren", k: 1 });
    expect(r).toHaveLength(1);
    expect(r[0]!.row.sk).toBe("EXEC#01B1"); // newest
  });

  it("_operator throws — must use listExecutions directly with a scope", async () => {
    await expect(
      recall.recallStructured({ caller_agent_slug: "_operator" }),
    ).rejects.toThrow(/_operator/);
  });
});

// ─── Semantic dispatch ────────────────────────────────────────────────

describe("recallSemantic", () => {
  let alpha: ProjectId;

  beforeEach(async () => {
    alpha = project.asProjectId("alpha");
    await seedProject(alpha, ["ren"]);

    await seedExec(alpha, {
      agent: "ren",
      ulid: "01E",
      skill: "s",
      startedAt: "2026-05-20T00:00:00.000Z",
      embedding: Float32Array.from([1, 0, 0]),
    });
    await seedExec(alpha, {
      agent: "ren",
      ulid: "01NE",
      skill: "s",
      startedAt: "2026-05-21T00:00:00.000Z",
      embedding: Float32Array.from([Math.SQRT1_2, Math.SQRT1_2, 0]),
    });
    await seedExec(alpha, {
      agent: "ren",
      ulid: "01N",
      skill: "s",
      startedAt: "2026-05-22T00:00:00.000Z",
      embedding: Float32Array.from([0, 1, 0]),
    });
    await seedExec(alpha, {
      agent: "ren",
      ulid: "01PEND",
      skill: "s",
      startedAt: "2026-05-23T00:00:00.000Z",
      // No embedding — status='pending'. Should be excluded from kNN
      // pool but visible via structured recall.
      embeddingStatus: "pending",
    });
  });

  it("returns top-k by cosine against (1,0,0) — east beats NE beats north", async () => {
    embedMock.mockResolvedValueOnce({
      embedding: Float32Array.from([1, 0, 0]),
      modelId: "voyage-3-lite",
      dim: 3,
      tokensIn: 5,
    });
    const r = await recall.recallSemantic({
      caller_agent_slug: "ren",
      query: "near east",
      k: 3,
      embedding_project_id: alpha,
    });
    expect(r.map((x) => x.row.sk)).toEqual(["EXEC#01E", "EXEC#01NE", "EXEC#01N"]);
    expect(r[0]!.score).toBeCloseTo(1, 5);
  });

  it("excludes embedding_status !== 'ok' rows from the candidate pool", async () => {
    embedMock.mockResolvedValueOnce({
      embedding: Float32Array.from([1, 0, 0]),
      modelId: "voyage-3-lite",
      dim: 3,
      tokensIn: 5,
    });
    const r = await recall.recallSemantic({
      caller_agent_slug: "ren",
      query: "x",
      k: 10,
      embedding_project_id: alpha,
    });
    // EXEC#01PEND has no embedding and must NOT appear, even when k > pool size.
    expect(r.map((x) => x.row.sk)).not.toContain("EXEC#01PEND");
    expect(r).toHaveLength(3);
  });

  it("structured post-filter composes with kNN — k=1 + skill filter only matches plan-write", async () => {
    // Seed a plan-write row that's a worse kNN match than the s rows.
    await seedExec(alpha, {
      agent: "ren",
      ulid: "01PLAN",
      skill: "plan-write",
      startedAt: "2026-05-24T00:00:00.000Z",
      embedding: Float32Array.from([Math.SQRT1_2, Math.SQRT1_2, 0]),
    });

    embedMock.mockResolvedValueOnce({
      embedding: Float32Array.from([1, 0, 0]),
      modelId: "voyage-3-lite",
      dim: 3,
      tokensIn: 5,
    });

    const r = await recall.recallSemantic({
      caller_agent_slug: "ren",
      query: "x",
      k: 1,
      skill: "plan-write",
      embedding_project_id: alpha,
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.row.sk).toBe("EXEC#01PLAN");
  });

  it("throws on empty query", async () => {
    await expect(
      recall.recallSemantic({ caller_agent_slug: "ren", query: "   " }),
    ).rejects.toThrow(/non-empty/);
  });

  it("throws when called as _operator (global semantic recall out of scope)", async () => {
    await expect(
      recall.recallSemantic({ caller_agent_slug: "_operator", query: "x" }),
    ).rejects.toThrow(/_operator/);
  });

  it("throws on query-dim vs stored-dim mismatch (model drift defence)", async () => {
    embedMock.mockResolvedValueOnce({
      embedding: Float32Array.from([1, 0, 0, 0]), // dim 4
      modelId: "voyage-3-lite",
      dim: 4,
      tokensIn: 5,
    });
    await expect(
      recall.recallSemantic({
        caller_agent_slug: "ren",
        query: "x",
        embedding_project_id: alpha,
      }),
    ).rejects.toThrow(/dim/);
  });

  it("returns [] when the agent partition has zero embedded rows", async () => {
    store.clear();
    await seedProject(alpha, ["ren"]);
    await seedExec(alpha, {
      agent: "ren",
      ulid: "01PEND",
      skill: "s",
      startedAt: "2026-05-23T00:00:00.000Z",
      embeddingStatus: "pending",
    });
    // No embedMock call expected — the function short-circuits before
    // reaching Voyage.
    const r = await recall.recallSemantic({
      caller_agent_slug: "ren",
      query: "x",
      embedding_project_id: alpha,
    });
    expect(r).toEqual([]);
    expect(embedMock).not.toHaveBeenCalled();
  });
});

// ─── recall() dispatch surface ────────────────────────────────────────

describe("recall() dispatch", () => {
  it("dispatches to structured when `query` is absent", async () => {
    const alpha = project.asProjectId("alpha");
    await seedProject(alpha, ["ren"]);
    await seedExec(alpha, {
      agent: "ren",
      ulid: "01X",
      skill: "s",
      startedAt: "2026-05-20T00:00:00.000Z",
    });
    const r = await recall.recall({ caller_agent_slug: "ren" });
    expect(r.map((x) => x.row.sk)).toEqual(["EXEC#01X"]);
    expect(embedMock).not.toHaveBeenCalled();
  });

  it("dispatches to semantic when `query` is present", async () => {
    const alpha = project.asProjectId("alpha");
    await seedProject(alpha, ["ren"]);
    await seedExec(alpha, {
      agent: "ren",
      ulid: "01X",
      skill: "s",
      startedAt: "2026-05-20T00:00:00.000Z",
      embedding: Float32Array.from([1, 0, 0]),
    });
    embedMock.mockResolvedValueOnce({
      embedding: Float32Array.from([1, 0, 0]),
      modelId: "voyage-3-lite",
      dim: 3,
      tokensIn: 5,
    });
    const r = await recall.recall({
      caller_agent_slug: "ren",
      query: "x",
      embedding_project_id: alpha,
    });
    expect(r.map((x) => x.row.sk)).toEqual(["EXEC#01X"]);
    expect(embedMock).toHaveBeenCalledOnce();
  });
});

// Silence the unused-helper warning when the imports change shape.
void unitVec;
