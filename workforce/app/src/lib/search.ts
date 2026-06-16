// Shared, pure search/ranking for the global nav search box (Epic-014).
//
// One ranking implementation, two consumers: the GlobalNav typeahead
// dropdown (top-N) and the /search results page (full list). Keeping the
// match + score logic here — instead of duplicating an ad-hoc
// `.filter(s => s.name.includes(q))` per surface, the way AgentDirectory
// and SkillDirectory each grew their own — means the two surfaces always
// agree on what "matches" and in what order, and the ranking is unit-
// testable without rendering React.
//
// Ranking is deliberately simple (no index, no fuzzy/embedding): a tiered
// substring match weighted by field importance. Epic-014 §"Behaviour at
// N = 100+" covers when this needs an inverted index (N > ~200).

import type { WorkforceAgent } from '../types/agent'
import type { WorkforceSkill } from '../types/skill'
import { fullName } from './agents'

/** Why a row matched — surfaced in the UI so a result for "engineer"
 *  explains itself ("role · Engineer") rather than appearing unexplained. */
export type MatchField =
  | 'slug'
  | 'name'
  | 'role'
  | 'residence'
  | 'about'
  | 'skill'
  | 'description'
  | 'owner'

export interface AgentHit {
  agent: WorkforceAgent
  score: number
  /** The field that produced the winning score. */
  matchedOn: MatchField
}

export interface SkillHit {
  skill: WorkforceSkill
  score: number
  matchedOn: MatchField
}

// Match tiers, strongest first. A field's contribution is tier × weight;
// a row's score is the max over its fields (so a name hit isn't diluted by
// the fields that didn't match). Tiers are spaced so a weak hit on a
// strong field (name substring, 40×1.0=40) still outranks a strong hit on
// a weak field (about prefix, 70×0.35=24.5) — name identity dominates.
const TIER_EXACT = 100
const TIER_PREFIX = 70
const TIER_WORD_PREFIX = 55 // any whitespace-delimited token starts with q
const TIER_SUBSTRING = 40

/** Score a single field value against the (already normalised) query.
 *  Returns 0 when there is no match. */
function tier(haystack: string, q: string): number {
  const h = haystack.toLowerCase()
  if (!h) return 0
  if (h === q) return TIER_EXACT
  if (h.startsWith(q)) return TIER_PREFIX
  if (h.split(/\s+/).some((tok) => tok.startsWith(q))) return TIER_WORD_PREFIX
  if (h.includes(q)) return TIER_SUBSTRING
  return 0
}

// Field weights: identity (slug/name) dominates, then the descriptive
// fields a searcher is likely typing ("engineer", "dublin"), then prose.
const AGENT_FIELDS: { field: MatchField; get: (a: WorkforceAgent) => string; weight: number }[] = [
  { field: 'slug', get: (a) => a.slug, weight: 1.0 },
  { field: 'name', get: (a) => fullName(a), weight: 1.0 },
  { field: 'role', get: (a) => a.role, weight: 0.8 },
  { field: 'residence', get: (a) => a.residence, weight: 0.5 },
  { field: 'about', get: (a) => a.about, weight: 0.35 },
]

const SKILL_FIELDS: { field: MatchField; get: (s: WorkforceSkill) => string; weight: number }[] = [
  { field: 'skill', get: (s) => s.name, weight: 1.0 },
  { field: 'description', get: (s) => s.description, weight: 0.45 },
  // owners handled separately (array) below.
]

/** Normalise a raw query: trim + lowercase. Returns '' for blank input. */
export function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase()
}

/** Rank agents against `query`. Empty/blank query → []. Sorted by score
 *  desc, then by slug for a stable, deterministic order. */
export function searchAgents(agents: WorkforceAgent[], query: string): AgentHit[] {
  const q = normalizeQuery(query)
  if (!q) return []
  const hits: AgentHit[] = []
  for (const agent of agents) {
    let best = 0
    let matchedOn: MatchField = 'name'
    for (const { field, get, weight } of AGENT_FIELDS) {
      const score = tier(get(agent), q) * weight
      if (score > best) {
        best = score
        matchedOn = field
      }
    }
    if (best > 0) hits.push({ agent, score: best, matchedOn })
  }
  return hits.sort((a, b) => b.score - a.score || a.agent.slug.localeCompare(b.agent.slug))
}

/** Rank skills against `query`. Owners match too (so "ren" surfaces the
 *  skills Ren owns), at the role weight tier. */
export function searchSkills(skills: WorkforceSkill[], query: string): SkillHit[] {
  const q = normalizeQuery(query)
  if (!q) return []
  const hits: SkillHit[] = []
  for (const skill of skills) {
    let best = 0
    let matchedOn: MatchField = 'skill'
    for (const { field, get, weight } of SKILL_FIELDS) {
      const score = tier(get(skill), q) * weight
      if (score > best) {
        best = score
        matchedOn = field
      }
    }
    // Owners are an array — score the best-matching owner slug, weighted
    // like a role hit (an owner is "who does this", not the skill itself).
    for (const owner of skill.owners) {
      const score = tier(owner, q) * 0.8
      if (score > best) {
        best = score
        matchedOn = 'owner'
      }
    }
    if (best > 0) hits.push({ skill, score: best, matchedOn })
  }
  return hits.sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
}
