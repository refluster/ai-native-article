// Client-side helpers for the workforce skill manifest + live skills API.
//
// Mirrors lib/agents.ts: fetch + cache the static /workforce-skills.json,
// and (when configured) hydrate per-skill detail from wf-agents-api so
// the SPA shows invocations_this_month / last_invoked_at without a
// redeploy of the static manifest.

import type {
  CostClass,
  SkillDeliverable,
  SkillLiveRecord,
  SkillStatus,
  WorkforceSkill,
  WorkforceSkillManifest,
} from '../types/skill'
import { withBasePath } from './paths'
import { WORKFORCE_AGENTS_API_BASE } from '../config/api'

// The list read MUST work even when the build-time env var is unset (bare
// gh-pages / local dev without env): fall back to the stable custom domain
// (ADR-0004), which is public read. Mirrors ROSTER_API_BASE in lib/agents.ts.
const SKILLS_API_BASE =
  WORKFORCE_AGENTS_API_BASE.length > 0
    ? WORKFORCE_AGENTS_API_BASE
    : 'https://workforce-api.kohuehara.xyz'

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

/** Skill record as returned by `GET /skills` (list view). Carries the
 *  judgment-side fields, which are DDB-authoritative (ADR-0008). The
 *  git-owned `files[]` are NOT returned here — the per-skill source viewer
 *  (SkillProfile) still hydrates those from the static manifest, because
 *  the write-scripts / meta.json are code artefacts, not DDB state. */
interface SkillListItem {
  name: string
  version: string
  status: SkillStatus
  description: string
  deliverable: SkillDeliverable | null
  cost_class: CostClass
  owners: string[]
  improvement_agent: string | null
  created_at: string
}

let listCache: Promise<WorkforceSkill[]> | null = null

/**
 * Load the skill repository list LIVE from the agents-api (ADR-0008 §7: the
 * console reads the authoritative DDB `SKILL#` store, not the build-time
 * workforce-skills.json snapshot). A newly-seeded skill appears the moment
 * its `SKILL#` row exists — no console redeploy, and none of the stale-
 * snapshot class of bug that hid a freshly-merged skill from this page.
 *
 * Mirrors loadWorkforceManifest in lib/agents.ts: paginate the public read,
 * fall back to the custom domain when the env var is unset, and throw on an
 * empty result (C-4 at render time — an empty repository is an error state,
 * never a silently empty directory). `files[]` is empty in this shape.
 */
export function loadWorkforceSkills(): Promise<WorkforceSkill[]> {
  if (!listCache) {
    listCache = (async () => {
      const items: SkillListItem[] = []
      let cursor: string | undefined
      do {
        const qs = new URLSearchParams({ page_size: '100' })
        if (cursor) qs.set('cursor', cursor)
        const res = await fetch(`${SKILLS_API_BASE}/skills?${qs}`)
        if (!res.ok) throw new Error(`failed to load live skill repository (${res.status})`)
        const page = (await res.json()) as { items: SkillListItem[]; next_cursor?: string }
        items.push(...(page.items ?? []))
        cursor = page.next_cursor
      } while (cursor)
      if (items.length === 0) {
        throw new Error('live skill repository returned 0 skills — refusing to render an empty directory')
      }
      return items
        .map<WorkforceSkill>((s) => ({
          name: s.name,
          version: s.version,
          status: s.status,
          deliverable: s.deliverable ?? null,
          cost_class: s.cost_class,
          owners: s.owners ?? [],
          improvement_agent: s.improvement_agent ?? null,
          created_at: s.created_at,
          description: s.description ?? '',
          files: [],
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    })().catch((err) => {
      listCache = null
      throw err
    })
  }
  return listCache
}

export const apiConfigured = (): boolean => WORKFORCE_AGENTS_API_BASE.length > 0

export async function fetchSkillLive(name: string): Promise<SkillLiveRecord | undefined> {
  if (!apiConfigured()) return undefined
  const res = await fetch(`${WORKFORCE_AGENTS_API_BASE}/skills/${encodeURIComponent(name)}`)
  if (res.status === 404) return undefined
  if (!res.ok) throw new Error(`agents-api ${res.status}`)
  return (await res.json()) as SkillLiveRecord
}
