// Malformed-row validators and unified emitter for the agents-api list routes.
//
// Extracted from agents-api/handler.ts (where `isWellFormedProjectMeta` /
// `emitMalformedProjectMeta` lived inline) so the same defence-in-depth
// pattern can be applied to listAgents and listSkills without duplicating
// code. (FU-NEW-E — same bug class as FU-PROJ-SCAN.)
//
// Emit contract:
//   - Structured JSON warn to stdout (captured by CloudWatch Logs Insights).
//   - Best-effort PutMetricData → `Workforce/AgentsApi` / `WfMalformedRow`
//     with Dimensions: Stage + RowType. Fire-and-forget; a metric failure
//     must not block the list response.

import { PutMetricDataCommand, type CloudWatchClient } from "@aws-sdk/client-cloudwatch";

import type { AgentMetaRow } from "./agent.js";
import type { ProjectMetaRow } from "./project.js";
import type { SkillMetaRow } from "./skill-row.js";

export type MalformedRowType = "project" | "agent" | "skill";

// ── Guards ────────────────────────────────────────────────────────────────

export function isWellFormedProjectMeta(
  row: Partial<ProjectMetaRow>,
): row is ProjectMetaRow {
  return (
    typeof row.project_id === "string" &&
    row.project_id.length > 0 &&
    typeof row.status === "string" &&
    typeof row.owner_agent === "string" &&
    typeof row.created_at === "string"
  );
}

export function isWellFormedAgentMeta(
  row: Partial<AgentMetaRow>,
): row is AgentMetaRow {
  return (
    typeof row.slug === "string" &&
    row.slug.length > 0 &&
    typeof row.first_name === "string" &&
    typeof row.last_name === "string" &&
    typeof row.role === "string" &&
    typeof row.created_at === "string"
  );
}

export function isWellFormedSkillMeta(
  row: Partial<SkillMetaRow>,
): row is SkillMetaRow {
  return (
    typeof row.name === "string" &&
    row.name.length > 0 &&
    typeof row.version === "string" &&
    typeof row.status === "string" &&
    typeof row.created_at === "string"
  );
}

// ── Unified emitter ───────────────────────────────────────────────────────

/**
 * Emit a structured warn log + best-effort CW metric for a skipped
 * malformed row. The `RowType` dimension lets a single alarm cover all
 * three entity types while still allowing per-type breakdown in Insights.
 */
export function emitMalformedRow(
  row: Partial<{ pk: unknown }>,
  rowType: MalformedRowType,
  cw: CloudWatchClient,
  stage: string,
): void {
  const pk = typeof row.pk === "string" ? row.pk : "<missing-pk>";
  console.warn(
    JSON.stringify({
      event: "agents_api_malformed_row",
      row_type: rowType,
      pk,
      attrs: Object.keys(row).sort(),
      reason: "missing canonical attributes — fix the bootstrap runbook",
    }),
  );
  cw.send(
    new PutMetricDataCommand({
      Namespace: "Workforce/AgentsApi",
      MetricData: [
        {
          MetricName: "WfMalformedRow",
          Value: 1,
          Unit: "Count",
          Dimensions: [
            { Name: "Stage", Value: stage },
            { Name: "RowType", Value: rowType },
          ],
        },
      ],
    }),
  ).catch((err: unknown) => {
    console.warn(
      JSON.stringify({
        event: "agents_api_malformed_row_metric_emit_failed",
        row_type: rowType,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  });
}
