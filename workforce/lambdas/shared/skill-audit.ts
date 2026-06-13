// Append-only audit trail for skill config mutations (ADR-0008 Decision §4).
//
// Mirror of shared/agent-audit.ts on the SKILL#{name} partition:
//
//   pk = SKILL#{name}
//   sk = AUDIT#{iso-ts}#{nonce}
//
// Same ordering contract (append AFTER the row update, THROW on failure —
// W-4) and the same field-diff shape, so the weekly wf-config-digest can
// render agent and skill mutations through one code path. `diffChanges`
// from agent-audit.ts is reused — the long-string digest rule applies to
// the skill `body` exactly as it does to an agent `system_prompt`.

import { randomUUID } from "node:crypto";
import { AUDIT_SK_PREFIX, type AgentAuditChange } from "./agent-audit.js";
import { skillPk } from "./skill-row.js";
import { putItem, queryBySkPrefixPaged, type PagedResult } from "./ddb.js";

export interface SkillAuditRow {
  pk: `SKILL#${string}`;
  sk: `AUDIT#${string}`;
  name: string;
  at: string;
  /** IAM principal ARN from the API GW authorizer context, or "operator". */
  actor: string;
  source: "agents-api";
  kind: "config";
  changes: AgentAuditChange[];
}

export async function appendSkillAudit(
  name: string,
  actor: string,
  changes: AgentAuditChange[],
): Promise<SkillAuditRow> {
  const at = new Date().toISOString();
  const row: SkillAuditRow = {
    pk: skillPk(name),
    sk: `${AUDIT_SK_PREFIX}${at}#${randomUUID().slice(0, 8)}`,
    name,
    at,
    actor,
    source: "agents-api",
    kind: "config",
    changes,
  };
  await putItem(row);
  return row;
}

/** Newest-first page of a skill's audit trail (GET /skills/{name}/audit). */
export async function listSkillAudit(
  name: string,
  limit: number,
  cursor?: string,
): Promise<PagedResult<SkillAuditRow>> {
  return queryBySkPrefixPaged<SkillAuditRow>(skillPk(name), AUDIT_SK_PREFIX, limit, cursor, false);
}
