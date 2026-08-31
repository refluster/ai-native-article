// Append-only audit trail for project config mutations (ADR-0029).
//
// The agent tree got this in ADR-0007: once DDB is authoritative and the API
// is the single writer, the git history that used to record "who changed what"
// is gone, and an audit row family replaces it. ADR-0029 moves project config
// onto the same footing — `PATCH /projects/{id}` may now set the descriptive
// attributes that previously only `project.json` + seed could — so the same
// trail is required, on the same shapes (R-N8):
//
//   pk = PROJECT#{id}
//   sk = AUDIT#{iso-ts}#{nonce}      (nonce disambiguates same-ms writes)
//
// `AgentAuditChange` and `diffChanges` are imported rather than re-declared:
// one audit-change shape across the workforce is the point of R-N8, and the
// diff logic (skip no-op fields, digest oversized strings) is identical.
//
// Ordering contract, inherited from agent-audit: the append runs AFTER the row
// update succeeds and THROWS on failure. A mutation that persisted without its
// audit row is a loud incident, never a silent one (W-4).

import { randomUUID } from "node:crypto";
import { projectPk, type ProjectId } from "./project.js";
import { type AgentAuditChange } from "./agent-audit.js";
import { putItem, queryBySkPrefixPaged, type PagedResult } from "./ddb.js";

export const PROJECT_AUDIT_SK_PREFIX = "AUDIT#";

export interface ProjectAuditRow {
  pk: `PROJECT#${string}`;
  sk: `AUDIT#${string}`;
  project_id: ProjectId;
  at: string;
  /** IAM principal ARN from the API GW authorizer context, or "operator"
   *  when the context carries none (e.g. local invocation). */
  actor: string;
  source: "agents-api";
  changes: AgentAuditChange[];
}

export async function appendProjectAudit(
  projectId: ProjectId,
  actor: string,
  changes: AgentAuditChange[],
): Promise<ProjectAuditRow> {
  const at = new Date().toISOString();
  const row: ProjectAuditRow = {
    pk: projectPk(projectId),
    sk: `${PROJECT_AUDIT_SK_PREFIX}${at}#${randomUUID().slice(0, 8)}`,
    project_id: projectId,
    at,
    actor,
    source: "agents-api",
    changes,
  };
  await putItem(row);
  return row;
}

/** Newest-first page of a project's audit trail. */
export async function listProjectAudit(
  projectId: ProjectId,
  limit: number,
  cursor?: string,
): Promise<PagedResult<ProjectAuditRow>> {
  return queryBySkPrefixPaged<ProjectAuditRow>(
    projectPk(projectId),
    PROJECT_AUDIT_SK_PREFIX,
    limit,
    cursor,
    false,
  );
}
