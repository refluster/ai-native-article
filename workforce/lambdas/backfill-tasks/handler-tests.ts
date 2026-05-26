// Unit tests for workforce/lambdas/backfill-tasks/handler.ts.
//
// Covers the Story 1 (#90) acceptance criteria for the backfill Lambda:
//   - Idempotent (replayable): re-running over a backfilled row is a no-op
//   - Emits a CloudWatch metric for rows touched
//   - Skips rows that have no `agent_slug` (can't derive self/{slug})
//   - Counts already-backfilled rows separately so operator can see
//     "this run was a no-op" via the metric / log
//
// The DDB layer is mocked via vi.mock on the SDK module surface so we
// can simulate Scan paging + the ConditionalCheckFailedException race.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.TABLE_NAME = "wf-table-test";
process.env.STAGE = "test";

interface Row {
  pk: string;
  sk: string;
  agent_slug?: string;
  project_id?: string;
  backfilled_at?: string;
}

// In-memory DDB
const store = new Map<string, Row>();
const key = (pk: string, sk: string) => `${pk}|${sk}`;

// CloudWatch capture
type MetricBatch = {
  Namespace: string;
  MetricData: Array<{ MetricName: string; Value: number }>;
};
const metricBatches: MetricBatch[] = [];

// Mock fakes (declared at module scope so handler.ts picks them up via
// the SDK exports).
const sendCalls: unknown[] = [];

class FakeConditionalCheckFailedException extends Error {
  override name = "ConditionalCheckFailedException";
  constructor() {
    super("conditional check failed");
  }
}

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: class {},
  ConditionalCheckFailedException: FakeConditionalCheckFailedException,
}));

vi.mock("@aws-sdk/lib-dynamodb", () => {
  return {
    DynamoDBDocumentClient: {
      from: () => ({
        send: async (cmd: { _kind: string; input: Record<string, unknown> }) => {
          sendCalls.push(cmd);
          if (cmd._kind === "scan") {
            const items = Array.from(store.values()).filter(
              (r) => r.pk.startsWith("TASK#") && r.sk === "META",
            );
            return { Items: items };
          }
          if (cmd._kind === "update") {
            const { Key, ExpressionAttributeValues } = cmd.input as {
              Key: { pk: string; sk: string };
              ExpressionAttributeValues: { ":pid": string; ":now": string };
            };
            const row = store.get(key(Key.pk, Key.sk));
            if (!row) throw new Error(`no row at ${Key.pk}/${Key.sk}`);
            if (typeof row.project_id === "string" && row.project_id.length > 0) {
              throw new FakeConditionalCheckFailedException();
            }
            row.project_id = ExpressionAttributeValues[":pid"];
            row.backfilled_at = ExpressionAttributeValues[":now"];
            return {};
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
    UpdateCommand: class {
      _kind = "update";
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

const { handler } = await import("./handler.js");

beforeEach(() => {
  store.clear();
  metricBatches.length = 0;
  sendCalls.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("backfill-tasks handler", () => {
  it("fills project_id with self/{agent_slug} when missing", async () => {
    store.set(key("TASK#01A", "META"), { pk: "TASK#01A", sk: "META", agent_slug: "ren" });
    store.set(key("TASK#01B", "META"), { pk: "TASK#01B", sk: "META", agent_slug: "maya" });

    const result = await handler();
    expect(result.scanned).toBe(2);
    expect(result.backfilled).toBe(2);
    expect(result.already_backfilled).toBe(0);
    expect(result.errors).toEqual([]);
    expect(store.get(key("TASK#01A", "META"))?.project_id).toBe("self/ren");
    expect(store.get(key("TASK#01B", "META"))?.project_id).toBe("self/maya");
  });

  it("is idempotent — re-running over filled rows is a no-op (already_backfilled count)", async () => {
    store.set(key("TASK#01A", "META"), {
      pk: "TASK#01A",
      sk: "META",
      agent_slug: "ren",
      project_id: "self/ren",
    });

    const result = await handler();
    expect(result.scanned).toBe(1);
    expect(result.backfilled).toBe(0);
    expect(result.already_backfilled).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it("skips rows missing agent_slug (can't derive self/{slug})", async () => {
    store.set(key("TASK#01A", "META"), { pk: "TASK#01A", sk: "META" });

    const result = await handler();
    expect(result.scanned).toBe(1);
    expect(result.backfilled).toBe(0);
    expect(result.skipped_missing_agent_slug).toBe(1);
  });

  it("treats ConditionalCheckFailedException as already_backfilled (concurrent-run safety)", async () => {
    // Pre-fill the row in the store so the UpdateCommand-with-condition
    // raises the fake CCF inside the mock.
    store.set(key("TASK#01A", "META"), {
      pk: "TASK#01A",
      sk: "META",
      agent_slug: "ren",
      project_id: "already-set-by-other-run",
    });

    const result = await handler();
    expect(result.scanned).toBe(1);
    expect(result.backfilled).toBe(0);
    expect(result.already_backfilled).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it("emits CloudWatch metrics (WfBackfilledTaskRows / WfAlreadyBackfilledTaskRows / WfBackfillErrors)", async () => {
    store.set(key("TASK#01A", "META"), { pk: "TASK#01A", sk: "META", agent_slug: "ren" });
    store.set(key("TASK#01B", "META"), {
      pk: "TASK#01B",
      sk: "META",
      agent_slug: "maya",
      project_id: "self/maya",
    });

    await handler();
    expect(metricBatches).toHaveLength(1);
    const batch = metricBatches[0]!;
    expect(batch.Namespace).toBe("Workforce/Backfill");
    const names = batch.MetricData.map((m) => m.MetricName).sort();
    expect(names).toEqual([
      "WfAlreadyBackfilledTaskRows",
      "WfBackfillErrors",
      "WfBackfilledTaskRows",
    ]);
    const byName = new Map(batch.MetricData.map((m) => [m.MetricName, m.Value]));
    expect(byName.get("WfBackfilledTaskRows")).toBe(1);
    expect(byName.get("WfAlreadyBackfilledTaskRows")).toBe(1);
    expect(byName.get("WfBackfillErrors")).toBe(0);
  });

  it("ignores non-TASK rows in the scan", async () => {
    store.set(key("AGENT#ren", "META"), { pk: "AGENT#ren", sk: "META", agent_slug: "ren" });
    store.set(key("TASK#01A", "META"), { pk: "TASK#01A", sk: "META", agent_slug: "ren" });

    const result = await handler();
    expect(result.scanned).toBe(1);
    expect(result.backfilled).toBe(1);
  });
});
