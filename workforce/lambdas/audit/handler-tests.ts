// Unit tests for workforce/lambdas/audit/handler.ts.
//
// Covers FU-021 / Issue #146 acceptance criteria:
//   - WfAuditTruncatedExecs: status=ok rows with empty/missing artifact_ref
//   - WfAuditOrphanExecs: EXEC<->RUN dual-write witnesses (both directions)
//   - WfAuditCrossProjectLeaks: EXEC where agent wasn't an active member
//     at started_at; implicit-membership rules for _operator + self/{slug}
//   - Daily-clean run returns zero on all three signals (the operator's
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
function seedMember(opts: {
  project_id: string;
  agent_slug: string;
  joined_at?: string;
  revoked_at?: string;
}) {
  store.set(key(`PROJECT#${opts.project_id}`, `MEMBER#${opts.agent_slug}`), {
    pk: `PROJECT#${opts.project_id}`,
    sk: `MEMBER#${opts.agent_slug}`,
    agent_slug: opts.agent_slug,
    joined_at: opts.joined_at ?? recent(60 * 24 * 30),
    ...(opts.revoked_at !== undefined ? { revoked_at: opts.revoked_at } : {}),
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
    expect(res.scanned.run).toBe(3);
    expect(res.counts).toEqual({
      truncated: 0,
      orphan_exec: 0,
      orphan_run: 0,
      cross_project_leak: 0,
    });
    expect(res.findings).toEqual([]);
  });

  it("emits three Workforce/Audit metrics with Stage dimension and value 0 on a clean run", async () => {
    seedPair({ ulid: "01CLEAN", project_id: "self/ren", agent_slug: "ren" });
    await handler();

    expect(metricBatches).toHaveLength(1);
    const batch = metricBatches[0]!;
    expect(batch.Namespace).toBe("Workforce/Audit");
    const byName = new Map(batch.MetricData.map((m) => [m.MetricName, m.Value]));
    expect(byName.get("WfAuditTruncatedExecs")).toBe(0);
    expect(byName.get("WfAuditOrphanExecs")).toBe(0);
    expect(byName.get("WfAuditCrossProjectLeaks")).toBe(0);
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

describe("audit handler — orphan exec / run rows", () => {
  it("flags an EXEC without a matching RUN sibling", async () => {
    seedExec({
      ulid: "01EXECONLY",
      project_id: "self/ren",
      agent_slug: "ren",
      artifact_ref: { uri: "s3://...", summary: "ok", size_bytes: 1 },
    });

    const res = await handler();
    expect(res.counts.orphan_exec).toBe(1);
    expect(res.findings[0]).toMatchObject({
      signal: "orphan_exec",
      sk: "EXEC#01EXECONLY",
    });
  });

  it("flags a RUN without a matching EXEC sibling", async () => {
    seedRun({ ulid: "01RUNONLY", agent_slug: "ren" });

    const res = await handler();
    expect(res.counts.orphan_run).toBe(1);
    expect(res.findings[0]).toMatchObject({
      signal: "orphan_run",
      sk: "RUN#01RUNONLY",
    });
  });

  it("does NOT flag a stale RUN / EXEC outside the 24h window", async () => {
    seedExec({
      ulid: "01STALE",
      project_id: "self/ren",
      agent_slug: "ren",
      started_at: stale(),
      artifact_ref: { uri: "s3://...", summary: "ok", size_bytes: 1 },
    });
    seedRun({ ulid: "01STALE", agent_slug: "ren", started_at: stale() });
    // Plus one recent clean pair so we have something in scan.
    seedPair({ ulid: "01FRESH", project_id: "self/ren", agent_slug: "ren" });

    const res = await handler();
    expect(res.scanned.exec).toBe(1);
    expect(res.scanned.run).toBe(1);
    expect(res.counts.orphan_exec).toBe(0);
    expect(res.counts.orphan_run).toBe(0);
  });
});

describe("audit handler — cross-project leakage", () => {
  it("flags an EXEC where the agent was NOT an active member of the project at started_at", async () => {
    // ren wrote an EXEC under workforce-meta, but is NOT a member.
    seedExec({
      ulid: "01LEAK",
      project_id: "workforce-meta",
      agent_slug: "ren",
      artifact_ref: { uri: "s3://...", summary: "ok", size_bytes: 1 },
    });
    seedRun({ ulid: "01LEAK", agent_slug: "ren" });
    // No MEMBER#ren under PROJECT#workforce-meta.

    const res = await handler();
    expect(res.counts.cross_project_leak).toBe(1);
    expect(res.findings.find((f) => f.signal === "cross_project_leak")?.reason).toMatch(
      /not an active member of workforce-meta/,
    );
  });

  it("does NOT flag an EXEC where the member row exists + revoked_at is unset", async () => {
    seedMember({ project_id: "workforce-meta", agent_slug: "ren" });
    seedExec({
      ulid: "01OK",
      project_id: "workforce-meta",
      agent_slug: "ren",
      artifact_ref: { uri: "s3://...", summary: "ok", size_bytes: 1 },
    });
    seedRun({ ulid: "01OK", agent_slug: "ren" });

    const res = await handler();
    expect(res.counts.cross_project_leak).toBe(0);
  });

  it("flags an EXEC whose started_at is AFTER the agent's revoked_at", async () => {
    seedMember({
      project_id: "workforce-meta",
      agent_slug: "ren",
      joined_at: stale(),
      revoked_at: stale(), // revoked at -48h, exec at -1h → revoked BEFORE exec
    });
    seedExec({
      ulid: "01POSTREVOKE",
      project_id: "workforce-meta",
      agent_slug: "ren",
      artifact_ref: { uri: "s3://...", summary: "ok", size_bytes: 1 },
    });
    seedRun({ ulid: "01POSTREVOKE", agent_slug: "ren" });

    const res = await handler();
    expect(res.counts.cross_project_leak).toBe(1);
  });

  it("treats _operator as implicit-member everywhere (credentials-api auto-add race)", async () => {
    seedExec({
      ulid: "01OPERATOR",
      project_id: "workforce-meta",
      agent_slug: "_operator",
      artifact_ref: { uri: "s3://...", summary: "ok", size_bytes: 1 },
    });
    seedRun({ ulid: "01OPERATOR", agent_slug: "_operator" });
    // No MEMBER#_operator row — should still pass.

    const res = await handler();
    expect(res.counts.cross_project_leak).toBe(0);
  });

  it("treats agent X as implicit-member of project self/X", async () => {
    seedExec({
      ulid: "01SELF",
      project_id: "self/ren",
      agent_slug: "ren",
      artifact_ref: { uri: "s3://...", summary: "ok", size_bytes: 1 },
    });
    seedRun({ ulid: "01SELF", agent_slug: "ren" });
    // No MEMBER#ren under PROJECT#self/ren — should still pass.

    const res = await handler();
    expect(res.counts.cross_project_leak).toBe(0);
  });

  it("flags a malformed EXEC row (missing project_id) as a leak finding", async () => {
    // Pre-FU-NEW-C-class drift: an EXEC row missing canonical attrs.
    store.set(key("PROJECT#workforce-meta", "EXEC#01MALFORMED"), {
      pk: "PROJECT#workforce-meta",
      sk: "EXEC#01MALFORMED",
      // no project_id, no agent_slug, no started_at — but we still
      // need started_at to pass the cutoff filter
      started_at: recent(),
      status: "ok",
      artifact_ref: { uri: "s3://...", summary: "ok", size_bytes: 1 },
    });

    const res = await handler();
    expect(res.counts.cross_project_leak).toBe(1);
    const leak = res.findings.find((f) => f.signal === "cross_project_leak");
    expect(leak?.reason).toMatch(/malformed exec row/);
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
    seedRun({ ulid: "01TRUNC", agent_slug: "ren" });
    // Orphan EXEC.
    seedExec({
      ulid: "01ORPHANE",
      project_id: "self/ren",
      agent_slug: "ren",
      artifact_ref: { uri: "s3://...", summary: "ok", size_bytes: 1 },
    });
    // Orphan RUN.
    seedRun({ ulid: "01ORPHANR", agent_slug: "ren" });
    // Cross-project leak.
    seedExec({
      ulid: "01LEAK",
      project_id: "workforce-meta",
      agent_slug: "ren",
      artifact_ref: { uri: "s3://...", summary: "ok", size_bytes: 1 },
    });
    seedRun({ ulid: "01LEAK", agent_slug: "ren" });

    const res = await handler();
    expect(res.counts.truncated).toBe(1);
    expect(res.counts.orphan_exec).toBe(1);
    expect(res.counts.orphan_run).toBe(1);
    expect(res.counts.cross_project_leak).toBe(1);

    // Combined orphan metric (truncated + orphan_run summed):
    const batch = metricBatches[0]!;
    const byName = new Map(batch.MetricData.map((m) => [m.MetricName, m.Value]));
    expect(byName.get("WfAuditOrphanExecs")).toBe(2); // 1 exec-orphan + 1 run-orphan
  });
});
