// Unit tests for shared/embedding-retry.ts (#573 — the retry sweep
// exec-embedding.ts's own header comment named as future work).

import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.TABLE_NAME = "wf-table-test";

const sendMock = vi.fn();
vi.mock("@aws-sdk/client-dynamodb", () => ({ DynamoDBClient: class {} }));
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: () => ({ send: sendMock }) },
  UpdateCommand: class {
    input: {
      Key: { pk: string; sk: string };
      UpdateExpression: string;
      ExpressionAttributeValues: Record<string, unknown>;
    };
    constructor(input: {
      Key: { pk: string; sk: string };
      UpdateExpression: string;
      ExpressionAttributeValues: Record<string, unknown>;
    }) {
      this.input = input;
    }
  },
}));

const queryBySkPrefixPaged = vi.fn();
vi.mock("./ddb.js", () => ({ queryBySkPrefixPaged }));

const embedMock = vi.fn();
vi.mock("./voyage.js", () => ({ embedText: embedMock }));

const project = await import("./project.js");
const {
  sweepPendingEmbeddings,
  deriveRetryEmbeddingText,
  EMBEDDING_RETRY_MAX_ROWS_PER_RUN,
  EMBEDDING_RETRY_MAX_ATTEMPTS,
} = await import("./embedding-retry.js");

function pendingRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    pk: "PROJECT#alpha",
    sk: "EXEC#01ABC",
    project_id: project.asProjectId("alpha"),
    agent_slug: "ren",
    skill_name: "code-task-brief",
    skill_version: "0.1.0",
    started_at: "2026-05-20T00:00:00.000Z",
    ended_at: "2026-05-20T00:00:01.000Z",
    status: "ok",
    used_credential_types: [],
    gsi1pk: "AGENT#ren",
    gsi1sk: "2026-05-20T00:00:00.000Z",
    gsi2pk: "SKILL#code-task-brief",
    gsi2sk: "2026-05-20T00:00:00.000Z",
    embedding_status: "pending",
    ...over,
  };
}

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue({});
  queryBySkPrefixPaged.mockReset();
  embedMock.mockReset();
});

describe("deriveRetryEmbeddingText", () => {
  it("always includes skill_name; omits every absent optional field", () => {
    expect(deriveRetryEmbeddingText(pendingRow() as never)).toBe("skill: code-task-brief");
  });

  it("appends summary, artifact_ref.summary, and error in order when present", () => {
    const text = deriveRetryEmbeddingText(
      pendingRow({
        summary: "shipped a PR",
        artifact_ref: { uri: "s3://x", content_hash: "h", content_type: "t", size_bytes: 1, summary: "PR #1 merged" },
        error: "rate limited once",
      }) as never,
    );
    expect(text).toBe(
      "skill: code-task-brief\nsummary: shipped a PR\noutput: PR #1 merged\nerror: rate limited once",
    );
  });
});

describe("sweepPendingEmbeddings — recovery", () => {
  it("a pending row that re-embeds successfully flips to embedding_status='ok', clears attempts", async () => {
    queryBySkPrefixPaged.mockResolvedValueOnce({ items: [pendingRow()], cursor: undefined });
    embedMock.mockResolvedValueOnce({
      embedding: Float32Array.from([1, 0, 0]),
      modelId: "voyage-3-lite",
      dim: 3,
    });

    const result = await sweepPendingEmbeddings([project.asProjectId("alpha")]);

    expect(result).toEqual({ attempted: 1, recovered: 1, failedTerminal: 0, stillPending: 0 });
    expect(sendMock).toHaveBeenCalledOnce();
    const cmd = sendMock.mock.calls[0]![0] as InstanceType<typeof UpdateCommandLike>;
    expect(cmd.input.Key).toEqual({ pk: "PROJECT#alpha", sk: "EXEC#01ABC" });
    expect(cmd.input.UpdateExpression).toContain("embedding_status = :status");
    expect(cmd.input.UpdateExpression).toContain("REMOVE embedding_attempts");
    expect(cmd.input.ExpressionAttributeValues[":status"]).toBe("ok");
  });
});

describe("sweepPendingEmbeddings — failure below the attempt cap", () => {
  it("increments embedding_attempts, stays pending (no embedding_status write)", async () => {
    queryBySkPrefixPaged.mockResolvedValueOnce({ items: [pendingRow()], cursor: undefined });
    embedMock.mockRejectedValueOnce(new Error("voyage 503"));

    const result = await sweepPendingEmbeddings([project.asProjectId("alpha")]);

    expect(result).toEqual({ attempted: 1, recovered: 0, failedTerminal: 0, stillPending: 1 });
    const cmd = sendMock.mock.calls[0]![0] as InstanceType<typeof UpdateCommandLike>;
    expect(cmd.input.UpdateExpression).toBe("SET embedding_attempts = :attempts");
    expect(cmd.input.ExpressionAttributeValues[":attempts"]).toBe(1);
  });

  it("carries a prior attempt count forward (row already tried twice)", async () => {
    queryBySkPrefixPaged.mockResolvedValueOnce({
      items: [pendingRow({ embedding_attempts: 2 })],
      cursor: undefined,
    });
    embedMock.mockRejectedValueOnce(new Error("timeout"));

    await sweepPendingEmbeddings([project.asProjectId("alpha")]);

    const cmd = sendMock.mock.calls[0]![0] as InstanceType<typeof UpdateCommandLike>;
    expect(cmd.input.ExpressionAttributeValues[":attempts"]).toBe(3);
  });
});

describe("sweepPendingEmbeddings — terminal failure at the attempt cap", () => {
  it("moves to embedding_status='failed' once attempts reach EMBEDDING_RETRY_MAX_ATTEMPTS", async () => {
    queryBySkPrefixPaged.mockResolvedValueOnce({
      items: [pendingRow({ embedding_attempts: EMBEDDING_RETRY_MAX_ATTEMPTS - 1 })],
      cursor: undefined,
    });
    embedMock.mockRejectedValueOnce(new Error("voyage.api_key not provisioned"));

    const result = await sweepPendingEmbeddings([project.asProjectId("alpha")]);

    expect(result).toEqual({ attempted: 1, recovered: 0, failedTerminal: 1, stillPending: 0 });
    const cmd = sendMock.mock.calls[0]![0] as InstanceType<typeof UpdateCommandLike>;
    expect(cmd.input.ExpressionAttributeValues[":attempts"]).toBe(EMBEDDING_RETRY_MAX_ATTEMPTS);
    expect(cmd.input.ExpressionAttributeValues[":status"]).toBe("failed");
  });
});

describe("sweepPendingEmbeddings — skips non-pending rows", () => {
  it("never re-embeds rows whose embedding_status is ok / skipped / failed / absent", async () => {
    queryBySkPrefixPaged.mockResolvedValueOnce({
      items: [
        pendingRow({ embedding_status: "ok" }),
        pendingRow({ embedding_status: "skipped" }),
        pendingRow({ embedding_status: "failed" }),
        pendingRow({ embedding_status: undefined }),
      ],
      cursor: undefined,
    });

    const result = await sweepPendingEmbeddings([project.asProjectId("alpha")]);

    expect(result).toEqual({ attempted: 0, recovered: 0, failedTerminal: 0, stillPending: 0 });
    expect(embedMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("sweepPendingEmbeddings — bounded per-run cost", () => {
  it("drains multiple pages within a project via the returned cursor", async () => {
    queryBySkPrefixPaged
      .mockResolvedValueOnce({ items: [pendingRow({ sk: "EXEC#1" })], cursor: "next" })
      .mockResolvedValueOnce({ items: [pendingRow({ sk: "EXEC#2" })], cursor: undefined });
    embedMock.mockResolvedValue({ embedding: Float32Array.from([1, 0, 0]), modelId: "voyage-3-lite", dim: 3 });

    const result = await sweepPendingEmbeddings([project.asProjectId("alpha")]);

    expect(queryBySkPrefixPaged).toHaveBeenCalledTimes(2);
    expect(result.attempted).toBe(2);
  });

  it("stops at EMBEDDING_RETRY_MAX_ROWS_PER_RUN even with more pending rows available", async () => {
    const manyRows = Array.from({ length: EMBEDDING_RETRY_MAX_ROWS_PER_RUN + 10 }, (_, i) =>
      pendingRow({ sk: `EXEC#${i}` }),
    );
    queryBySkPrefixPaged.mockResolvedValueOnce({ items: manyRows, cursor: undefined });
    embedMock.mockResolvedValue({ embedding: Float32Array.from([1, 0, 0]), modelId: "voyage-3-lite", dim: 3 });

    const result = await sweepPendingEmbeddings([project.asProjectId("alpha")]);

    expect(result.attempted).toBe(EMBEDDING_RETRY_MAX_ROWS_PER_RUN);
    expect(embedMock).toHaveBeenCalledTimes(EMBEDDING_RETRY_MAX_ROWS_PER_RUN);
  });

  it("never queries a second project once the run-wide cap is already hit", async () => {
    const manyRows = Array.from({ length: EMBEDDING_RETRY_MAX_ROWS_PER_RUN }, (_, i) =>
      pendingRow({ sk: `EXEC#${i}` }),
    );
    queryBySkPrefixPaged.mockResolvedValueOnce({ items: manyRows, cursor: undefined });
    embedMock.mockResolvedValue({ embedding: Float32Array.from([1, 0, 0]), modelId: "voyage-3-lite", dim: 3 });

    await sweepPendingEmbeddings([project.asProjectId("alpha"), project.asProjectId("beta")]);

    // Only alpha's partition was ever queried — beta is never reached.
    expect(queryBySkPrefixPaged).toHaveBeenCalledTimes(1);
  });
});

// Type-only helper so the cast above reads cleanly without `any`.
class UpdateCommandLike {
  input!: {
    Key: { pk: string; sk: string };
    UpdateExpression: string;
    ExpressionAttributeValues: Record<string, unknown>;
  };
}
