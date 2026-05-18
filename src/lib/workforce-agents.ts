// Client-side helpers for the workforce agent manifest.
//   - fetch + cache the static /workforce-agents.json
//   - derive a deterministic HSL hue from a slug (for procedural avatars)

import type { WorkforceAgent, WorkforceAgentManifest } from '../types/workforce-agent'
import { withBasePath } from './paths'

let cache: Promise<WorkforceAgentManifest> | null = null

export function loadWorkforceManifest(): Promise<WorkforceAgentManifest> {
  if (!cache) {
    cache = fetch(withBasePath('/workforce-agents.json'))
      .then((res) => {
        if (!res.ok) throw new Error(`failed to load workforce-agents.json (${res.status})`)
        return res.json() as Promise<WorkforceAgentManifest>
      })
      .catch((err) => {
        cache = null
        throw err
      })
  }
  return cache
}

export async function findAgent(slug: string): Promise<WorkforceAgent | undefined> {
  const m = await loadWorkforceManifest()
  return m.agents.find((a) => a.slug === slug)
}

/**
 * Deterministic HSL hue derived from the slug. Used for the procedural
 * avatar background — same slug always yields the same colour.
 *
 * Resolution is PR #28's fix: no per-agent SVG asset; render from data.
 */
export function slugHue(slug: string): number {
  let h = 7
  for (let i = 0; i < slug.length; i++) {
    h = (h * 31 + slug.charCodeAt(i)) >>> 0
  }
  return h % 360
}

export function fullName(agent: Pick<WorkforceAgent, 'first_name' | 'last_name'>): string {
  return `${agent.first_name} ${agent.last_name}`
}
