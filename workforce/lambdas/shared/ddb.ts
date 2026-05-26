// Thin DDB client wrapper. One shared client per Lambda cold start.
// Uses Document Client so we can write JS objects without manual marshalling.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  ScanCommand,
  QueryCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";

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
 */
export async function queryBySkPrefix<T extends object>(
  pk: string,
  skPrefix: string,
  limit = 100,
): Promise<T[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "#pk = :pk AND begins_with(#sk, :skp)",
      ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
      ExpressionAttributeValues: { ":pk": pk, ":skp": skPrefix },
      Limit: limit,
    }),
  );
  return (res.Items ?? []) as T[];
}

export type GsiName = "GSI1" | "GSI2";

export interface GsiQuery {
  /** Inclusive lower + upper bound on the GSI sort key (e.g. timestamp range). */
  skBetween?: [string, string];
  /** Prefix match on the GSI sort key. Mutually exclusive with skBetween. */
  skPrefix?: string;
  limit?: number;
  /** Ascending by default; pass false for descending (newest-first). */
  scanIndexForward?: boolean;
}

/**
 * Query a GSI by its partition key (and optional sort-key range / prefix).
 * Used for cross-partition access patterns — e.g. "all EXEC#* rows whose
 * gsi1pk=AGENT#ren regardless of which project's partition they sit in."
 */
export async function queryByGsi<T extends object>(
  indexName: GsiName,
  partitionKey: string,
  query: GsiQuery = {},
): Promise<T[]> {
  const pkAttr = indexName === "GSI1" ? "gsi1pk" : "gsi2pk";
  const skAttr = indexName === "GSI1" ? "gsi1sk" : "gsi2sk";

  let keyConditionExpression = "#pk = :pk";
  const exprNames: Record<string, string> = { "#pk": pkAttr };
  const exprValues: Record<string, unknown> = { ":pk": partitionKey };

  if (query.skBetween) {
    keyConditionExpression += " AND #sk BETWEEN :from AND :to";
    exprNames["#sk"] = skAttr;
    exprValues[":from"] = query.skBetween[0];
    exprValues[":to"] = query.skBetween[1];
  } else if (query.skPrefix) {
    keyConditionExpression += " AND begins_with(#sk, :skp)";
    exprNames["#sk"] = skAttr;
    exprValues[":skp"] = query.skPrefix;
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
