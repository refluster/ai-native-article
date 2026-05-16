import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  type GetCommandInput,
  type PutCommandInput,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb'

const raw = new DynamoDBClient({})
export const ddb = DynamoDBDocumentClient.from(raw, {
  marshallOptions: { removeUndefinedValues: true },
})

export const CORE_TABLE = process.env.CORE_TABLE ?? 'WorkforceCore-dev'
export const CHAT_TABLE = process.env.CHAT_TABLE ?? 'Chat-dev'
export const MEMORY_TABLE = process.env.MEMORY_TABLE ?? 'Memory-dev'

export async function dbGet(
  table: string,
  pk: string,
  sk: string,
): Promise<Record<string, unknown> | undefined> {
  const input: GetCommandInput = {
    TableName: table,
    Key: { PK: pk, SK: sk },
  }
  const { Item } = await ddb.send(new GetCommand(input))
  return Item as Record<string, unknown> | undefined
}

export async function dbPut(
  table: string,
  item: Record<string, unknown>,
): Promise<void> {
  const input: PutCommandInput = { TableName: table, Item: item }
  await ddb.send(new PutCommand(input))
}

export async function dbQuery(
  table: string,
  pk: string,
  skPrefix?: string,
): Promise<Record<string, unknown>[]> {
  const input: QueryCommandInput = {
    TableName: table,
    KeyConditionExpression: skPrefix
      ? 'PK = :pk AND begins_with(SK, :skp)'
      : 'PK = :pk',
    ExpressionAttributeValues: skPrefix
      ? { ':pk': pk, ':skp': skPrefix }
      : { ':pk': pk },
  }
  const { Items } = await ddb.send(new QueryCommand(input))
  return (Items ?? []) as Record<string, unknown>[]
}

export async function dbQueryGsi1(
  table: string,
  type: string,
): Promise<Record<string, unknown>[]> {
  const input: QueryCommandInput = {
    TableName: table,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :type',
    ExpressionAttributeValues: { ':type': type },
  }
  const { Items } = await ddb.send(new QueryCommand(input))
  return (Items ?? []) as Record<string, unknown>[]
}

export async function dbDelete(
  table: string,
  pk: string,
  sk: string,
): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: table, Key: { PK: pk, SK: sk } }))
}
