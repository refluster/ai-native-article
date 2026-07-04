// Unit tests for workforce/lambdas/audit/handler.ts.
//
// Covers FU-021 / Issue #146 acceptance criteria (as amended 2026-07-03 —
// the membership concept was removed, so the cross-project-leak signal
// became WfAuditMalformedExecs, its surviving malformed-row half):
//   - WfAuditTruncatedExecs: status=ok rows with empty/missing artifact_ref
//   - WfAuditMalformedExecs: EXEC rows missing project_id/agent_slug/started_at
//   - Daily-clean run returns zero on all signals (the operator's
//     1-week-clean criterion)
//   - Metrics emission via CloudWatch
//
// Pattern modelled on backfill-tasks/handler-tests.ts: in-memory DDB
// behind vi.mock at the SDK module boundary, CloudWatch capture for the
// metric assertions.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.TABLE_NAME = "wf-table-test";
process.env.STAGE = "test";

interface Row {
  pk: string;
  sk: string;
  [k: string]: unknown;
}

// In-memory store + scan filter implementation.
const store = new Map<string, Row>();
const key = (pk: string, sk: string) => `${pk}|${sk}`;

// CloudWatch capture.
type MetricBatch = {
  Namespace: string;
  MetricData: Array<{
    MetricName: string;
    Value: number;
    Dimensions: Array<{ Name: string; Value: string }>;
  }>;
};
const metricBatches: MetricBatch[] = [];

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: class {},
}));

vi.mock("@aws-sdk/lib-dynamodb", () => {
  return {
    DynamoDBDocumentClient: {
      from: () => ({
        send: async (cmd: { _kind: string; input: Record<string, unknown> }) => {
          if (cmd._kind === "scan") {
            const inp = cmd.input as {
              FilterExpression: string;
              ExpressionAttributeValues: Record<string, unknown>;
            };
            const skPrefix = inp.ExpressionAttributeValues[":skPrefix"] as string;
            const cutoff = inp.ExpressionAttributeValues[":cutoff"] as
              | string
              | undefined;
            const items = Array.from(store.values()).filter((r) => {
              if (!r.sk.startsWith(skPrefix)) return false;
              if (cutoff !== undefined) {
                const startedAt = r.started_at as string | undefined;
                if (typeof startedAt !== "string" || startedAt < cutoff) {
                  return false;
                }
              }
              return true;
            });
            return { Items: items };
          }
          throw new Error(`unexpected command kind ${cmd._kind}`);
        },
      }),
    },
    ScanCommand: class {
      _kind = "scan";
      input: Record<string, unknown>;
      constructor(input: Record<string, unknown>) {
        this.input = input;
      }
    },
  };
});

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

// SUT must be imported AFTER the env-var setup + all vi.mock() calls.
const { handler } = await import("./handler.js");

// Recent timestamp helper — well inside the 24h window.
const NOW = new Date();
const recent = (offsetMinutes = 60): string =>
  new Date(NOW.getTime() - offsetMinutes * 60_000).toISOString();
const stale = (): string =>
  new Date(NOW.getTime() - 48 * 3600_000).toISOString();

function seedExec(opts: {
  ulid: string;
  project_id: string;
  agent_slug: string;
  status?: string;
  started_at?: string;
  artifact_ref?: Record<string, unknown>;
}) {
  store.set(key(`PROJECT#${opts.project_id}`, `EXEC#${opts.ulid}`), {
    pk: `PROJECT#${opts.project_id}`,
    sk: `EXEC#${opts.ulid}`,
    project_id: opts.project_id,
    agent_slug: opts.agent_slug,
    status: opts.status ?? "ok",
    started_at: opts.started_at ?? recent(),
    ...(opts.artifact_ref !== undefined ? { artifact_ref: opts.artifact_ref } : {}),
  });
}
function seedRun(opts: { ulid: string; agent_slug: string; started_at?: string }) {
  store.set(key(`AGENT#${opts.agent_slug}`, `RUN#${opts.ulid}`), {
    pk: `AGENT#${opts.agent_slug}`,
    sk: `RUN#${opts.ulid}`,
    status: "ok",
    started_at: opts.started_at ?? recent(),
    output_s3_key: `runs/${opts.agent_slug}/${opts.ulid}/output.txt`,
  });
}
/** Helper to seed a clean, dual-write-consistent EXEC + RUN pair. */
function seedPair(opts: {
  ulid: string;
  project_id: string;
  agent_slug: string;
  artifact_summary?: string;
}) {
  seedExec({
    ulid: opts.ulid,
    project_id: opts.project_id,
    agent_slug: opts.agent_slug,
    artifact_ref: {
      uri: `s3://wf-bucket-test/projects/${opts.project_id}/2026/05/${opts.ulid}/output.txt`,
      summary: opts.artifact_summary ?? "ok",
      content_hash: "0".repeat(64),
      content_type: "text/plain",
      size_bytes: 45,
    },
  });
  seedRun({ ulid: opts.ulid, agent_slug: opts.agent_slug });
}

beforeEach(() => {
  store.clear();
  metricBatches.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("audit handler — clean state", () => {
  it("returns zero findings on a clean fixture (the daily-clean target)", async () => {
    // Three healthy EXEC+RUN pairs in self/{slug} partitions.
    seedPair({ ulid: "01CLEAN1", project_id: "self/ren", agent_slug: "ren" });
    seedPair({ ulid: "01CLEAN2", project_id: "self/yuki", agent_slug: "yuki" });
    seedPair({ ulid: "01CLEAN3", project_id: "self/maya", agent_slug: "maya" });

    const res = await handler();
    expect(res.scanned.exec).toBe(3);
    expect(res.counts).toEqual({
      truncated: 0,
      malformed_exec: 0,
    });
    expect(res.findings).toEqual([]);
  });

  it("emits two Workforce/Audit metrics with Stage dimension and value 0 on a clean run", async () => {
    seedPair({ ulid: "01CLEAN", project_id: "self/ren", agent_slug: "ren" });
    await handler();

    expect(metricBatches).toHaveLength(1);
    const batch = metricBatches[0]!;
    expect(batch.Namespace).toBe("Workforce/Audit");
    const byName = new Map(batch.MetricData.map((m) => [m.MetricName, m.Value]));
    expect(byName.get("WfAuditTruncatedExecs")).toBe(0);
    expect(byName.get("WfAuditMalformedExecs")).toBe(0);
    // Post-C2: WfAuditOrphanExecs is no longer emitted.
    expect(byName.has("WfAuditOrphanExecs")).toBe(false);
    expect(batch.MetricData[0]!.Dimensions).toEqual(
      expect.arrayContaining([{ Name: "Stage", Value: "test" }]),
    );
  });
});

describe("audit handler — truncated executions", () => {
  it("flags an ok-status EXEC with missing artifact_ref", async () => {
    seedExec({
      ulid: "01MISSING",
      project_id: "self/ren",
      agent_slug: "ren",
      status: "ok",
      // no artifact_ref
    });
    seedRun({ ulid: "01MISSING", agent_slug: "ren" });

    const res = await handler();
    expect(res.counts.truncated).toBe(1);
    expect(res.findings[0]).toMatchObject({
      signal: "truncated",
      reason: /artifact_ref missing on status=ok/,
    });
  });

  it("flags an ok-status EXEC with empty summary", async () => {
    seedExec({
      ulid: "01EMPTY",
      project_id: "self/ren",
      agent_slug: "ren",
      status: "ok",
      artifact_ref: { uri: "s3://...", summary: "   ", size_bytes: 10 },
    });
    seedRun({ ulid: "01EMPTY", agent_slug: "ren" });

    const res = await handler();
    expect(res.counts.truncated).toBe(1);
    expect(res.findings[0]?.reason).toMatch(/empty or size_bytes=0/);
  });

  it("flags an ok-status EXEC with size_bytes=0 (legitimately empty body)", async () => {
    seedExec({
      ulid: "01ZERO",
      project_id: "self/ren",
      agent_slug: "ren",
      status: "ok",
      artifact_ref: { uri: "s3://...", summary: "synopsis", size_bytes: 0 },
    });
    seedRun({ ulid: "01ZERO", agent_slug: "ren" });

    const res = await handler();
    expect(res.counts.truncated).toBe(1);
  });

  it("ignores status=throw rows with no artifact_ref (failure path; not a truncation)", async () => {
    seedExec({
      ulid: "01THROW",
      project_id: "self/ren",
      agent_slug: "ren",
      status: "throw",
      // no artifact_ref — fine; the run threw before writing
    });
    seedRun({ ulid: "01THROW", agent_slug: "ren" });

    const res = await handler();
    expect(res.counts.truncated).toBe(0);
  });
});

// Epic-010 C2 cutover: the orphan-row describe block was removed.
// The signal is universal noise post-cutover (success paths write
// EXEC only; failure paths write RUN only) — see the audit handler's
// file-level header for the full rationale.

describe("audit handler — stale rows outside the 24h window", () => {
  it("does NOT count stale rows in the scan", async () => {
    seedExec({
      ulid: "01STALE",
      project_id: "self/ren",
      agent_slug: "ren",
      started_at: stale(),
      artifact_ref: { uri: "s3://...", summary: "ok", size_bytes: 1 },
    });
    seedPair({ ulid: "01FRESH", project_id: "self/ren", agent_slug: "ren" });

    const res = await handler();
    // Only the fresh row is scanned; the stale row is filtered by the
    // cutoff condition.
    expect(res.scanned.exec).toBe(1);
    expect(res.counts.truncated).toBe(0);
    expect(res.counts.malformed_exec).toBe(0);
  });
});

describe("audit handler — malformed EXEC rows", () => {
  it("does NOT flag a well-formed EXEC by any agent on any project (membership removed)", async () => {
    // ren writes on workforce-meta with no roster row anywhere — fine:
    // every registered agent participates in every project (2026-07-03).
    seedExec({
      ulid: "01ANY",
      project_id: "workforce-meta",
      agent_slug: "ren",
      artifact_ref: { uri: "s3://...", summary: "ok", size_bytes: 1 },
    });
    seedRun({ ulid: "01ANY", agent_slug: "ren" });

    const res = await handler();
    expect(res.counts.malformed_exec).toBe(0);
  });

  it("flags a malformed EXEC row (missing project_id/agent_slug)", async () => {
    // Pre-FU-NEW-C-class drift: an EXEC row missing canonical attrs.
    store.set(key("PROJECT#workforce-meta", "EXEC#01MALFORMED"), {
      pk: "PROJECT#workforce-meta",
      sk: "EXEC#01MALFORMED",
      // no project_id, no agent_slug — but we still need started_at to
      // pass the cutoff filter
      started_at: recent(),
      status: "ok",
      artifact_ref: { uri: "s3://...", summary: "ok", size_bytes: 1 },
    });

    const res = await handler();
    expect(res.counts.malformed_exec).toBe(1);
    const finding = res.findings.find((f) => f.signal === "malformed_exec");
    expect(finding?.reason).toMatch(/malformed exec row/);
  });
});

describe("audit handler — composite scenarios", () => {
  it("counts multiple distinct findings across signals in one run", async () => {
    // Clean pair (no findings).
    seedPair({ ulid: "01CLEAN", project_id: "self/ren", agent_slug: "ren" });
    // Truncated.
    seedExec({
      ulid: "01TRUNC",
      project_id: "self/ren",
      agent_slug: "ren",
      status: "ok",
    });
    // Malformed row.
    store.set(key("PROJECT#workforce-meta", "EXEC#01MALFORMED"), {
      pk: "PROJECT#workforce-meta",
      sk: "EXEC#01MALFORMED",
      started_at: recent(),
      status: "ok",
      artifact_ref: { uri: "s3://...", summary: "ok", size_bytes: 1 },
    });

    const res = await handler();
    expect(res.counts.truncated).toBe(1);
    expect(res.counts.malformed_exec).toBe(1);

    const batch = metricBatches[0]!;
    const byName = new Map(batch.MetricData.map((m) => [m.MetricName, m.Value]));
    expect(byName.get("WfAuditTruncatedExecs")).toBe(1);
    expect(byName.get("WfAuditMalformedExecs")).toBe(1);
    // Post-C2: WfAuditOrphanExecs no longer emitted.
    expect(byName.has("WfAuditOrphanExecs")).toBe(false);
  });
});
