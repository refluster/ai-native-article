// Client-side helpers for the workforce skill manifest + live skills API.
//
// Mirrors lib/agents.ts: fetch + cache the static /workforce-skills.json,
// and (when configured) hydrate per-skill detail from wf-agents-api so
// the SPA shows invocations_this_month / last_invoked_at without a
// redeploy of the static manifest.

import type {
  SkillLiveRecord,
  WorkforceSkill,
  WorkforceSkillManifest,
} from '../types/skill'
import { withBasePath } from './paths'
import { WORKFORCE_AGENTS_API_BASE } from '../config/api'

let cache: Promise<WorkforceSkillManifest> | null = null

export function loadWorkforceSkillManifest(): Promise<WorkforceSkillManifest> {
  if (!cache) {
    cache = fetch(withBasePath('/workforce-skills.json'))
      .then((res) => {
        if (!res.ok) {
          throw new Error(`failed to load workforce-skills.json (${res.status})`)
        }
        return res.json() as Promise<WorkforceSkillManifest>
      })
      .catch((err) => {
        cache = null
        throw err
      })
  }
  return cache
}

export async function findSkill(name: string): Promise<WorkforceSkill | undefined> {
  const m = await loadWorkforceSkillManifest()
  return m.skills.find((s) => s.name === name)
}

export const apiConfigured = (): boolean => WORKFORCE_AGENTS_API_BASE.length > 0

export async function fetchSkillLive(name: string): Promise<SkillLiveRecord | undefined> {
  if (!apiConfigured()) return undefined
  const res = await fetch(`${WORKFORCE_AGENTS_API_BASE}/skills/${encodeURIComponent(name)}`)
  if (res.status === 404) return undefined
  if (!res.ok) throw new Error(`agents-api ${res.status}`)
  return (await res.json()) as SkillLiveRecord
}
