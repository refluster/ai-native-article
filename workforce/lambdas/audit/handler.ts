// wf-audit Lambda handler.
//
// Daily cron-fired (04:00 UTC by default — low workforce traffic).
// Audits the last 24h of EXEC rows for the two signal classes that
// gate Epic-010's `Status: Implemented` flip (ROADMAP §Status-transition
// criterion 4):
//
//   1. WfAuditTruncatedExecs    EXEC rows where status='ok' but the
//                                artifact_ref is missing or its summary
//                                is empty (an indicator that the
//                                LLM-prose / deterministic skill wrote
//                                an empty deliverable that the operator
//                                would normally classify as a C-1
//                                truncation event).
//
//   ── (the WfAuditOrphanExecs signal was dropped by the C2 cutover) ──
//
//   Pre-C2 (Story-1-B dual-write window), the audit cross-referenced
//   EXEC <-> RUN rows in both directions:
//     - EXEC#{ulid} with no matching AGENT#{slug}/RUN#{ulid}
//     - RUN#{ulid} with no matching PROJECT#{id}/EXEC#{ulid}
//   Post-C2, the success path writes ONLY EXEC rows (no RUN sibling),
//   so "EXEC without RUN" would fire for every run — pure noise.
//   The remaining failure-path RUN writes (failRun / skipRun /
//   throwRun in agent-runner) have no EXEC sibling by design — also
//   noise. The metric, the WfAuditOrphanExecsAlarm, and the dashboard
//   widget were retired by C2. The truncated check (1) is the
//   informational successor for "EXEC arrived but has no artefact"
//   regressions.
//
//   2. WfAuditMalformedExecs     EXEC rows missing project_id /
//                                agent_slug / started_at — a data-shape
//                                regression (FU-NEW-D class) that would
//                                silently break the ledger's audit value.
//                                (This signal replaced the retired
//                                WfAuditCrossProjectLeaks membership
//                                check on 2026-07-03: the member concept
//                                was removed — every registered agent
//                                participates in every project — so
//                                "agent has no MEMBER row" stopped being
//                                a violation. The malformed-row half of
//                                that check is what survives.)
//
// ─── Architectural deviation from FU-021 / #146 spec ──────────────────
//
// The issue specced a "skill at workforce/skills/audit/". I'm
// implementing it as a standalone Lambda (this directory) instead. The
// reasoning:
//
//   - The audit is not agent work — there is no agent persona acting,
//     no LLM call, no deliverable. The skill model carries that shape;
//     a system-monitoring Lambda is a cleaner fit.
//   - Skills go through agent-runner, which itself performs the
//     dual-write we audit. Using the same code path for the auditor
//     creates a coupling concern (a dual-write bug could go undetected
//     because both the writer and the auditor exercise the same buggy
//     path).
//   - Standalone Lambda + EventBridge schedule is the well-trodden
//     pattern for cron-fired system Lambdas (orchestrator, backfill-
//     tasks, migrate-credentials).
//
// The deviation is documented in the PR body; FU-021's textual spec is
// not load-bearing.

import {
  CloudWatchClient,
  PutMetricDataCommand,
} from "@aws-sdk/client-cloudwatch";
import {
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = process.env.TABLE_NAME;
if (!TABLE_NAME) throw new Error("TABLE_NAME env var is required");
const tableName: string = TABLE_NAME;
const STAGE = process.env.STAGE ?? "dev";

// Tunable knob — bound the scan window. The cron fires daily at 04:00
// UTC; a 24h window keeps the scan size proportional to the workforce's
// daily execution count.
const WINDOW_HOURS = 24;
const SCAN_PAGE_SIZE = 200;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const cw = new CloudWatchClient({});

// Row shapes — kept loose because the handler does shape-tolerant
// reads (the malformed-row pattern from FU-NEW-D). DDB silently ignores
// unknown attrs; we read what we need + tolerate absence.
interface ExecRow {
  pk: string; // PROJECT#{id}
  sk: string; // EXEC#{ulid}
  project_id?: string;
  agent_slug?: string;
  status?: string;
  started_at?: string;
  artifact_ref?: {
    summary?: string;
    size_bytes?: number;
    uri?: string;
  };
}

export interface AuditFinding {
  signal: "truncated" | "malformed_exec";
  pk: string;
  sk: string;
  reason: string;
}

export interface AuditResult {
  window_hours: number;
  cutoff_iso: string;
  scanned: { exec: number };
  counts: {
    truncated: number;
    malformed_exec: number;
  };
  findings: AuditFinding[];
}

export async function handler(): Promise<AuditResult> {
  const cutoff = new Date(Date.now() - WINDOW_HOURS * 3600_000);
  const cutoffIso = cutoff.toISOString();

  // Pull every EXEC row in the window via a filtered Scan.
  // At hobby scale this is bounded; at >10k EXEC rows/day, promote
  // to a GSI3 keyed on started_at. Out of scope today.
  const execRows = await scanWindowed<ExecRow>("EXEC#", cutoffIso, "started_at");

  const findings: AuditFinding[] = [];

  // Signal 1: truncated executions.
  for (const exec of execRows) {
    if (exec.status !== "ok") continue;
    const isTruncated =
      exec.artifact_ref === undefined ||
      exec.artifact_ref.summary === undefined ||
      exec.artifact_ref.summary.trim().length === 0 ||
      exec.artifact_ref.size_bytes === 0;
    if (isTruncated) {
      findings.push({
        signal: "truncated",
        pk: exec.pk,
        sk: exec.sk,
        reason: exec.artifact_ref
          ? "artifact_ref present but summary empty or size_bytes=0"
          : "artifact_ref missing on status=ok row",
      });
    }
  }

  // Signal 2 (post-C2): orphan-row cross-reference REMOVED — see the
  // file-level header. The success path no longer writes legacy RUN
  // rows (C2 cutover), and failure-path RUN writes don't have an EXEC
  // sibling by design — both directions of the orphan check became
  // universal noise after C2.

  // Signal 2: malformed EXEC rows (fail-loud on data-shape regressions;
  // FU-NEW-D class). The membership-based cross-project-leak check that
  // used to live here was retired with the member concept (2026-07-03):
  // every registered agent participates in every project, so a missing
  // MEMBER row is no longer a violation.
  for (const exec of execRows) {
    if (!exec.project_id || !exec.agent_slug || !exec.started_at) {
      findings.push({
        signal: "malformed_exec",
        pk: exec.pk,
        sk: exec.sk,
        reason: `malformed exec row — missing project_id/agent_slug/started_at`,
      });
    }
  }

  const counts = {
    truncated: countBy(findings, "truncated"),
    malformed_exec: countBy(findings, "malformed_exec"),
  };

  const result: AuditResult = {
    window_hours: WINDOW_HOURS,
    cutoff_iso: cutoffIso,
    scanned: { exec: execRows.length },
    counts,
    findings,
  };

  await emitMetrics(counts);
  console.log(JSON.stringify({ event: "audit_complete", result }));
  return result;
}

function countBy(findings: AuditFinding[], signal: AuditFinding["signal"]): number {
  return findings.filter((f) => f.signal === signal).length;
}

async function scanWindowed<T extends { sk: string }>(
  skPrefix: string,
  cutoffIso: string,
  startedAtAttr: string,
): Promise<T[]> {
  // The DDB Scan applies Limit BEFORE FilterExpression, so we may need
  // multiple pages to fill the cutoff window. Loop until LastEvaluatedKey
  // is undefined; at hobby scale (~50 rows/day per signal) this is one
  // page in practice.
  const results: T[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression:
          "begins_with(#sk, :skPrefix) AND #started >= :cutoff",
        ExpressionAttributeNames: { "#sk": "sk", "#started": startedAtAttr },
        ExpressionAttributeValues: { ":skPrefix": skPrefix, ":cutoff": cutoffIso },
        ExclusiveStartKey: exclusiveStartKey,
        Limit: SCAN_PAGE_SIZE,
      }),
    );
    const items = (page.Items ?? []) as T[];
    results.push(...items);
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return results;
}

async function emitMetrics(counts: AuditResult["counts"]): Promise<void> {
  try {
    await cw.send(
      new PutMetricDataCommand({
        Namespace: "Workforce/Audit",
        MetricData: [
          {
            MetricName: "WfAuditTruncatedExecs",
            Value: counts.truncated,
            Unit: "Count",
            Dimensions: [{ Name: "Stage", Value: STAGE }],
          },
          {
            MetricName: "WfAuditMalformedExecs",
            Value: counts.malformed_exec,
            Unit: "Count",
            Dimensions: [{ Name: "Stage", Value: STAGE }],
          },
        ],
      }),
    );
  } catch (err) {
    // Best-effort: never fail the audit on metric emission. The result
    // is still returned + logged structurally above.
    console.warn(
      JSON.stringify({
        event: "audit_metric_emit_failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
