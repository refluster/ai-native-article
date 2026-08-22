// Thin DDB client wrapper. One shared client per Lambda cold start.
// Uses Document Client so we can write JS objects without manual marshalling.

import {
  ConditionalCheckFailedException,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  ScanCommand,
  QueryCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";

export { ConditionalCheckFailedException };

const TABLE_NAME = process.env.TABLE_NAME;
if (!TABLE_NAME) {
  throw new Error("TABLE_NAME env var is required");
}
const tableName: string = TABLE_NAME;

const raw = new DynamoDBClient({});
export const ddb = DynamoDBDocumentClient.from(raw, {
  marshallOptions: { removeUndefinedValues: true },
});

// Generic constraint is `object` (not Record<string, unknown>) so domain
// types like AgentMetaRow — which have specific keys but no index signature
// — can flow through without `as unknown` gymnastics.
export async function getItem<T extends object>(
  pk: string,
  sk: string,
): Promise<T | undefined> {
  const res = await ddb.send(
    new GetCommand({ TableName: tableName, Key: { pk, sk } }),
  );
  return res.Item as T | undefined;
}

export async function putItem(item: object): Promise<void> {
  await ddb.send(new PutCommand({ TableName: tableName, Item: item }));
}

/**
 * PutItem with a ConditionExpression. Throws `ConditionalCheckFailedException`
 * (re-exported above) when the condition does not hold. Use when the caller
 * needs race-safe "create if not exists" semantics.
 */
export async function conditionalPutItem(
  item: object,
  conditionExpression: string,
  expressionAttributeNames?: Record<string, string>,
  expressionAttributeValues?: Record<string, unknown>,
): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: item,
      ConditionExpression: conditionExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    }),
  );
}

export async function updateOperational<T extends object = object>(
  pk: string,
  sk: string,
  patch: Record<string, unknown>,
  expectedIdentityHash?: string,
): Promise<T> {
  const setExprs: string[] = [];
  const exprNames: Record<string, string> = {};
  const exprValues: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const nameKey = `#${k}`;
    const valueKey = `:${k}`;
    setExprs.push(`${nameKey} = ${valueKey}`);
    exprNames[nameKey] = k;
    exprValues[valueKey] = v;
  }

  setExprs.push("#updated_at = :updated_at");
  exprNames["#updated_at"] = "updated_at";
  exprValues[":updated_at"] = new Date().toISOString();

  let conditionExpression: string | undefined;
  if (expectedIdentityHash) {
    conditionExpression = "#identity_hash = :expected_identity_hash";
    exprNames["#identity_hash"] = "identity_hash";
    exprValues[":expected_identity_hash"] = expectedIdentityHash;
  }

  const res = await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { pk, sk },
      UpdateExpression: `SET ${setExprs.join(", ")}`,
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprValues,
      ConditionExpression: conditionExpression,
      ReturnValues: "ALL_NEW",
    }),
  );
  return (res.Attributes ?? {}) as T;
}

export interface ScanPage<T> {
  items: T[];
  cursor?: string;
}

/**
 * One raw page of a filtered Scan.
 *
 * ⚠️ FOOTGUN — `pageSize` (DynamoDB `Limit`) bounds the number of items
 * EVALUATED, not the number that survive the `begins_with(pk) AND sk=`
 * filter. A single page can therefore return far fewer matches than
 * `pageSize` — or ZERO — while still reporting a `cursor` (more pages).
 * This is correct ONLY for callers that loop `while (cursor)` to drain
 * every page (orchestrator-tick, config-digest, memory-compactor, the
 * agents-api stats/budget paths). A caller that returns ONE page verbatim
 * to an HTTP client silently drops every matching row outside the first
 * scan window — the 2026-06-15 projects-console disappearance (FU-PROJ-SCAN).
 *
 * To back a list endpoint that returns a whole entity type, use
 * {@link scanAllPrefix} instead — never this.
 */
export async function scanPrefix<T extends object>(
  pkPrefix: string,
  skEquals: string,
  pageSize: number,
  cursor?: string,
): Promise<ScanPage<T>> {
  const exclusiveStartKey = cursor
    ? (JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<string, unknown>)
    : undefined;

  const res = await ddb.send(
    new ScanCommand({
      TableName: tableName,
      FilterExpression: "begins_with(#pk, :pkprefix) AND #sk = :sk",
      ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
      ExpressionAttributeValues: { ":pkprefix": pkPrefix, ":sk": skEquals },
      Limit: pageSize,
      ExclusiveStartKey: exclusiveStartKey,
    }),
  );

  const next = res.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString("base64url")
    : undefined;

  return { items: (res.Items ?? []) as T[], cursor: next };
}

/**
 * Drained filtered Scan: returns EVERY row matching
 * `begins_with(pk, pkPrefix) AND sk = skEquals`, following
 * `LastEvaluatedKey` to exhaustion. The only sanctioned primitive for a
 * list endpoint that surfaces a whole entity type (projects / agents /
 * skills) to a caller.
 *
 * Why this exists — and why it has no `Limit`: see the FOOTGUN note on
 * {@link scanPrefix}. DynamoDB's `Limit` is a SCAN-window bound, not a
 * match count, so a `Limit`-capped page silently truncates the filtered
 * result. Omitting `Limit` lets each scan return a full 1 MB page (more
 * matches per round-trip); the loop drains the rest.
 *
 * Incident 2026-06-15 (Agent Workforce Platform — Mateo/Hana): the
 * projects console rendered "2 registered" because only 2 PROJECT#/META
 * rows fell inside the first 25-item scan window of a single table
 * dominated by EXEC#/MSG#/AGENT# rows. `agent-workforce` — the credential
 * bag every feed-post cadence resolves — existed in DDB the whole time;
 * the read path truncated it out of view. No row was deleted. See
 * workforce/docs/follow-ups.md (FU-PROJ-SCAN).
 *
 * Bounded by C-3 (single-operator scale): the matched entity types are
 * ≤ a few hundred rows, so a full drain is cheap. If a matched set ever
 * grows unbounded, the fix is a per-entity-type GSI (e.g. gsiNpk="PROJECT"),
 * NOT a re-introduced `Limit` — that is a Zone-A SAM amendment (R-N2),
 * tracked as a follow-up, never an in-handler `scanPrefix` shortcut.
 */
export async function scanAllPrefix<T extends object>(
  pkPrefix: string,
  skEquals: string,
): Promise<T[]> {
  const items: T[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: "begins_with(#pk, :pkprefix) AND #sk = :sk",
        ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
        ExpressionAttributeValues: { ":pkprefix": pkPrefix, ":sk": skEquals },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    items.push(...((res.Items ?? []) as T[]));
    exclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);
  return items;
}

export async function deleteItem(pk: string, sk: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: tableName, Key: { pk, sk } }));
}

/**
 * Query rows under a single partition by SK prefix. More efficient than
 * Scan when the access pattern is "all DELIV#* rows under AGENT#ren" etc.
 *
 * `scanIndexForward` mirrors `queryByGsi`: defaults to `true` (ascending /
 * oldest-first) to preserve existing callers, but "recent N rows" callers
 * must pass `false` — otherwise `Limit` keeps the OLDEST N, not the newest
 * (the engagement-ledger read bug: a busy partition's latest rows fall
 * outside the window entirely).
 */
export async function queryBySkPrefix<T extends object>(
  pk: string,
  skPrefix: string,
  limit = 100,
  scanIndexForward = true,
): Promise<T[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :skp)",
      ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
      ExpressionAttributeValues: { ":pk": pk, ":skp": skPrefix },
      Limit: limit,
      ScanIndexForward: scanIndexForward,
      // ML-029 / #613: this is a base-table primary-key query, so a
      // strongly consistent read is available (unlike the GSI queries
      // below — DynamoDB never supports ConsistentRead on a GSI). Without
      // this, a read that races a same-flow write can be served from a
      // replica that hasn't caught up yet, which is exactly the "stale
      // head row at a small Limit" symptom `GET /agents/{slug}/posts`
      // hit repeatedly (queryBySkPrefixPaged, same fix, below).
      ConsistentRead: true,
    }),
  );
  return (res.Items ?? []) as T[];
}

export type GsiName = "GSI1" | "GSI2" | "GSI3" | "GSI4";

/** Per-GSI attribute names. Adding GSI3+ is a one-line addition here.
 *  GSI3 added by Epic-011 Story 1 (#128) for the workforce activity feed
 *  (gsi3pk="FEED" / gsi3sk=posted_at). Story 5 (#132) queries it.
 *  GSI4 added by Epic-013 Story 1 (#248) for the talent-messaging inbox
 *  (gsi4pk="INBOX#{slug}" / gsi4sk=last_message_at). */
const GSI_ATTRS: Record<GsiName, { pk: string; sk: string }> = {
  GSI1: { pk: "gsi1pk", sk: "gsi1sk" },
  GSI2: { pk: "gsi2pk", sk: "gsi2sk" },
  GSI3: { pk: "gsi3pk", sk: "gsi3sk" },
  GSI4: { pk: "gsi4pk", sk: "gsi4sk" },
};

export interface GsiQuery {
  /** Inclusive lower bound on the GSI sort key. Pushes down as `#sk >= :from`. */
  skGte?: string;
  /** Inclusive upper bound on the GSI sort key. Pushes down as `#sk <= :to`. */
  skLte?: string;
  /** Prefix match on the GSI sort key. Mutually exclusive with skGte/skLte. */
  skPrefix?: string;
  limit?: number;
  /** Ascending by default; pass false for descending (newest-first). */
  scanIndexForward?: boolean;
}

/**
 * Query a GSI by its partition key (and optional sort-key range / prefix).
 * Used for cross-partition access patterns — e.g. "all EXEC#* rows whose
 * gsi1pk=AGENT#ren regardless of which project's partition they sit in."
 *
 * Sort-key constraints (mutually exclusive; pick at most one shape):
 *   - both skGte + skLte → `BETWEEN :from AND :to`
 *   - skGte only        → `>= :from`
 *   - skLte only        → `<= :to`
 *   - skPrefix only     → `begins_with(:skp)`
 *   - none              → no SK constraint (full partition)
 *
 * **No `ConsistentRead` option, deliberately.** DynamoDB never supports
 * strongly consistent reads on a GSI (the API rejects `ConsistentRead:
 * true` on an indexed query with a `ValidationException`) — a GSI is an
 * asynchronously-replicated projection of the base table by construction.
 * `GET /agents/{slug}/executions` (via `listExecutions` → GSI1) inherits
 * this: unlike the base-table `queryBySkPrefix` path above, a read here
 * immediately after a same-flow write can still observe a stale/missing
 * head row (ML-029 / #613). There is no code-level fix for that on this
 * index; a caller that must read its own just-written EXEC row
 * immediately should over-fetch (`limit` ≥ 3–5) rather than trust
 * `limit=1`, or poll a couple of seconds later.
 */
export async function queryByGsi<T extends object>(
  indexName: GsiName,
  partitionKey: string,
  query: GsiQuery = {},
): Promise<T[]> {
  const { pk: pkAttr, sk: skAttr } = GSI_ATTRS[indexName];

  let keyConditionExpression = "#pk = :pk";
  const exprNames: Record<string, string> = { "#pk": pkAttr };
  const exprValues: Record<string, unknown> = { ":pk": partitionKey };

  if (query.skPrefix) {
    keyConditionExpression += " AND begins_with(#sk, :skp)";
    exprNames["#sk"] = skAttr;
    exprValues[":skp"] = query.skPrefix;
  } else if (query.skGte !== undefined && query.skLte !== undefined) {
    keyConditionExpression += " AND #sk BETWEEN :from AND :to";
    exprNames["#sk"] = skAttr;
    exprValues[":from"] = query.skGte;
    exprValues[":to"] = query.skLte;
  } else if (query.skGte !== undefined) {
    keyConditionExpression += " AND #sk >= :from";
    exprNames["#sk"] = skAttr;
    exprValues[":from"] = query.skGte;
  } else if (query.skLte !== undefined) {
    keyConditionExpression += " AND #sk <= :to";
    exprNames["#sk"] = skAttr;
    exprValues[":to"] = query.skLte;
  }

  const res = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: indexName,
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprValues,
      Limit: query.limit ?? 100,
      ScanIndexForward: query.scanIndexForward ?? true,
    }),
  );
  return (res.Items ?? []) as T[];
}

export interface PagedResult<T> {
  items: T[];
  /** Opaque base64url cursor; undefined when the result set is exhausted. */
  cursor?: string;
}

/**
 * Paginated variant of `queryByGsi`. Returns the same items plus an opaque
 * base64url-encoded cursor whenever the DDB query was capped by `limit`
 * (i.e. `LastEvaluatedKey` was set). Pass the cursor back in subsequent
 * calls via `cursor` to resume.
 *
 * Cursor format matches `scanPrefix`'s — base64url(JSON(LastEvaluatedKey)).
 * Inheriting that shape keeps the encode/decode logic consistent across
 * the read API and lets cursors round-trip through the API layer without
 * any per-endpoint serialisation glue.
 *
 * Added by Epic-011 Story 5 (#132) for the workforce activity feed
 * (`GET /feed`, `GET /agents/{slug}/posts`) which scan reverse-chrono
 * partitions and must page past arbitrary corpus sizes.
 */
export async function queryByGsiPaged<T extends object>(
  indexName: GsiName,
  partitionKey: string,
  query: GsiQuery & { cursor?: string } = {},
): Promise<PagedResult<T>> {
  const { pk: pkAttr, sk: skAttr } = GSI_ATTRS[indexName];

  let keyConditionExpression = "#pk = :pk";
  const exprNames: Record<string, string> = { "#pk": pkAttr };
  const exprValues: Record<string, unknown> = { ":pk": partitionKey };

  if (query.skPrefix) {
    keyConditionExpression += " AND begins_with(#sk, :skp)";
    exprNames["#sk"] = skAttr;
    exprValues[":skp"] = query.skPrefix;
  } else if (query.skGte !== undefined && query.skLte !== undefined) {
    keyConditionExpression += " AND #sk BETWEEN :from AND :to";
    exprNames["#sk"] = skAttr;
    exprValues[":from"] = query.skGte;
    exprValues[":to"] = query.skLte;
  } else if (query.skGte !== undefined) {
    keyConditionExpression += " AND #sk >= :from";
    exprNames["#sk"] = skAttr;
    exprValues[":from"] = query.skGte;
  } else if (query.skLte !== undefined) {
    keyConditionExpression += " AND #sk <= :to";
    exprNames["#sk"] = skAttr;
    exprValues[":to"] = query.skLte;
  }

  const exclusiveStartKey = query.cursor
    ? (JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")) as Record<string, unknown>)
    : undefined;

  const res = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: indexName,
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprValues,
      Limit: query.limit ?? 100,
      ScanIndexForward: query.scanIndexForward ?? true,
      ExclusiveStartKey: exclusiveStartKey,
    }),
  );

  const next = res.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString("base64url")
    : undefined;

  return { items: (res.Items ?? []) as T[], cursor: next };
}

/**
 * Paginated variant of `queryBySkPrefix`. Same opaque base64url cursor
 * shape as `queryByGsiPaged` + `scanPrefix`. Added by Epic-011 Story 5
 * (#132) for `GET /agents/{slug}/posts` — single-partition reverse-chrono
 * paging without the GSI3 hop.
 */
export async function queryBySkPrefixPaged<T extends object>(
  pk: string,
  skPrefix: string,
  limit = 100,
  cursor?: string,
  scanIndexForward = true,
): Promise<PagedResult<T>> {
  const exclusiveStartKey = cursor
    ? (JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<string, unknown>)
    : undefined;

  const res = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :skp)",
      ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
      ExpressionAttributeValues: { ":pk": pk, ":skp": skPrefix },
      Limit: limit,
      ScanIndexForward: scanIndexForward,
      ExclusiveStartKey: exclusiveStartKey,
      // ML-029 / #613: base-table primary-key query — see the
      // ConsistentRead note on queryBySkPrefix above. This is the
      // primitive `GET /agents/{slug}/posts` (listAgentPosts) is built
      // on; it was the majority of the ML-029 incident hits.
      ConsistentRead: true,
    }),
  );

  const next = res.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString("base64url")
    : undefined;

  return { items: (res.Items ?? []) as T[], cursor: next };
}
