// Epic-012 Story 4 — recall observability.
//
// Two metrics under Workforce/Recall, emitted from the shared recall path so
// both callers (agent-runner buildRecallBlock, agents-api getAgentRecall)
// feed the same series:
//
//   WfRecallLatencyMs        per-call recall latency (ms). CloudWatch's p95
//                            statistic over this is the ADR-0002 migration
//                            trigger ("recall p95 > 1s for ≥ 1 week").
//   WfRecallVintageMismatch  count=1 each time recall aborts because the
//                            embedded candidate set spans >1 embedding model
//                            (or differs from the query's model) — the signal
//                            to run a re-embedding sweep.
//
// Best-effort: emission NEVER fails recall. Both Lambdas that call recall()
// carry a cloudwatch:PutMetricData grant scoped to this namespace.

import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";

const NAMESPACE = "Workforce/Recall";
const STAGE = process.env.STAGE ?? "dev";
const cw = new CloudWatchClient({});
const dims = [{ Name: "Stage", Value: STAGE }];

export async function emitRecallLatency(ms: number): Promise<void> {
  try {
    await cw.send(
      new PutMetricDataCommand({
        Namespace: NAMESPACE,
        MetricData: [{ MetricName: "WfRecallLatencyMs", Value: ms, Unit: "Milliseconds", Dimensions: dims }],
      }),
    );
  } catch (err) {
    console.warn(JSON.stringify({ event: "recall_metric_emit_failed", metric: "WfRecallLatencyMs", error: err instanceof Error ? err.message : String(err) }));
  }
}

export async function emitVintageMismatch(): Promise<void> {
  try {
    await cw.send(
      new PutMetricDataCommand({
        Namespace: NAMESPACE,
        MetricData: [{ MetricName: "WfRecallVintageMismatch", Value: 1, Unit: "Count", Dimensions: dims }],
      }),
    );
  } catch (err) {
    console.warn(JSON.stringify({ event: "recall_metric_emit_failed", metric: "WfRecallVintageMismatch", error: err instanceof Error ? err.message : String(err) }));
  }
}
