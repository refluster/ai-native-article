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
    }),
  );

  const next = res.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString("base64url")
    : undefined;

  return { items: (res.Items ?? []) as T[], cursor: next };
}
