// Unit tests for lib/search — the ranking shared by the GlobalNav
// typeahead and the /search page (Epic-014 Story 1). Pure functions, no
// React, no network.

import { describe, expect, it } from 'vitest'
import { searchAgents, searchSkills, normalizeQuery } from './search'
import type { WorkforceAgent } from '../types/agent'
import type { WorkforceSkill } from '../types/skill'

function agent(partial: Partial<WorkforceAgent>): WorkforceAgent {
  return {
    slug: 'x',
    first_name: 'First',
    last_name: 'Last',
    residence: 'Nowhere',
    role: 'Role',
    model: 'claude-sonnet-4-6',
    prompt_version: '1.0.0',
    budget_monthly_usd: 5,
    default_project: 'self/x',
    streams: ['internal'],
    bindings: [],
    created_at: '2026-01-01',
    about: '',
    depth: 0,
    reports_to: [],
    direct_reports: [],
    lateral: [],
    ...partial,
  }
}

function skill(partial: Partial<WorkforceSkill>): WorkforceSkill {
  return {
    name: 'x',
    version: '1.0.0',
    status: 'active',
    deliverable: null,
    cost_class: 'small',
    owners: [],
    improvement_agent: null,
    created_at: '2026-01-01',
    description: '',
    files: [],
    ...partial,
  }
}

const ROSTER: WorkforceAgent[] = [
  agent({ slug: 'ren', first_name: 'Ren', last_name: 'Takahashi', role: 'Engineer', residence: 'Tokyo, JP' }),
  agent({ slug: 'dario', first_name: 'Dario', last_name: 'Bergström', role: 'VP Engineering Excellence', residence: 'Stockholm, SE' }),
  agent({ slug: 'farah', first_name: 'Farah', last_name: 'Ní Bhriain', role: 'Product QA / SRE', residence: 'Dublin, IE' }),
  agent({ slug: 'aoi', first_name: 'Aoi', last_name: 'Mori', role: 'Designer', residence: 'Kyoto, JP', about: 'Systems-first designer.' }),
]

const SKILLS: WorkforceSkill[] = [
  skill({ name: 'pr-review', description: 'Review a pull request across lenses.', owners: ['nadia', 'dario', 'ren', 'aoi'] }),
  skill({ name: 'pr-route', description: 'Route a PR to reviewer personas.', owners: ['nadia'] }),
  skill({ name: 'article-level2', description: 'Author an L2 explanation article.', owners: ['sora'] }),
]

describe('normalizeQuery', () => {
  it('trims and lowercases', () => {
    expect(normalizeQuery('  ReN  ')).toBe('ren')
  })
  it('returns empty string for blank', () => {
    expect(normalizeQuery('   ')).toBe('')
  })
})

describe('searchAgents', () => {
  it('returns [] for a blank query (no "match everything" surprise)', () => {
    expect(searchAgents(ROSTER, '')).toEqual([])
    expect(searchAgents(ROSTER, '   ')).toEqual([])
  })

  it('ranks an exact slug match first', () => {
    const hits = searchAgents(ROSTER, 'ren')
    expect(hits[0].agent.slug).toBe('ren')
    expect(hits[0].matchedOn).toBe('slug')
  })

  it('matches on role token ("engineer" finds the engineers)', () => {
    const slugs = searchAgents(ROSTER, 'engineer').map((h) => h.agent.slug)
    expect(slugs).toContain('ren')
    expect(slugs).toContain('dario')
    expect(slugs).not.toContain('aoi')
  })

  it('matches on full name and city', () => {
    expect(searchAgents(ROSTER, 'bhriain')[0].agent.slug).toBe('farah')
    expect(searchAgents(ROSTER, 'dublin')[0].agent.slug).toBe('farah')
  })

  it('an identity (name) substring outranks a prose (about) match', () => {
    // "designer" appears in aoi's role; "mori" is aoi's surname.
    const byName = searchAgents(ROSTER, 'mori')
    expect(byName[0].agent.slug).toBe('aoi')
    expect(byName[0].matchedOn).toBe('name')
  })

  it('ranks a stronger field tier above a weaker one (exact role > word-prefix role)', () => {
    // "ren" role is exactly "Engineer" (exact tier); "dario" is
    // "VP Engineering Excellence" (word-prefix tier) — ren must rank first.
    const hits = searchAgents(ROSTER, 'engineer')
    expect(hits[0].agent.slug).toBe('ren')
    expect(hits.findIndex((h) => h.agent.slug === 'ren'))
      .toBeLessThan(hits.findIndex((h) => h.agent.slug === 'dario'))
  })

  it('is deterministic: equal scores break ties by slug', () => {
    // Two agents with an identical "Engineer" role tie on score+tier, so
    // ordering must fall back to slug ('ada' before 'zed').
    const tiedRoster = [
      agent({ slug: 'zed', role: 'Engineer' }),
      agent({ slug: 'ada', role: 'Engineer' }),
    ]
    const slugs = searchAgents(tiedRoster, 'engineer').map((h) => h.agent.slug)
    expect(slugs).toEqual(['ada', 'zed'])
  })
})

describe('searchSkills', () => {
  it('returns [] for a blank query', () => {
    expect(searchSkills(SKILLS, '')).toEqual([])
  })

  it('ranks an exact name match first', () => {
    const hits = searchSkills(SKILLS, 'pr-review')
    expect(hits[0].skill.name).toBe('pr-review')
    expect(hits[0].matchedOn).toBe('skill')
  })

  it('prefix "pr-" surfaces both pr- skills', () => {
    const names = searchSkills(SKILLS, 'pr-').map((h) => h.skill.name)
    expect(names).toContain('pr-review')
    expect(names).toContain('pr-route')
  })

  it('matches on owner slug (skills "ren" owns)', () => {
    const hits = searchSkills(SKILLS, 'ren')
    expect(hits.map((h) => h.skill.name)).toContain('pr-review')
    expect(hits.find((h) => h.skill.name === 'pr-review')?.matchedOn).toBe('owner')
  })

  it('matches on description text', () => {
    const hits = searchSkills(SKILLS, 'explanation')
    expect(hits[0].skill.name).toBe('article-level2')
    expect(hits[0].matchedOn).toBe('description')
  })
})
