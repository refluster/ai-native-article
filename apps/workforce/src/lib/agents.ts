// Client-side helpers for the workforce agent manifest + live agents-api.
//   - fetch + cache the static /workforce-agents.json (build-time manifest)
//   - derive a deterministic HSL hue from a slug (for procedural avatars)
//   - fetch live agent record / deliverables from wf-agents-api (when configured)

import type { WorkforceAgent, WorkforceAgentManifest } from '../types/agent'
import type { WorkforceMockStats } from '../types/stats'
import { withBasePath } from './paths'
import { WORKFORCE_AGENTS_API_BASE } from '../config/api'

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

let mockStatsCache: Promise<WorkforceMockStats> | null = null

/**
 * Loads the mock stats JSON used when the live agents-api is not
 * configured (e.g. gh-pages). When the API is wired up, prefer
 * fetchAgentLive over these mocks at the per-agent layer; the
 * Dashboard still uses these for the aggregate totals + heat strip
 * until a corresponding live endpoint exists.
 */
export function loadWorkforceMockStats(): Promise<WorkforceMockStats> {
  if (!mockStatsCache) {
    mockStatsCache = fetch(withBasePath('/workforce-mock-stats.json'))
      .then((res) => {
        if (!res.ok) throw new Error(`failed to load workforce-mock-stats.json (${res.status})`)
        return res.json() as Promise<WorkforceMockStats>
      })
      .catch((err) => {
        mockStatsCache = null
        throw err
      })
  }
  return mockStatsCache
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

// ----- Live agents-api client -----

export const apiConfigured = (): boolean => WORKFORCE_AGENTS_API_BASE.length > 0

/** Live stats + operational fields read from DDB via wf-agents-api. */
export interface AgentLiveRecord {
  slug: string
  first_name: string
  last_name: string
  role: string
  budget_monthly_usd_effective: number
  paused: boolean
  archived: boolean
  last_run_at?: string
  last_run_status?: 'ok' | 'throw' | 'dlq'
  runs_this_month: number
  cost_this_month_usd: number
  deliv_count_total: number
}

export interface AgentDeliverable {
  /** AGENT#{slug}/DELIV#{ulid} pk/sk; surfaced here for de-dupe + linking. */
  sk: string
  run_id: string
  type: 'article' | 'plan' | 'design-doc' | 'launch-plan' | 'pr' | 'notification'
  project_id: string
  notion_page_id?: string
  notion_page_url?: string
  pr_url?: string
  dispatch_branch?: string
  created_at: string
  published_at?: string
  status?: 'pending' | 'ok' | 'timeout'
}

export async function fetchAgentLive(slug: string): Promise<AgentLiveRecord | undefined> {
  if (!apiConfigured()) return undefined
  const res = await fetch(`${WORKFORCE_AGENTS_API_BASE}/agents/${encodeURIComponent(slug)}`)
  if (res.status === 404) return undefined
  if (!res.ok) throw new Error(`agents-api ${res.status}`)
  return (await res.json()) as AgentLiveRecord
}

export async function fetchAgentDeliverables(slug: string, limit = 20): Promise<AgentDeliverable[]> {
  if (!apiConfigured()) return []
  const url = `${WORKFORCE_AGENTS_API_BASE}/agents/${encodeURIComponent(slug)}/deliverables?limit=${limit}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`agents-api ${res.status}`)
  const data = (await res.json()) as { items: AgentDeliverable[] }
  return data.items
}

// Epic-010 C3: agent profile execution-history read path. Replaces
// fetchAgentDeliverables with the EXEC-row family (PROJECT#{id}/EXEC#
// via the GSI1 AGENT#{slug} partition). The legacy fetchAgentDeliverables
// stays until the dual-write cutover (C2); fetchAgentExecutions is the
// post-cutover canonical path.
export interface AgentExecution {
  /** ULID without the EXEC# prefix. */
  exec_ulid: string
  project_id: string
  agent_slug: string
  skill_name: string
  skill_version: string
  started_at: string
  ended_at: string
  status: 'ok' | 'throw' | 'skipped' | 'failed_artefact_redaction'
  used_credential_types?: string[]
  artifact_ref?: {
    uri: string
    content_hash: string
    content_type: string
    size_bytes: number
    summary: string
  }
  error?: string
}

export async function fetchAgentExecutions(slug: string, limit = 20): Promise<AgentExecution[]> {
  if (!apiConfigured()) return []
  const url = `${WORKFORCE_AGENTS_API_BASE}/agents/${encodeURIComponent(slug)}/executions?limit=${limit}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`agents-api ${res.status}`)
  const data = (await res.json()) as { items: AgentExecution[] }
  return data.items
}
