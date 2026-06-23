// Client-side helpers for the workforce agent roster + live agents-api.
//   - build + cache the roster from the LIVE agents-api (ADR-0008 §7: the
//     console reads the authoritative DDB store, not a build-time snapshot —
//     the baked workforce-agents.json showed BINDINGS 0 for hours after a
//     live bindings PATCH)
//   - derive a deterministic HSL hue from a slug (for procedural avatars)
//   - fetch live agent record / deliverables from wf-agents-api

import type { WorkforceAgent, WorkforceAgentManifest } from '../types/agent'
import type { WorkforceMockStats } from '../types/stats'
import { withBasePath } from './paths'
import { WORKFORCE_AGENTS_API_BASE } from '../config/api'

// The roster read MUST work even when the build-time env var is unset
// (bare gh-pages / local dev without env): fall back to the stable custom
// domain (ADR-0004), which is public read.
const ROSTER_API_BASE =
  WORKFORCE_AGENTS_API_BASE.length > 0
    ? WORKFORCE_AGENTS_API_BASE
    : 'https://workforce-api.kohuehara.xyz'

/** Lean agent record as returned by `GET /agents` (list view: persona
 *  prompt + profile decks stripped server-side; `about` derived there). */
interface AgentListItem {
  slug: string
  first_name: string
  last_name: string
  residence: string
  role: string
  model: string
  prompt_version: string
  budget_monthly_usd_default: number
  default_project: string
  streams: WorkforceAgent['streams']
  bindings: WorkforceAgent['bindings']
  created_at: string
  about?: string
  reports_to?: string[]
  lateral?: string[]
}

/** Detail record from `GET /agents/{slug}` — adds the profile decks the
 *  list view strips. */
interface AgentDetailItem extends AgentListItem {
  jd?: WorkforceAgent['jd'] | null
  identity?: WorkforceAgent['identity'] | null
  experience?: WorkforceAgent['experience'] | null
  memory?: WorkforceAgent['memory'] | null
}

/** Derive each agent's org depth from reports_to: 0 for roots, 1 + min
 *  parent depth otherwise. Same derivation build-agent-manifest.mjs uses,
 *  with one divergence: a dangling/cyclic edge degrades that node to a
 *  root with a console.warn instead of throwing — bricking the console is
 *  the wrong failure mode for the surface the operator needs in order to
 *  SEE a broken graph (the weekly config digest carries the loud alarm,
 *  FU-022). */
function deriveOrg(items: AgentListItem[]): WorkforceAgent[] {
  const bySlug = new Map(items.map((a) => [a.slug, a]))
  const depths = new Map<string, number>()
  for (const a of items) {
    if (!a.reports_to || a.reports_to.length === 0) depths.set(a.slug, 0)
  }
  let progressed = true
  while (progressed) {
    progressed = false
    for (const a of items) {
      if (depths.has(a.slug)) continue
      const parentDepths = (a.reports_to ?? [])
        .filter((p) => bySlug.has(p))
        .map((p) => depths.get(p))
        .filter((d): d is number => d !== undefined)
      if (parentDepths.length > 0) {
        depths.set(a.slug, 1 + Math.min(...parentDepths))
        progressed = true
      }
    }
  }
  const directReports = new Map<string, string[]>(items.map((a) => [a.slug, []]))
  for (const a of items) {
    for (const p of a.reports_to ?? []) {
      directReports.get(p)?.push(a.slug)
    }
  }
  return items.map((a) => {
    if (!depths.has(a.slug)) {
      console.warn(
        `workforce roster: unresolvable reports_to for "${a.slug}" (cycle or dangling edge) — rendering as root`,
      )
    }
    return {
      slug: a.slug,
      first_name: a.first_name,
      last_name: a.last_name,
      residence: a.residence,
      role: a.role,
      model: a.model,
      prompt_version: a.prompt_version,
      budget_monthly_usd: a.budget_monthly_usd_default,
      default_project: a.default_project,
      streams: a.streams,
      bindings: a.bindings ?? [],
      created_at: a.created_at,
      about: a.about ?? '',
      depth: depths.get(a.slug) ?? 0,
      reports_to: a.reports_to ?? [],
      direct_reports: (directReports.get(a.slug) ?? []).sort(),
      lateral: a.lateral ?? [],
    }
  })
}

let cache: Promise<WorkforceAgentManifest> | null = null

export function loadWorkforceManifest(): Promise<WorkforceAgentManifest> {
  if (!cache) {
    cache = (async () => {
      const items: AgentListItem[] = []
      let cursor: string | undefined
      do {
        const qs = new URLSearchParams({ page_size: '100' })
        if (cursor) qs.set('cursor', cursor)
        const res = await fetch(`${ROSTER_API_BASE}/agents?${qs}`)
        if (!res.ok) throw new Error(`failed to load live agent roster (${res.status})`)
        const page = (await res.json()) as { items: AgentListItem[]; next_cursor?: string }
        items.push(...(page.items ?? []))
        cursor = page.next_cursor
      } while (cursor)
      if (items.length === 0) {
        // C-4 moved from build-time (red build) to render-time: an empty
        // roster is an error state, never a silently empty directory.
        throw new Error('live agent roster returned 0 agents — refusing to render an empty workforce')
      }
      const manifest: WorkforceAgentManifest = {
        generated_at: new Date().toISOString(),
        agents: deriveOrg(items).sort((a, b) => a.slug.localeCompare(b.slug)),
      }
      return manifest
    })().catch((err) => {
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

/**
 * Dashboard aggregate stats. Prefers the live agents-api `GET /stats`
 * endpoint (real EXEC-ledger roll-up: runs/deliv MTD, 30-day heat strip,
 * live-trace ribbon, run-duration KPI) and falls back to the static mock
 * JSON only when the API base is unconfigured (e.g. local `npm run dev`
 * without env, or a bare gh-pages build). A non-OK live response throws —
 * fail loud rather than silently serving stale mock figures over a real
 * deployment.
 */
export async function loadWorkforceStats(): Promise<WorkforceMockStats> {
  if (!apiConfigured()) return loadWorkforceMockStats()
  const res = await fetch(`${WORKFORCE_AGENTS_API_BASE}/stats`)
  if (!res.ok) throw new Error(`failed to load /stats (${res.status})`)
  return (await res.json()) as WorkforceMockStats
}

export async function findAgent(slug: string): Promise<WorkforceAgent | undefined> {
  const m = await loadWorkforceManifest()
  const base = m.agents.find((a) => a.slug === slug)
  if (!base) return undefined
  // Hydrate the profile decks (jd / identity / experience / memory) from
  // the detail route — the list view strips them to stay lean. A failed
  // hydration degrades to the lean record (the decks render null-safe)
  // rather than failing the whole profile page.
  try {
    const res = await fetch(`${ROSTER_API_BASE}/agents/${encodeURIComponent(slug)}`)
    if (!res.ok) {
      console.warn(`workforce roster: profile hydration for "${slug}" degraded (HTTP ${res.status}) — rendering the lean record without decks`)
      return base
    }
    const d = (await res.json()) as AgentDetailItem
    return {
      ...base,
      about: d.about ?? base.about,
      jd: d.jd ?? undefined,
      identity: d.identity ?? undefined,
      experience: d.experience ?? undefined,
      memory: d.memory ?? undefined,
    }
  } catch (err) {
    console.warn(`workforce roster: profile hydration for "${slug}" degraded (${err instanceof Error ? err.message : String(err)}) — rendering the lean record without decks`)
    return base
  }
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

// ----- Binding writes (ADR-0007: bindings are identity config on the
// AGENT row; PATCH replaces the whole array — append-only edits keep
// binding_idx stable for in-flight fires) -----

/** Error carrying the agents-api 422 violation list so the editor can
 *  render rule-level feedback instead of a generic failure line. */
export class BindingPatchError extends Error {
  constructor(
    message: string,
    public readonly violations: Array<{ rule: string; field: string; msg: string }> = [],
  ) {
    super(message)
  }
}

/** PATCH the agent's full bindings[] via the SigV4 broker. Returns the
 *  server's post-write bindings (authoritative — write = live). */
export async function patchAgentBindings(
  slug: string,
  bindings: WorkforceAgent['bindings'],
): Promise<WorkforceAgent['bindings']> {
  const { signedFetch } = await import('./sigv4')
  const res = await signedFetch(`${ROSTER_API_BASE}/agents/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bindings }),
  })
  const json = (await res.json().catch(() => ({}))) as {
    bindings?: WorkforceAgent['bindings']
    error?: string
    violations?: Array<{ rule: string; field: string; msg: string }>
  }
  if (!res.ok) {
    throw new BindingPatchError(
      json.error === 'config_validation_failed'
        ? 'Validation failed'
        : `agents-api ${res.status}${json.error ? ` (${json.error})` : ''}`,
      json.violations ?? [],
    )
  }
  return json.bindings ?? bindings
}

/** Skills this agent may bind. Since adr-0012 binding is decoupled from
 *  ownership: any agent may bind any *active* skill, so this returns the
 *  full active-skill list (no `?owner=` filter). Public read; used to
 *  populate the add-binding picker. */
export async function fetchBindableSkills(): Promise<string[]> {
  const res = await fetch(`${ROSTER_API_BASE}/skills?status=active&page_size=100`)
  if (!res.ok) throw new Error(`agents-api ${res.status}`)
  const data = (await res.json()) as { items: Array<{ name: string; status: string }> }
  return data.items.filter((s) => s.status === 'active').map((s) => s.name)
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

export async function fetchAgentLive(slug: string): Promise<AgentLiveRecord | undefined> {
  if (!apiConfigured()) return undefined
  const res = await fetch(`${WORKFORCE_AGENTS_API_BASE}/agents/${encodeURIComponent(slug)}`)
  if (res.status === 404) return undefined
  if (!res.ok) throw new Error(`agents-api ${res.status}`)
  return (await res.json()) as AgentLiveRecord
}

// Epic-010 C3 (read) + C2 (cutover) — the agent-profile execution-
// history list reads from the EXEC row family (PROJECT#{id}/EXEC# via
// the GSI1 AGENT#{slug} partition). The legacy fetchAgentDeliverables
// + AgentDeliverable interface that targeted AGENT#{slug}/DELIV# were
// removed in C2 (no callers since C3); the backend GET
// /agents/{slug}/deliverables route is retained for historical reads
// of pre-cutover DELIV rows but is no longer consumed by this SPA.
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
  /** Free-text business summary of the engagement (top-level, distinct from
   *  artifact_ref.summary). Preferred over artifact_ref.summary for display;
   *  absent on pre-2026-06-13 rows. */
  summary?: string
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
