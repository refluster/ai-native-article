// Thin DDB client wrapper. One shared client per Lambda cold start.
// Uses Document Client so we can write JS objects without manual marshalling.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  ScanCommand,
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
