// Append-only audit trail for agent config mutations (ADR-0007 Decision §4).
//
// With the AGENT#{slug} row authoritative for identity/config and agents-api
// the single writer, every mutation appends an immutable AUDIT item under
// the same partition:
//
//   pk = AGENT#{slug}
//   sk = AUDIT#{iso-ts}#{nonce}      (nonce disambiguates same-ms writes)
//
// The item carries the actor and a field-level before/after diff — the
// replacement for the git history the retired agents tree used to provide.
// The weekly review digest (migration step 4) compiles these items; the
// console renders them per-agent.
//
// Ordering contract: the audit append runs AFTER the row update succeeds
// and THROWS on failure (the route maps it to a 500). A mutation that
// persisted without its audit item is a loud incident, never a silent one
// (W-4). Folding both writes into a TransactWriteItems is a hardening
// follow-up if the gap ever bites.

import { createHash, randomUUID } from "node:crypto";
import { agentPk, type AgentSlug } from "./agent.js";
import { putItem, queryBySkPrefixPaged, type PagedResult } from "./ddb.js";

export const AUDIT_SK_PREFIX = "AUDIT#";

export interface AgentAuditChange {
  field: string;
  before: unknown;
  after: unknown;
}

export type AgentAuditKind = "identity" | "operational";

export interface AgentAuditRow {
  pk: `AGENT#${string}`;
  sk: `AUDIT#${string}`;
  slug: AgentSlug;
  at: string;
  /** IAM principal ARN from the API GW authorizer context, or "operator"
   *  when the context carries none (e.g. local invocation). */
  actor: string;
  source: "agents-api";
  kind: AgentAuditKind;
  changes: AgentAuditChange[];
}

export async function appendAgentAudit(
  slug: AgentSlug,
  actor: string,
  kind: AgentAuditKind,
  changes: AgentAuditChange[],
): Promise<AgentAuditRow> {
  const at = new Date().toISOString();
  const row: AgentAuditRow = {
    pk: agentPk(slug),
    sk: `${AUDIT_SK_PREFIX}${at}#${randomUUID().slice(0, 8)}`,
    slug,
    at,
    actor,
    source: "agents-api",
    kind,
    changes,
  };
  await putItem(row);
  return row;
}

/** Newest-first page of an agent's audit trail (GET /agents/{slug}/audit). */
export async function listAgentAudit(
  slug: AgentSlug,
  limit: number,
  cursor?: string,
): Promise<PagedResult<AgentAuditRow>> {
  return queryBySkPrefixPaged<AgentAuditRow>(
    agentPk(slug),
    AUDIT_SK_PREFIX,
    limit,
    cursor,
    false,
  );
}

/** Long string values (the persona system_prompt, since ADR-0007 step 2)
 *  are recorded as a digest, not verbatim: the full before/after text would
 *  double-store kilobytes per edit in an append-only partition, and the
 *  weekly digest only needs "the prompt changed, by whom, roughly how".
 *  The authoritative current text is always on the META row itself. */
const AUDIT_STRING_VERBATIM_MAX = 1024;
const AUDIT_STRING_HEAD_CHARS = 200;

export interface TruncatedAuditValue {
  truncated: true;
  length: number;
  sha256: string;
  head: string;
}

function auditValue(v: unknown): unknown {
  if (typeof v === "string" && v.length > AUDIT_STRING_VERBATIM_MAX) {
    const t: TruncatedAuditValue = {
      truncated: true,
      length: v.length,
      sha256: createHash("sha256").update(v).digest("hex"),
      head: v.slice(0, AUDIT_STRING_HEAD_CHARS),
    };
    return t;
  }
  return v;
}

/** Field-level diff between the pre-mutation row and the applied patch.
 *  Only fields actually present in the patch are recorded; a field whose
 *  patched value deep-equals the existing value is skipped (a PATCH that
 *  re-sends the current value is not a change worth a digest line). */
export function diffChanges(
  existing: Readonly<Record<string, unknown>>,
  patch: Readonly<Record<string, unknown>>,
): AgentAuditChange[] {
  const changes: AgentAuditChange[] = [];
  for (const [field, after] of Object.entries(patch)) {
    const before = existing[field];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    changes.push({
      field,
      before: before === undefined ? null : auditValue(before),
      after: auditValue(after),
    });
  }
  return changes;
}
