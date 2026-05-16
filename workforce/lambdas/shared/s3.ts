import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'

export const s3 = new S3Client({})
export const BUCKET = process.env.WORKFORCE_BUCKET ?? ''

export async function s3Get(key: string): Promise<string | undefined> {
  try {
    const { Body } = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    )
    if (!Body) return undefined
    return Body.transformToString()
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'NoSuchKey') return undefined
    throw err
  }
}

export async function s3Put(
  key: string,
  body: string,
  contentType = 'text/plain; charset=utf-8',
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
}

export async function s3Delete(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}

export async function s3List(prefix: string): Promise<string[]> {
  const keys: string[] = []
  let continuationToken: string | undefined

  do {
    const { Contents, NextContinuationToken } = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    )
    for (const obj of Contents ?? []) {
      if (obj.Key) keys.push(obj.Key)
    }
    continuationToken = NextContinuationToken
  } while (continuationToken)

  return keys
}
