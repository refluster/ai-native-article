// Unit tests for workforce/lambdas/backfill-tasks/handler.ts.
// FU-008: standardised to aws-sdk-client-mock; replaces hand-rolled vi.mock factories.
//
// Covers the Story 1 (#90) acceptance criteria for the backfill Lambda:
//   - Idempotent (replayable): re-running over a backfilled row is a no-op
//   - Emits a CloudWatch metric for rows touched
//   - Skips rows that have no `agent_slug` (can't derive self/{slug})
//   - Counts already-backfilled rows separately so operator can see
//     "this run was a no-op" via the metric / log
//   - Correctly classifies a DDB ConditionalCheckFailedException (concurrent-run
//     race) as already_backfilled rather than an error

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";

// W-4 fail-loud: TABLE_NAME must be set before the handler module is
// imported (the module throws at load time if the var is absent).
process.env.TABLE_NAME = "wf-table-test";
process.env.STAGE = "test";

// Set up mocks BEFORE importing the handler so the module-level singleton
// clients (DynamoDBDocumentClient.from() / new CloudWatchClient()) inherit
// the patched send() prototype.
const ddbMock = mockClient(DynamoDBDocumentClient);
const cwMock = mockClient(CloudWatchClient);

const { handler } = await import("./handler.js");

beforeEach(() => {
  ddbMock.reset();
  cwMock.reset();
  // CloudWatch emission is best-effort; resolve silently by default so each
  // test only needs to declare mock responses for DDB behaviour.
  cwMock.on(PutMetricDataCommand).resolves({});
});

afterEach(() => {
  // mock state is cleared in the next beforeEach; nothing to do here.
});

// Return the PutMetricDataCommand input captured by the CW mock (first call).
function capturedMetrics() {
  const calls = cwMock.commandCalls(PutMetricDataCommand);
  return calls[0]?.args[0]?.input;
}

describe("backfill-tasks handler", () => {
  it("fills project_id with self/{agent_slug} when missing", async () => {
    ddbMock.on(ScanCommand).resolvesOnce({
      Items: [
        { pk: "TASK#01A", sk: "META", agent_slug: "ren" },
        { pk: "TASK#01B", sk: "META", agent_slug: "maya" },
      ],
    });
    ddbMock.on(UpdateCommand).resolves({});

    const result = await handler();

    expect(result.scanned).toBe(2);
    expect(result.backfilled).toBe(2);
    expect(result.already_backfilled).toBe(0);
    expect(result.errors).toEqual([]);

    // Verify the correct project_id values were written.
    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls).toHaveLength(2);
    const writtenPids = updateCalls.map(
      (c) => (c.args[0].input.ExpressionAttributeValues as Record<string, string>)[":pid"],
    );
    expect(writtenPids).toContain("self/ren");
    expect(writtenPids).toContain("self/maya");
  });

  it("is idempotent — re-running over filled rows is a no-op (already_backfilled count)", async () => {
    // Scan returns a row whose project_id is already populated; the handler
    // short-circuits before issuing UpdateCommand.
    ddbMock.on(ScanCommand).resolvesOnce({
      Items: [{ pk: "TASK#01A", sk: "META", agent_slug: "ren", project_id: "self/ren" }],
    });

    const result = await handler();

    expect(result.scanned).toBe(1);
    expect(result.backfilled).toBe(0);
    expect(result.already_backfilled).toBe(1);
    expect(result.errors).toEqual([]);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it("skips rows missing agent_slug (can't derive self/{slug})", async () => {
    ddbMock.on(ScanCommand).resolvesOnce({
      Items: [{ pk: "TASK#01A", sk: "META" }],
    });

    const result = await handler();

    expect(result.scanned).toBe(1);
    expect(result.backfilled).toBe(0);
    expect(result.skipped_missing_agent_slug).toBe(1);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it("treats ConditionalCheckFailedException as already_backfilled (concurrent-run safety)", async () => {
    // Scan returns a row WITHOUT project_id (the concurrent run hasn't written
    // yet from this scan's perspective). UpdateItem then throws CCF because
    // the concurrent run wrote between the scan and the conditional update —
    // the exact race the ConditionExpression guards against.
    ddbMock.on(ScanCommand).resolvesOnce({
      Items: [{ pk: "TASK#01A", sk: "META", agent_slug: "ren" }],
    });
    ddbMock.on(UpdateCommand).rejectsOnce(
      new ConditionalCheckFailedException({
        message: "conditional check failed",
        $metadata: { httpStatusCode: 400 },
      }),
    );

    const result = await handler();

    expect(result.scanned).toBe(1);
    expect(result.backfilled).toBe(0);
    expect(result.already_backfilled).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it("emits CloudWatch metrics (WfBackfilledTaskRows / WfAlreadyBackfilledTaskRows / WfBackfillErrors)", async () => {
    ddbMock.on(ScanCommand).resolvesOnce({
      Items: [
        { pk: "TASK#01A", sk: "META", agent_slug: "ren" },
        { pk: "TASK#01B", sk: "META", agent_slug: "maya", project_id: "self/maya" },
      ],
    });
    ddbMock.on(UpdateCommand).resolves({});

    await handler();

    const batch = capturedMetrics();
    expect(batch?.Namespace).toBe("Workforce/Backfill");
    const names = (batch?.MetricData ?? [])
      .map((m: { MetricName?: string }) => m.MetricName ?? "")
      .sort();
    expect(names).toEqual([
      "WfAlreadyBackfilledTaskRows",
      "WfBackfillErrors",
      "WfBackfilledTaskRows",
    ]);
    const byName = new Map(
      (batch?.MetricData ?? []).map(
        (m: { MetricName?: string; Value?: number }) => [m.MetricName, m.Value],
      ),
    );
    expect(byName.get("WfBackfilledTaskRows")).toBe(1);
    expect(byName.get("WfAlreadyBackfilledTaskRows")).toBe(1);
    expect(byName.get("WfBackfillErrors")).toBe(0);
  });

  it("ignores non-TASK rows — DDB FilterExpression excludes them before items reach the handler", async () => {
    // The server-side FilterExpression (`begins_with(#pk, :taskPrefix)`) means
    // only TASK# rows appear in Items; this test confirms scanned/backfilled
    // counts reflect only what DDB returns.
    ddbMock.on(ScanCommand).resolvesOnce({
      Items: [{ pk: "TASK#01A", sk: "META", agent_slug: "ren" }],
    });
    ddbMock.on(UpdateCommand).resolves({});

    const result = await handler();
    expect(result.scanned).toBe(1);
    expect(result.backfilled).toBe(1);
  });

  it("paginates via LastEvaluatedKey (cycle-2 gap: pagination loop now exercised)", async () => {
    ddbMock
      .on(ScanCommand)
      .resolvesOnce({
        Items: [{ pk: "TASK#01A", sk: "META", agent_slug: "ren" }],
        LastEvaluatedKey: { pk: "TASK#01A", sk: "META" },
      })
      .resolvesOnce({
        Items: [
          { pk: "TASK#02A", sk: "META", agent_slug: "ren" },
          { pk: "TASK#02B", sk: "META", agent_slug: "maya" },
        ],
      });
    ddbMock.on(UpdateCommand).resolves({});

    const result = await handler();

    expect(result.scanned).toBe(3);
    expect(result.backfilled).toBe(3);
    expect(ddbMock.commandCalls(ScanCommand)).toHaveLength(2);
  });

  it("non-CCF UpdateItem failure pushes the row into errors[] + counts in metric (cycle-2 gap)", async () => {
    ddbMock.on(ScanCommand).resolvesOnce({
      Items: [{ pk: "TASK#01A", sk: "META", agent_slug: "ren" }],
    });
    ddbMock.on(UpdateCommand).rejectsOnce(
      new Error("ProvisionedThroughputExceededException"),
    );

    const result = await handler();

    expect(result.scanned).toBe(1);
    expect(result.backfilled).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.pk).toBe("TASK#01A");
    expect(result.errors[0]!.message).toMatch(/ProvisionedThroughput/);

    const batch = capturedMetrics();
    const byName = new Map(
      (batch?.MetricData ?? []).map(
        (m: { MetricName?: string; Value?: number }) => [m.MetricName, m.Value],
      ),
    );
    expect(byName.get("WfBackfillErrors")).toBe(1);
    expect(byName.get("WfBackfilledTaskRows")).toBe(0);
  });
});
