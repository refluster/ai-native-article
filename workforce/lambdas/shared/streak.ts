// Repeat-failure counter (#664 slice 2; design note
// workforce/docs/design/repeat-failure-counter.md, "The counter").
//
// A derived `STREAK#{agent}#{skill}` / `REASON#{reason_code}` item counting
// CONSECUTIVE failures of one cadence for one reason. The EXEC rows stay the
// single source of truth (W-2); this is a rebuildable projection of them
// (`replayStreaks`), deliberately outside `memory.body`, which a curation pass
// can delete and a DDB item cannot be.
//
// Rules, from the design note:
//   - `throw`   -> ADD 1 to the (agent, skill, reason) streak. A missing
//                  reason_code counts as `other`.
//   - `ok`      -> a repair: delete EVERY streak of (agent, skill).
//   - `skipped` -> neither increments nor resets (a quiet day is not a repair).
//   - A different reason starts its own streak and does not clear the old one.
//
// Self-contained DDB client (same shape as dispatch.ts) so callers that mock
// ./ddb.js are not forced to grow new exports.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { ReasonCode } from "./reason-codes.js";

function tableName(): string {
  const t = process.env.TABLE_NAME;
  if (!t) throw new Error("TABLE_NAME env var is required");
  return t;
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export interface StreakRow {
  pk: `STREAK#${string}`;
  sk: `REASON#${string}`;
  agent_slug: string;
  skill_name: string;
  reason_code: ReasonCode;
  /** Consecutive failures with this reason since the last `ok`. */
  count: number;
  /** When the streak's first failure started. */
  first_at: string;
  /** When its latest failure started. */
  last_at: string;
  /** EXEC ulid of the latest failure; makes a retried write idempotent. */
  last_exec_ulid: string;
  last_binding_idx?: number;
}

export function streakPk(agentSlug: string, skillName: string): `STREAK#${string}` {
  return `STREAK#${agentSlug}#${skillName}`;
}

export function streakSk(reason: ReasonCode): `REASON#${string}` {
  return `REASON#${reason}`;
}

export interface StreakEvent {
  agent_slug: string;
  skill_name: string;
  status: string;
  reason_code?: ReasonCode;
  exec_ulid: string;
  started_at: string;
  binding_idx?: number;
}

/**
 * Apply one engagement to the streak store. Returns the `repeat_count` to
 * stamp on the EXEC row: the new streak length for a `throw` (1 on the first
 * occurrence), `undefined` for every other status.
 */
export async function recordStreakEvent(ev: StreakEvent): Promise<number | undefined> {
  if (ev.status === "ok") {
    await clearStreaks(ev.agent_slug, ev.skill_name);
    return undefined;
  }
  if (ev.status !== "throw") return undefined;

  const reason: ReasonCode = ev.reason_code ?? "other";
  const Key = { pk: streakPk(ev.agent_slug, ev.skill_name), sk: streakSk(reason) };
  try {
    const res = await ddb.send(
      new UpdateCommand({
        TableName: tableName(),
        Key,
        UpdateExpression:
          "ADD #count :one SET #first_at = if_not_exists(#first_at, :at), #last_at = :at, " +
          "#last_exec_ulid = :ulid, #agent_slug = :agent, #skill_name = :skill, #reason_code = :reason, " +
          "#last_binding_idx = :bidx",
        // A retried POST that reuses its engagement_id must not count twice.
        ConditionExpression: "attribute_not_exists(#last_exec_ulid) OR #last_exec_ulid <> :ulid",
        ExpressionAttributeNames: {
          "#count": "count",
          "#first_at": "first_at",
          "#last_at": "last_at",
          "#last_exec_ulid": "last_exec_ulid",
          "#agent_slug": "agent_slug",
          "#skill_name": "skill_name",
          "#reason_code": "reason_code",
          "#last_binding_idx": "last_binding_idx",
        },
        ExpressionAttributeValues: {
          ":one": 1,
          ":at": ev.started_at,
          ":ulid": ev.exec_ulid,
          ":agent": ev.agent_slug,
          ":skill": ev.skill_name,
          ":reason": reason,
          ":bidx": ev.binding_idx ?? null,
        },
        ReturnValues: "UPDATED_NEW",
      }),
    );
    const n = res.Attributes?.count;
    return typeof n === "number" ? n : undefined;
  } catch (err) {
    if ((err as { name?: string })?.name !== "ConditionalCheckFailedException") throw err;
    // Same engagement_id seen again: report the count it already produced.
    const existing = await ddb.send(new GetCommand({ TableName: tableName(), Key, ConsistentRead: true }));
    const n = existing.Item?.count;
    return typeof n === "number" ? n : undefined;
  }
}

/** Delete every streak item of (agent, skill). Drains all query pages. */
export async function clearStreaks(agentSlug: string, skillName: string): Promise<number> {
  const pk = streakPk(agentSlug, skillName);
  let deleted = 0;
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: "#pk = :pk",
        ExpressionAttributeNames: { "#pk": "pk" },
        ExpressionAttributeValues: { ":pk": pk },
        ProjectionExpression: "pk, sk",
        ConsistentRead: true,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const item of page.Items ?? []) {
      await ddb.send(new DeleteCommand({ TableName: tableName(), Key: { pk: item.pk, sk: item.sk } }));
      deleted++;
    }
    exclusiveStartKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);
  return deleted;
}

/** The minimal ledger shape `replayStreaks` needs. */
export interface ReplayExec {
  agent_slug: string;
  skill_name: string;
  status: string;
  reason_code?: ReasonCode;
  started_at: string;
  exec_ulid: string;
  binding_idx?: number;
}

/**
 * Rebuild the streak projection from the ledger (the design note's W-2
 * position: STREAK# is derived and rebuildable). Pure: the caller supplies
 * rows from any source (per-skill GSI2 pages, a dump) and writes the result.
 * Rows may arrive in any order; they are replayed oldest-first by `started_at`.
 */
export function replayStreaks(rows: readonly ReplayExec[]): StreakRow[] {
  const sorted = [...rows].sort((a, b) => a.started_at.localeCompare(b.started_at));
  const open = new Map<string, Map<ReasonCode, StreakRow>>();
  for (const r of sorted) {
    const cadence = streakPk(r.agent_slug, r.skill_name);
    if (r.status === "ok") {
      open.delete(cadence);
      continue;
    }
    if (r.status !== "throw") continue;
    const reason: ReasonCode = r.reason_code ?? "other";
    let byReason = open.get(cadence);
    if (!byReason) open.set(cadence, (byReason = new Map()));
    const prev = byReason.get(reason);
    byReason.set(reason, {
      pk: cadence,
      sk: streakSk(reason),
      agent_slug: r.agent_slug,
      skill_name: r.skill_name,
      reason_code: reason,
      count: (prev?.count ?? 0) + 1,
      first_at: prev?.first_at ?? r.started_at,
      last_at: r.started_at,
      last_exec_ulid: r.exec_ulid,
      last_binding_idx: r.binding_idx,
    });
  }
  return [...open.values()].flatMap((m) => [...m.values()]);
}
