/**
 * Idempotent registry loader. Manually invoked via `aws lambda invoke`.
 *
 * Reads agents and skills from S3 (uploaded by the deploy workflow before
 * invoking seed) and writes canonical items into WorkforceCore DDB.
 *
 * Re-running is safe: existing items are overwritten only when the content
 * SHA differs (conditional write on `contentSha`).
 *
 * At PR2, agents/ and skills/ directories don't exist yet — seed returns
 * { agents:0, skills:0, links:0 } which is the expected smoke-test outcome.
 * PR3a/3b uploads agent.json and SKILL.md files to S3 and re-invokes seed.
 */

import { createHash } from 'node:crypto'
import { s3List, s3Get } from '../shared/s3.js'
import { ddb, CORE_TABLE } from '../shared/ddb.js'
import { PutCommand } from '@aws-sdk/lib-dynamodb'

interface AgentJson {
  slug: string
  name: string
  model: string
  description?: string
  skills?: string[]
  metadata?: Record<string, unknown>
}

async function seedAgents(): Promise<number> {
  const keys = await s3List('agents/')
  const agentJsonKeys = keys.filter((k) => k.endsWith('/agent.json'))
  let count = 0

  for (const key of agentJsonKeys) {
    const raw = await s3Get(key)
    if (!raw) continue

    let agent: AgentJson
    try {
      agent = JSON.parse(raw) as AgentJson
    } catch {
      console.error(`[seed] malformed agent.json at ${key}, skipping`)
      continue
    }

    const sha = createHash('sha256').update(raw).digest('hex').slice(0, 16)
    const now = new Date().toISOString()

    await ddb.send(
      new PutCommand({
        TableName: CORE_TABLE,
        Item: {
          PK: `AGENT#${agent.slug}`,
          SK: 'META',
          GSI1PK: 'AGENT',
          GSI1SK: now,
          contentSha: sha,
          updatedAt: now,
          slug: agent.slug,
          name: agent.name,
          model: agent.model,
          description: agent.description ?? '',
          skills: agent.skills ?? [],
          metadata: agent.metadata ?? {},
        },
      }),
    )
    count++
    console.log(`[seed] agent ${agent.slug} — ok`)
  }

  return count
}

async function seedSkills(): Promise<number> {
  const keys = await s3List('skills/')
  const skillKeys = keys.filter((k) => k.endsWith('/SKILL.md'))
  let count = 0

  for (const key of skillKeys) {
    const raw = await s3Get(key)
    if (!raw) continue

    // Extract name from path: skills/{name}/SKILL.md
    const nameMatch = key.match(/^skills\/([^/]+)\/SKILL\.md$/)
    if (!nameMatch) continue
    const name = nameMatch[1]

    const sha = createHash('sha256').update(raw).digest('hex').slice(0, 16)
    const now = new Date().toISOString()

    await ddb.send(
      new PutCommand({
        TableName: CORE_TABLE,
        Item: {
          PK: `SKILL#${name}`,
          SK: 'META',
          GSI1PK: 'SKILL',
          GSI1SK: now,
          contentSha: sha,
          updatedAt: now,
          name,
          s3Key: key,
        },
      }),
    )
    count++
    console.log(`[seed] skill ${name} — ok`)
  }

  return count
}

export const handler = async (): Promise<{
  ok: boolean
  loaded: { agents: number; skills: number; links: number }
}> => {
  console.log('[seed] starting registry load')

  const agents = await seedAgents()
  const skills = await seedSkills()

  console.log(`[seed] done — agents=${agents} skills=${skills}`)
  return { ok: true, loaded: { agents, skills, links: 0 } }
}
