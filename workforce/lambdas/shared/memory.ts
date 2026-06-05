// Agent memory model — S3 holds the chunks, DDB AGENT#{slug}/MEMORY#INDEX
// holds the pointer. Conditional write on `memver` prevents lost updates
// when two runs of the same agent overlap (rare but possible during
// recovery / retries).

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = process.env.TABLE_NAME;
const BUCKET_NAME = process.env.BUCKET_NAME;
if (!TABLE_NAME) throw new Error("TABLE_NAME env var is required");
if (!BUCKET_NAME) throw new Error("BUCKET_NAME env var is required");
const tableName: string = TABLE_NAME;
const bucketName: string = BUCKET_NAME;

const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export interface MemoryIndex {
  pk: `AGENT#${string}`;
  sk: "MEMORY#INDEX";
  memver: number;
  latest_chunk_key: string | null;
  summary_snippet: string;
  updated_at: string;
  /** Epic-012 Story 2: `memver` at which the last rolling-summary
   *  compaction landed. `memver - last_compacted_memver` is the number of
   *  run chunks accumulated since; when it crosses the threshold the
   *  compactor folds them into a new summary. Absent → never compacted. */
  last_compacted_memver?: number;
  /** S3 key of the latest rolling-summary chunk (the durable long-term
   *  memory). Equals `latest_chunk_key` right after a compaction; diverges
   *  as subsequent run chunks land on top. Absent → never compacted. */
  latest_summary_key?: string;
}

/** Deterministic S3 key for an agent's memory chunk at a given memver. */
export function chunkKey(slug: string, memver: number): string {
  return `memory/${slug}/v${String(memver).padStart(4, "0")}.md`;
}

export async function readIndex(slug: string): Promise<MemoryIndex | undefined> {
  const res = await ddb.send(
    new GetCommand({
      TableName: tableName,
      Key: { pk: `AGENT#${slug}`, sk: "MEMORY#INDEX" },
    }),
  );
  return res.Item as MemoryIndex | undefined;
}

export async function readChunk(s3key: string): Promise<string> {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: s3key }));
  if (!res.Body) throw new Error(`s3://${bucketName}/${s3key} has empty body`);
  return await res.Body.transformToString();
}

/**
 * Read the run chunks accumulated in `(fromExclusive, toInclusive]` — the
 * window the compactor folds into a rolling summary. Keys are deterministic
 * (`chunkKey`), so this is a plain per-memver GetObject fan-out. A chunk that
 * 404s (e.g. a gap from an out-of-band delete) is skipped, not fatal — the
 * compaction is best-effort over whatever history survives.
 */
export async function readChunksSince(
  slug: string,
  fromExclusive: number,
  toInclusive: number,
): Promise<string[]> {
  const out: string[] = [];
  for (let v = fromExclusive + 1; v <= toInclusive; v++) {
    try {
      out.push(await readChunk(chunkKey(slug, v)));
    } catch {
      // Missing chunk — skip. History is append-only and cheap; a hole is
      // an anomaly worth tolerating rather than failing the whole sweep.
    }
  }
  return out;
}

export interface MemoryAppendResult {
  newKey: string;
  newMemver: number;
}

/**
 * Commit a rolling-summary compaction (Epic-012 Story 2). Writes the summary
 * as the next memory chunk so the runner's "previous memory" read naturally
 * picks up the durable long-term memory, and records the compaction
 * bookkeeping (`last_compacted_memver`, `latest_summary_key`). Conditional on
 * `memver = :expected` so a run that appended a chunk mid-compaction fails
 * the write loudly (W-4) instead of clobbering it.
 */
export async function commitCompaction(
  slug: string,
  summaryBody: string,
  summary_snippet: string,
  expectedMemver: number,
): Promise<MemoryAppendResult> {
  const newMemver = expectedMemver + 1;
  const newKey = chunkKey(slug, newMemver);

  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: newKey,
      Body: summaryBody,
      ContentType: "text/markdown; charset=utf-8",
    }),
  );

  const now = new Date().toISOString();
  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { pk: `AGENT#${slug}`, sk: "MEMORY#INDEX" },
      UpdateExpression:
        "SET memver = :new, latest_chunk_key = :k, latest_summary_key = :k, last_compacted_memver = :new, summary_snippet = :s, updated_at = :now",
      ConditionExpression: "memver = :expected",
      ExpressionAttributeValues: {
        ":new": newMemver,
        ":k": newKey,
        ":s": summary_snippet.slice(0, 512),
        ":now": now,
        ":expected": expectedMemver,
      },
    }),
  );

  return { newKey, newMemver };
}

/**
 * Append a new memory chunk for an agent. Conditional-writes the index
 * with `memver = :expected` so concurrent appends fail loudly (W-4)
 * instead of silently overwriting each other.
 */
export async function appendChunk(
  slug: string,
  chunkBody: string,
  summary_snippet: string,
  expectedMemver: number,
): Promise<MemoryAppendResult> {
  const newMemver = expectedMemver + 1;
  const newKey = `memory/${slug}/v${String(newMemver).padStart(4, "0")}.md`;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: newKey,
      Body: chunkBody,
      ContentType: "text/markdown; charset=utf-8",
    }),
  );

  const now = new Date().toISOString();
  await ddb.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { pk: `AGENT#${slug}`, sk: "MEMORY#INDEX" },
      UpdateExpression:
        "SET memver = :new, latest_chunk_key = :k, summary_snippet = :s, updated_at = :now",
      ConditionExpression:
        "attribute_not_exists(memver) OR memver = :expected",
      ExpressionAttributeValues: {
        ":new": newMemver,
        ":k": newKey,
        ":s": summary_snippet.slice(0, 512),
        ":now": now,
        ":expected": expectedMemver,
      },
    }),
  );

  return { newKey, newMemver };
}
