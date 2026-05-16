/**
 * Load a SKILL.md from S3 and parse its openclaw frontmatter + body.
 *
 * SKILL.md shape:
 *   ---
 *   name: retro-summarizer
 *   description: "..."
 *   version: "0.1.0"
 *   metadata:
 *     openclaw:
 *       triggers: [...]
 *       output_schema: {...}
 *   ---
 *   <body markdown>
 */

import { s3Get } from './s3.js'

export interface OpenclawMeta {
  triggers?: string[]
  output_schema?: Record<string, unknown>
}

export interface SkillFrontmatter {
  name: string
  description: string
  version: string
  metadata?: { openclaw?: OpenclawMeta }
}

export interface Skill extends SkillFrontmatter {
  body: string
  s3Key: string
}

/** Minimal YAML-subset parser for frontmatter (scalar strings + lists). */
function parseFrontmatter(raw: string): SkillFrontmatter {
  const lines = raw.split('\n')
  const result: Record<string, unknown> = {}
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const scalar = line.match(/^(\w+):\s+"?([^"]+)"?\s*$/)
    if (scalar) {
      result[scalar[1]] = scalar[2].trim()
      i++
      continue
    }
    const nested = line.match(/^(\w+):\s*$/)
    if (nested && i + 1 < lines.length && lines[i + 1].startsWith('  ')) {
      // Skip nested blocks — openclaw metadata is not needed for routing
      result[nested[1]] = {}
      while (i + 1 < lines.length && lines[i + 1].startsWith('  ')) i++
    }
    i++
  }
  return result as unknown as SkillFrontmatter
}

export async function loadSkill(skillName: string): Promise<Skill | undefined> {
  const key = `skills/${skillName}/SKILL.md`
  const raw = await s3Get(key)
  if (!raw) return undefined

  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!fmMatch) return undefined

  const frontmatter = parseFrontmatter(fmMatch[1])
  const body = fmMatch[2].trim()

  return { ...frontmatter, body, s3Key: key }
}

export async function loadSkillRaw(s3Key: string): Promise<string | undefined> {
  return s3Get(s3Key)
}
