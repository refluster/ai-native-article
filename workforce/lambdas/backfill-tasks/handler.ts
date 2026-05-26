// wf-backfill-tasks Lambda handler.
//
// One-shot, operator-invoked. Scans the workforce DDB table for
// TASK#{ulid}/META rows that are missing the `project_id` attribute
// and fills them in with `self/{agent_slug}` (Epic-010 Story 1-B
// default per the issue body).
//
// Idempotent: each UpdateItem is conditional on
// `attribute_not_exists(project_id)`, so re-running over already-
// backfilled rows is a cheap no-op (ConditionalCheckFailedException
// caught + counted under `already_backfilled`).
//
// Cost shape: a single Scan + UpdateItem per missing row. No external
// API calls. Operator invocation pattern (manual `aws lambda invoke`),
// not an EventBridge schedule, so cost is zero at rest.

import {
  ConditionalCheckFailedException,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";

const TABLE_NAME = process.env.TABLE_NAME;
if (!TABLE_NAME) throw new Error("TABLE_NAME env var is required");
const tableName: string = TABLE_NAME;
const STAGE = process.env.STAGE ?? "dev";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const cw = new CloudWatchClient({});

interface TaskMetaRow {
  pk: `TASK#${string}`;
  sk: "META";
  agent_slug?: string;
  project_id?: string;
}

export interface BackfillResult {
  scanned: number;
  backfilled: number;
  already_backfilled: number;
  skipped_missing_agent_slug: number;
  errors: Array<{ pk: string; message: string }>;
}

export async function handler(): Promise<BackfillResult> {
  const result: BackfillResult = {
    scanned: 0,
    backfilled: 0,
    already_backfilled: 0,
    skipped_missing_agent_slug: 0,
    errors: [],
  };

  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: "begins_with(#pk, :taskPrefix) AND #sk = :meta",
        ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
        ExpressionAttributeValues: { ":taskPrefix": "TASK#", ":meta": "META" },
        ExclusiveStartKey: exclusiveStartKey,
        Limit: 100,
      }),
    );
    const items = (page.Items ?? []) as TaskMetaRow[];
    result.scanned += items.length;

    for (const row of items) {
      if (typeof row.project_id === "string" && row.project_id.length > 0) {
        // Already set by a prior run (or by the future orchestrator).
        result.already_backfilled++;
        continue;
      }
      if (typeof row.agent_slug !== "string" || row.agent_slug.length === 0) {
        // Can't derive a self/{slug} default without the agent. Skip + log.
        result.skipped_missing_agent_slug++;
        console.warn(
          JSON.stringify({
            event: "backfill_task_skipped",
            reason: "missing_agent_slug",
            pk: row.pk,
          }),
        );
        continue;
      }
      const defaultProjectId = `self/${row.agent_slug}`;
      try {
        await ddb.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { pk: row.pk, sk: row.sk },
            UpdateExpression: "SET #project_id = :pid, #backfilled_at = :now",
            ConditionExpression: "attribute_not_exists(#project_id)",
            ExpressionAttributeNames: {
              "#project_id": "project_id",
              "#backfilled_at": "backfilled_at",
            },
            ExpressionAttributeValues: {
              ":pid": defaultProjectId,
              ":now": new Date().toISOString(),
            },
          }),
        );
        result.backfilled++;
      } catch (err) {
        if (err instanceof ConditionalCheckFailedException) {
          // Concurrent run won; treat as already-backfilled.
          result.already_backfilled++;
        } else {
          const message = err instanceof Error ? err.message : String(err);
          result.errors.push({ pk: row.pk, message });
          console.error(
            JSON.stringify({ event: "backfill_task_error", pk: row.pk, message }),
          );
        }
      }
    }
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);

  await emitMetrics(result);
  console.log(JSON.stringify({ event: "backfill_complete", result }));
  return result;
}

async function emitMetrics(result: BackfillResult): Promise<void> {
  try {
    await cw.send(
      new PutMetricDataCommand({
        Namespace: "Workforce/Backfill",
        MetricData: [
          {
            MetricName: "WfBackfilledTaskRows",
            Value: result.backfilled,
            Unit: "Count",
            Dimensions: [{ Name: "Stage", Value: STAGE }],
          },
          {
            MetricName: "WfAlreadyBackfilledTaskRows",
            Value: result.already_backfilled,
            Unit: "Count",
            Dimensions: [{ Name: "Stage", Value: STAGE }],
          },
          {
            MetricName: "WfBackfillErrors",
            Value: result.errors.length,
            Unit: "Count",
            Dimensions: [{ Name: "Stage", Value: STAGE }],
          },
        ],
      }),
    );
  } catch (err) {
    // Metric emission is best-effort; never fail the backfill on it.
    console.warn(
      JSON.stringify({
        event: "backfill_metric_emit_failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
