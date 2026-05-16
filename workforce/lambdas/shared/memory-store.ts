/**
 * Managed-Agents-shape memory filesystem over DDB + S3.
 *
 * DDB (MemoryTable): index of every memory entry — fast lookups by agent+path.
 * S3 (workforce bucket, prefix "memory/"): full content of large blobs.
 * Small entries (<= 8 KB) are stored inline in DDB. Larger ones spill to S3.
 *
 * Concurrency model: optimistic via `memver` (a monotonically incrementing
 * integer stored in DDB). `memWrite` performs a conditional PutItem that rejects
 * if the caller's `memver` doesn't match the stored value, preventing
 * lost-update races when two Lambda invocations write the same path.
 */

import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb'
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { ddb, MEMORY_TABLE } from './ddb.js'
import { s3Put, s3Get } from './s3.js'

const INLINE_LIMIT = 8 * 1024 // 8 KB

export interface MemoryEntry {
  path: string
  content: string
  memver: number
  updatedAt: string
}

function memKey(slug: string, path: string) {
  return { PK: `AGENT#${slug}`, SK: `PATH#${path}` }
}

function s3Key(slug: string, path: string) {
  return `memory/${slug}/${path}`
}

export async function memRead(
  slug: string,
  path: string,
): Promise<MemoryEntry | undefined> {
  const { Item } = await ddb.send(
    new GetCommand({ TableName: MEMORY_TABLE, Key: memKey(slug, path) }),
  )

  if (!Item) return undefined
  const row = Item as Record<string, unknown>

  let content: string
  if (row.s3Spill) {
    content = (await s3Get(s3Key(slug, path))) ?? ''
  } else {
    content = (row.content as string) ?? ''
  }

  return {
    path,
    content,
    memver: (row.memver as number) ?? 0,
    updatedAt: (row.updatedAt as string) ?? '',
  }
}

export async function memWrite(
  slug: string,
  path: string,
  content: string,
  expectedMemver: number,
): Promise<number> {
  const now = new Date().toISOString()
  const nextMemver = expectedMemver + 1
  const keys = memKey(slug, path)
  const spill = Buffer.byteLength(content, 'utf8') > INLINE_LIMIT

  if (spill) {
    await s3Put(s3Key(slug, path), content)
  }

  const item: Record<string, unknown> = {
    ...keys,
    memver: nextMemver,
    updatedAt: now,
    s3Spill: spill,
    ...(spill ? {} : { content }),
  }

  const condExpr =
    expectedMemver === 0
      ? 'attribute_not_exists(PK)'
      : 'memver = :expected'

  try {
    await ddb.send(
      new PutCommand({
        TableName: MEMORY_TABLE,
        Item: item,
        ConditionExpression: condExpr,
        ExpressionAttributeValues:
          expectedMemver === 0 ? undefined : { ':expected': expectedMemver },
      }),
    )
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      throw new Error(
        `memWrite conflict: AGENT#${slug} PATH#${path} memver mismatch (expected ${expectedMemver})`,
      )
    }
    throw err
  }

  return nextMemver
}

export async function memList(slug: string): Promise<string[]> {
  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: MEMORY_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skp)',
      ExpressionAttributeValues: {
        ':pk': `AGENT#${slug}`,
        ':skp': 'PATH#',
      },
    }),
  )

  return ((Items ?? []) as Record<string, unknown>[]).map(
    (row) => (row.SK as string).replace(/^PATH#/, ''),
  )
}
