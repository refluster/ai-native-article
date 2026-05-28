// Thin CloudWatch metric emitter. Best-effort by design: a metric-emit
// failure must never mask the underlying operation (W-4 is enforced at
// the operation layer, not the observability layer).
//
// Centralised so the AWS SDK import (and the per-cold-start client) lives
// in workforce/lambdas/shared/, NOT in workforce/skills/{name}/handler.ts —
// the skill folder is not its own npm package and module resolution from
// workforce/skills/ does not reach workforce/lambdas/node_modules/.

import {
  CloudWatchClient,
  PutMetricDataCommand,
} from "@aws-sdk/client-cloudwatch";

const cw = new CloudWatchClient({});
const STAGE = process.env.STAGE ?? "dev";

export interface MetricDimension {
  Name: string;
  Value: string;
}

/**
 * Put one count-valued metric data point. The `Stage` dimension is
 * always added; callers pass additional dimensions (e.g. `Agent`,
 * `Reason`) in `extraDimensions`.
 *
 * Best-effort: catches and logs all errors. Never throws.
 */
export async function putCountMetric(
  namespace: string,
  metricName: string,
  value: number,
  extraDimensions: MetricDimension[] = [],
): Promise<void> {
  try {
    await cw.send(
      new PutMetricDataCommand({
        Namespace: namespace,
        MetricData: [
          {
            MetricName: metricName,
            Value: value,
            Unit: "Count",
            Dimensions: [{ Name: "Stage", Value: STAGE }, ...extraDimensions],
          },
        ],
      }),
    );
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "cw_metric_emit_failed",
        namespace,
        metric_name: metricName,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
