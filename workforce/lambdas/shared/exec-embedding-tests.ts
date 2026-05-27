// Unit tests for workforce/lambdas/shared/exec-embedding.ts.
//
// Covers the in-scope #93 acceptance criteria:
//
//   AC3 — Embedding model metadata (`model_id`, `dim`) is written next to
//         every vector so re-embedding on a model change is a query.
//
//   AC4 — When `voyage-3-lite` API fails, the execution itself still
//         succeeds; the EXEC row carries `embedding_status='pending'`.
//
//   Plus the skip path (empty text → status='skipped' without a Voyage
//   call) and the cross-project denial path (the wrapper does NOT mask
//   the membership gate that appendExecution enforces).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectId } from "./project.js";

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
    if (store.get(key(item.pk as string, item.sk as string))) {
      const err = new Error("conditional check failed");
      err.name = "ConditionalCheckFailedException";
      throw err;
    }
    store.set(key(item.pk as string, item.sk as string), { ...item });
  }),
  deleteItem: vi.fn(async () => {}),
  queryBySkPrefix: vi.fn(async () => []),
  queryByGsi: vi.fn(async () => []),
}));

vi.mock("./secrets.js", () => ({
  getSecret: vi.fn(),
}));

// CloudWatch mock — capture metrics but never fail.
const metricBatches: Array<{ MetricData: Array<{ MetricName: string }> }> = [];
vi.mock("@aws-sdk/client-cloudwatch", () => ({
  CloudWatchClient: class {
    async send(cmd: {
      input: { MetricData: Array<{ MetricName: string }> };
    }) {
      metricBatches.push(cmd.input);
    }
  },
  PutMetricDataCommand: class {
    input: { MetricData: Array<{ MetricName: string }> };
    constructor(input: { MetricData: Array<{ MetricName: string }> }) {
      this.input = input;
    }
  },
}));

// Voyage mock — caller drives the result per test.
const embedMock = vi.fn();
vi.mock("./voyage.js", () => ({
  embedText: embedMock,
  VOYAGE_MODEL_ID: "voyage-3-lite",
  VOYAGE_DIM: 3,
}));

const project = await import("./project.js");
const execEmbedding = await import("./exec-embedding.js");

async function flushMetrics(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  store.clear();
  embedMock.mockReset();
  metricBatches.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("appendExecutionWithEmbedding — happy path (AC3)", () => {
  it("computes embedding, stores model_id + dim + bytes, status='ok'", async () => {
    const alpha = project.asProjectId("alpha");
    await project.create({ project_id: alpha, owner_agent: "_operator" });
    await project.addMember(alpha, "ren");

    embedMock.mockResolvedValueOnce({
      embedding: Float32Array.from([1, 0, 0]),
      modelId: "voyage-3-lite",
      dim: 3,
      tokensIn: 5,
    });

    const row = await execEmbedding.appendExecutionWithEmbedding({
      project_id: alpha,
      agent_slug: "ren",
      exec_ulid: "01OK",
      skill_name: "code-task-brief",
      skill_version: "0.1.0",
      started_at: "2026-05-20T00:00:00.000Z",
      ended_at: "2026-05-20T00:00:01.000Z",
      status: "ok",
      embedding_text: "skill: code-task-brief\nresult: shipped a PR",
    });

    expect(row.embedding_status).toBe("ok");
    expect(row.embedding_model_id).toBe("voyage-3-lite");
    expect(row.embedding_dim).toBe(3);
    expect(row.embedding_bytes).toBeInstanceOf(Uint8Array);
    expect(row.embedding_bytes!.byteLength).toBe(12);
    expect(embedMock).toHaveBeenCalledOnce();
    expect(embedMock).toHaveBeenCalledWith({
      projectId: alpha,
      text: "skill: code-task-brief\nresult: shipped a PR",
      inputType: "document",
    });
  });
});

describe("appendExecutionWithEmbedding — failure isolation (AC4)", () => {
  it("Voyage API throws → row STILL lands with embedding_status='pending'", async () => {
    const alpha = project.asProjectId("alpha");
    await project.create({ project_id: alpha, owner_agent: "_operator" });
    await project.addMember(alpha, "ren");

    embedMock.mockRejectedValueOnce(new Error("voyage 503: upstream timeout"));

    const row = await execEmbedding.appendExecutionWithEmbedding({
      project_id: alpha,
      agent_slug: "ren",
      exec_ulid: "01PEND",
      skill_name: "code-task-brief",
      skill_version: "0.1.0",
      started_at: "2026-05-20T00:00:00.000Z",
      ended_at: "2026-05-20T00:00:01.000Z",
      status: "ok",
      embedding_text: "skill: code-task-brief",
    });

    // The exec row landed (AC4) — its own status is 'ok', the embedding
    // sidecar carries 'pending'.
    expect(row.status).toBe("ok");
    expect(row.embedding_status).toBe("pending");
    expect(row.embedding_bytes).toBeUndefined();
    expect(row.embedding_model_id).toBeUndefined();
    expect(row.embedding_dim).toBeUndefined();

    // The DDB write happened.
    expect(store.get("PROJECT#alpha|EXEC#01PEND")).toBeDefined();

    // A WfExecEmbeddingFailed metric was emitted (operator signal that
    // the retry queue has work pending).
    await flushMetrics();
    expect(metricBatches).toHaveLength(1);
    expect(metricBatches[0]!.MetricData[0]!.MetricName).toBe(
      "WfExecEmbeddingFailed",
    );
  });

  it("missing voyage.api_key (ResourceNotFoundException) → same pending fallback", async () => {
    const alpha = project.asProjectId("alpha");
    await project.create({ project_id: alpha, owner_agent: "_operator" });
    await project.addMember(alpha, "ren");

    const err = new Error("Secrets Manager: no such secret");
    err.name = "ResourceNotFoundException";
    embedMock.mockRejectedValueOnce(err);

    const row = await execEmbedding.appendExecutionWithEmbedding({
      project_id: alpha,
      agent_slug: "ren",
      exec_ulid: "01NOKEY",
      skill_name: "s",
      skill_version: "0.1.0",
      started_at: "2026-05-20T00:00:00.000Z",
      ended_at: "2026-05-20T00:00:01.000Z",
      status: "ok",
      embedding_text: "a",
    });

    expect(row.embedding_status).toBe("pending");
    expect(store.get("PROJECT#alpha|EXEC#01NOKEY")).toBeDefined();
  });

  it("cross-project denial is NOT masked — appendExecution still throws + no spurious embedding-failed metric", async () => {
    const alpha = project.asProjectId("alpha");
    await project.create({ project_id: alpha, owner_agent: "_operator" });
    // ren is NOT a member of alpha.

    embedMock.mockResolvedValueOnce({
      embedding: Float32Array.from([1, 0, 0]),
      modelId: "voyage-3-lite",
      dim: 3,
      tokensIn: 5,
    });

    await expect(
      execEmbedding.appendExecutionWithEmbedding({
        project_id: alpha,
        agent_slug: "ren",
        exec_ulid: "01X",
        skill_name: "s",
        skill_version: "0.1.0",
        started_at: "2026-05-20T00:00:00.000Z",
        ended_at: "2026-05-20T00:00:01.000Z",
        status: "ok",
        embedding_text: "anything",
      }),
    ).rejects.toThrow(/cross-project denial/);

    // The embedding step DID succeed (Voyage returned a vector); the
    // cross-project denial fires inside appendExecution. The denial must
    // propagate, NOT get silently re-classified as an embedding failure
    // (that would emit a misleading WfExecEmbeddingFailed metric and
    // hide a W-2 trust-boundary violation in the retry queue).
    await flushMetrics();
    expect(metricBatches).toHaveLength(0);
  });
});

describe("appendExecutionWithEmbedding — skip path", () => {
  it("empty embedding_text → status='skipped', no Voyage call", async () => {
    const alpha = project.asProjectId("alpha");
    await project.create({ project_id: alpha, owner_agent: "_operator" });
    await project.addMember(alpha, "ren");

    const row = await execEmbedding.appendExecutionWithEmbedding({
      project_id: alpha,
      agent_slug: "ren",
      exec_ulid: "01SKIP",
      skill_name: "s",
      skill_version: "0.1.0",
      started_at: "2026-05-20T00:00:00.000Z",
      ended_at: "2026-05-20T00:00:01.000Z",
      status: "ok",
      embedding_text: "   \n\t  ",
    });

    expect(row.embedding_status).toBe("skipped");
    expect(row.embedding_bytes).toBeUndefined();
    expect(embedMock).not.toHaveBeenCalled();
  });
});
