// Unit tests for the whole-org chart model.
//
// The layout rules that actually cost something when they break are all
// here rather than in the page: every agent appears exactly once, a
// second manager never duplicates a node, and a node that cannot be
// reached from a root surfaces instead of vanishing.

import { describe, it, expect } from 'vitest'
import {
  buildOrgChart,
  columnCountFor,
  estimateDivisionHeight,
  flattenDivision,
  matchesOrgQuery,
  packDivisions,
  type OrgDivision,
  type PackMetrics,
  type RailShape,
} from './orgTree'
import type { WorkforceAgent } from '../types/agent'

function agent(
  slug: string,
  reports_to: string[],
  depth: number,
  extra: Partial<WorkforceAgent> = {},
): WorkforceAgent {
  return {
    slug,
    first_name: slug[0].toUpperCase() + slug.slice(1),
    last_name: 'Doe',
    residence: 'Tokyo, JP',
    role: 'Role',
    model: 'anthropic:claude-sonnet-4-6',
    prompt_version: '0.1.0',
    budget_monthly_usd: 5,
    default_project: 'workforce-self',
    streams: ['internal'],
    bindings: [],
    created_at: '2026-01-01',
    about: '',
    depth,
    reports_to,
    direct_reports: [],
    lateral: [],
    ...extra,
  }
}

/** maya → (bea → sora), camille. */
const SIMPLE: WorkforceAgent[] = [
  agent('maya', [], 0),
  agent('bea', ['maya'], 1),
  agent('camille', ['maya'], 1),
  agent('sora', ['bea'], 2),
]

describe('buildOrgChart', () => {
  it('lifts roots out of the divisions and makes each root-child a division', () => {
    const model = buildOrgChart(SIMPLE)
    expect(model.roots.map((r) => r.slug)).toEqual(['maya'])
    expect(model.divisions.map((d) => d.key)).toEqual(['bea', 'camille'])
    expect(model.orphans).toEqual([])
  })

  it('places every agent exactly once', () => {
    const model = buildOrgChart(SIMPLE)
    const placed = [
      ...model.roots.map((r) => r.slug),
      ...[...model.divisions, ...model.orphans].flatMap((d) => d.rows.map((r) => r.agent.slug)),
    ]
    expect(placed.sort()).toEqual(['bea', 'camille', 'maya', 'sora'])
    expect(model.total).toBe(4)
  })

  it('orders divisions by head-count, largest first', () => {
    const model = buildOrgChart(SIMPLE)
    expect(model.divisions.map((d) => d.size)).toEqual([2, 1])
  })

  it('reports depth and level counts', () => {
    const model = buildOrgChart(SIMPLE)
    expect(model.levelCounts).toEqual([1, 2, 1])
    expect(model.divisions.find((d) => d.key === 'bea')!.depth).toBe(1)
    expect(model.divisions.find((d) => d.key === 'camille')!.depth).toBe(0)
  })

  it('nests grandchildren under their own parent, not the division lead', () => {
    const model = buildOrgChart(SIMPLE)
    const bea = model.divisions.find((d) => d.key === 'bea')!
    expect(bea.rows.map((r) => [r.agent.slug, r.level])).toEqual([
      ['bea', 0],
      ['sora', 1],
    ])
  })

  it('handles an org deeper than three levels', () => {
    const deep = [
      ...SIMPLE,
      agent('deepA', ['sora'], 3),
      agent('deepB', ['deepA'], 4),
    ]
    const model = buildOrgChart(deep)
    const bea = model.divisions.find((d) => d.key === 'bea')!
    expect(bea.rows.map((r) => r.level)).toEqual([0, 1, 2, 3])
    expect(bea.depth).toBe(3)
  })

  it('places a dual-reporting node once and names the secondary manager', () => {
    const dual = [...SIMPLE, agent('dual', ['sora', 'camille'], 2)]
    const model = buildOrgChart(dual)
    const rows = model.divisions.flatMap((d) => d.rows).filter((r) => r.agent.slug === 'dual')
    expect(rows).toHaveLength(1)
    // camille (depth 1) is shallower than sora (depth 2) → primary parent.
    expect(rows[0].alsoReportsTo).toEqual(['sora'])
    expect(model.divisions.find((d) => d.key === 'camille')!.size).toBe(2)
  })

  // Regression (wf:owen O1): deleting the `x.depth - y.depth` term from the
  // manager sort left every shipped fixture green, because in each one slug
  // order and depth order happened to agree. Here they disagree — `alpha`
  // sorts first but `zed` is shallower — so only the depth rule produces
  // this placement.
  it('places a dual-reporting node under the SHALLOWEST manager, not the first by slug', () => {
    const model = buildOrgChart([
      agent('root', [], 0),
      agent('zed', ['root'], 1),
      agent('alpha', ['zed'], 2),
      agent('kid', ['alpha', 'zed'], 3),
    ])
    const kid = model.divisions.flatMap((d) => d.rows).filter((r) => r.agent.slug === 'kid')
    expect(kid).toHaveLength(1)
    expect(kid[0].level).toBe(1)
    expect(kid[0].alsoReportsTo).toEqual(['alpha'])
  })

  // Regression (wf:dario D5): a roster row naming the same manager twice
  // rendered "⇄ also reports to camille, camille".
  it('de-duplicates repeated secondary managers', () => {
    const model = buildOrgChart([...SIMPLE, agent('dupe', ['bea', 'camille', 'camille'], 2)])
    const row = model.divisions
      .flatMap((d) => d.rows)
      .find((r) => r.agent.slug === 'dupe')!
    expect(row.alsoReportsTo).toEqual(['camille'])
  })

  // Regression (wf:dario D6): `depth` arrives over the wire and indexes an
  // array directly — one bad record used to mint hundreds of empty level
  // chips, and a negative one silently vanished from the tally.
  it('ignores out-of-range depths in the level tally without dropping the agent', () => {
    const model = buildOrgChart([
      agent('maya', [], 0),
      agent('huge', ['maya'], 400),
      agent('neg', ['maya'], -3),
    ])
    expect(model.levelCounts).toEqual([1])
    // Still placed and still counted in the roster total — only the tally
    // ignores them.
    expect(model.total).toBe(3)
    expect(model.divisions.map((d) => d.key).sort()).toEqual(['huge', 'neg'])
  })

  it('ignores reports_to entries that name an agent not on the roster', () => {
    const model = buildOrgChart([...SIMPLE, agent('ghosted', ['nobody'], 0)])
    // No resolvable manager → it is a root, not an orphan.
    expect(model.roots.map((r) => r.slug)).toEqual(['ghosted', 'maya'])
    expect(model.orphans).toEqual([])
  })

  // Regression (wf:owen O3): the orphan pass used to seed in slug order, so
  // a detached cluster whose downstream report sorted first shredded into
  // one card per node — the opposite of the "keeps its shape" promise. The
  // pass now climbs to the top of the component before seeding.
  it('keeps a detached cluster in one card regardless of slug order', () => {
    const model = buildOrgChart([
      agent('maya', [], 0),
      // `aa` sorts first but hangs off the zz↔yy cycle.
      agent('aa', ['zz'], 0),
      agent('yy', ['zz'], 0),
      agent('zz', ['yy'], 0),
    ])
    expect(model.orphans).toHaveLength(1)
    expect(model.orphans[0].rows.map((r) => r.agent.slug).sort()).toEqual(['aa', 'yy', 'zz'])
    expect(model.orphans[0].size).toBe(3)
  })

  // The seed walk's cycle guard is load-bearing: without it the walk does
  // not terminate. A hang is the wrong failure mode on a C-4 path, so the
  // walk carries a hard step bound that throws instead (wf:owen O13). This
  // asserts the bound is generous enough never to fire on a valid roster —
  // the throw itself is unreachable while the guard is intact.
  it('completes the orphan seed walk well inside its step bound', () => {
    // A 40-long chain hanging off a 2-cycle: the longest climb this shape
    // admits, and comfortably under `agents.length`.
    const chain = [agent('cyc1', ['cyc2'], 0), agent('cyc2', ['cyc1'], 0)]
    for (let i = 0; i < 40; i++) {
      chain.push(agent(`n${String(i).padStart(2, '0')}`, [i === 0 ? 'cyc1' : `n${String(i - 1).padStart(2, '0')}`], 0))
    }
    const model = buildOrgChart([agent('maya', [], 0), ...chain])
    const placed = [
      ...model.roots.map((r) => r.slug),
      ...[...model.divisions, ...model.orphans].flatMap((d) => d.rows.map((r) => r.agent.slug)),
    ]
    expect(placed).toHaveLength(model.total)
    expect(new Set(placed).size).toBe(model.total)
  })

  it('surfaces a reports_to cycle as an orphan division instead of dropping it', () => {
    const cyclic = [
      ...SIMPLE,
      agent('loopA', ['loopB'], 0),
      agent('loopB', ['loopA'], 0),
    ]
    const model = buildOrgChart(cyclic)
    expect(model.orphans).toHaveLength(1)
    expect(model.orphans[0].orphan).toBe(true)
    expect(model.orphans[0].rows.map((r) => r.agent.slug).sort()).toEqual(['loopA', 'loopB'])
    // Still counted — the chart never quietly shrinks the roster.
    const placed = [
      ...model.roots.map((r) => r.slug),
      ...[...model.divisions, ...model.orphans].flatMap((d) => d.rows.map((r) => r.agent.slug)),
    ]
    expect(placed).toHaveLength(model.total)
  })

  it('returns an empty model for an empty roster', () => {
    const model = buildOrgChart([])
    expect(model).toMatchObject({ roots: [], divisions: [], orphans: [], total: 0 })
  })
})

describe('flattenDivision', () => {
  it('draws a branch rail for a child with siblings below and a corner for the last', () => {
    const model = buildOrgChart([
      agent('root', [], 0),
      agent('lead', ['root'], 1),
      agent('first', ['lead'], 2),
      agent('last', ['lead'], 2),
    ])
    const rows = model.divisions[0].rows
    expect(rows.map((r) => r.railShapes)).toEqual([[], ['branch'], ['corner']])
  })

  it('continues an ancestor rail past a nested row only while siblings remain', () => {
    const model = buildOrgChart([
      agent('root', [], 0),
      agent('lead', ['root'], 1),
      agent('amid', ['lead'], 2),
      agent('zlast', ['lead'], 2),
      agent('kid', ['amid'], 3),
    ])
    const rows = model.divisions[0].rows
    expect(rows.map((r) => [r.agent.slug, r.railShapes])).toEqual([
      ['lead', []],
      ['amid', ['branch']],
      // `amid` still has `zlast` below it, so its column keeps its rail.
      ['kid', ['vertical', 'corner']],
      ['zlast', ['corner']],
    ])
  })

  it('gives the lead no rails', () => {
    const rows = flattenDivision({
      agent: agent('solo', [], 1),
      level: 0,
      children: [],
      alsoReportsTo: [],
    })
    expect(rows).toEqual([
      { agent: expect.objectContaining({ slug: 'solo' }), level: 0, railShapes: [], alsoReportsTo: [] },
    ])
  })
})

describe('columnCountFor', () => {
  it('fits as many columns as the width allows, counting the gaps', () => {
    // 5 × 236 + 4 × 12 = 1228 ≤ 1344; a 6th would need 1488.
    expect(columnCountFor(1344, 236, 12)).toBe(5)
    expect(columnCountFor(1488, 236, 12)).toBe(6)
  })

  it('never drops below one column, whatever the width', () => {
    expect(columnCountFor(200, 236, 12)).toBe(1)
    expect(columnCountFor(0, 236, 12)).toBe(1)
    expect(columnCountFor(Number.NaN, 236, 12)).toBe(1)
  })
})

describe('packDivisions', () => {
  const metrics: PackMetrics = {
    leadHeight: 60,
    rowHeight: 40,
    listPadding: 10,
    cardGap: 10,
    secondaryLineHeight: 14,
  }

  /** A division of `size` agents, without going through buildOrgChart. */
  const div = (key: string, size: number): OrgDivision => ({
    key,
    lead: agent(key, [], 1),
    rows: Array.from({ length: size }, (_, i) => ({
      agent: agent(`${key}-${i}`, [], 2),
      level: i === 0 ? 0 : 1,
      railShapes: [] as RailShape[],
      alsoReportsTo: [] as string[],
    })),
    size,
    depth: size > 1 ? 1 : 0,
    orphan: false,
  })

  it('estimates height from the member count', () => {
    expect(estimateDivisionHeight(div('a', 1), metrics)).toBe(70)
    expect(estimateDivisionHeight(div('a', 3), metrics)).toBe(60 + 10 + 80 + 10)
  })

  // Regression (wf:owen O4): every fixture hardcoded `alsoReportsTo: []`,
  // so the secondary-line term could be zeroed out with the suite green —
  // on the height model the whole FIT convergence rides on.
  it('adds a line of height per secondary reporting annotation', () => {
    const withSecondary = div('a', 3)
    withSecondary.rows[1].alsoReportsTo = ['x']
    withSecondary.rows[2].alsoReportsTo = ['y']
    expect(estimateDivisionHeight(withSecondary, metrics)).toBe(
      estimateDivisionHeight(div('a', 3), metrics) + 2 * metrics.secondaryLineHeight,
    )
  })

  // Regression (wf:dario D4): `Math.max(1, NaN)` is NaN and
  // `Math.floor(NaN)` is NaN, so the old clamp did not clamp and
  // `new Array(NaN)` threw RangeError. Unreachable from the page, but this
  // module is exported for other callers.
  it('falls back to one column on a non-finite column count', () => {
    const divisions = [div('a', 3), div('b', 2)]
    expect(packDivisions(divisions, Number.NaN, metrics)).toEqual([divisions])
    expect(packDivisions(divisions, Number.POSITIVE_INFINITY, metrics)).toEqual([divisions])
  })

  it('places every division exactly once across the columns', () => {
    const divisions = [div('a', 11), div('b', 7), div('c', 6), div('d', 4), div('e', 1)]
    const packed = packDivisions(divisions, 3, metrics)
    expect(packed).toHaveLength(3)
    expect(packed.flat().map((d) => d.key).sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('balances the columns rather than filling them in order', () => {
    const divisions = [div('big', 12), div('m1', 5), div('m2', 5), div('s', 1)]
    const packed = packDivisions(divisions, 2, metrics)
    const heights = packed.map((col) =>
      col.reduce((n, d) => n + estimateDivisionHeight(d, metrics), 0),
    )
    // Heights under `metrics`: big(12)=520, m1(5)=240, m2(5)=240, s(1)=70.
    // Naive in-order filling would put big+m1 (760) against m2+s (310); LPT
    // lands on 520 vs 550. The threshold is tight enough to fail either
    // packing mutation (wf:owen O5).
    expect(Math.abs(heights[0] - heights[1])).toBeLessThan(100)
  })

  it('collapses to a single column when asked for one or fewer', () => {
    const divisions = [div('a', 3), div('b', 2)]
    expect(packDivisions(divisions, 1, metrics)).toEqual([divisions])
    expect(packDivisions(divisions, 0, metrics)).toEqual([divisions])
  })

  // Regression (wf:dario D3): this used to return one bucket per requested
  // column whether or not it filled them, and every bucket claims an equal
  // width track — so a single card rendered at 1/7 of the row. The section
  // that suffered most was UNPLACED, whose entire purpose is to be
  // impossible to miss.
  it('never returns more columns than there are divisions to fill them', () => {
    expect(packDivisions([div('a', 2)], 7, metrics)).toEqual([[expect.objectContaining({ key: 'a' })]])
    expect(packDivisions([div('a', 2), div('b', 2)], 7, metrics)).toHaveLength(2)
    // …and it still fills every column it does return.
    const packed = packDivisions([div('a', 5), div('b', 4), div('c', 3)], 3, metrics)
    expect(packed).toHaveLength(3)
    expect(packed.every((col) => col.length > 0)).toBe(true)
  })

  it('returns a single empty column for an empty division list', () => {
    expect(packDivisions([], 5, metrics)).toEqual([[]])
  })
})

describe('matchesOrgQuery', () => {
  const a = agent('sora', [], 2, { first_name: 'Sora', last_name: 'Petersen', role: 'Researcher / Analyst', residence: 'Oslo, NO' })

  it('matches an empty or whitespace query', () => {
    expect(matchesOrgQuery(a, '')).toBe(true)
    expect(matchesOrgQuery(a, '   ')).toBe(true)
  })

  it('matches slug, full name, role and residence case-insensitively', () => {
    expect(matchesOrgQuery(a, 'SOR')).toBe(true)
    expect(matchesOrgQuery(a, 'sora petersen')).toBe(true)
    expect(matchesOrgQuery(a, 'analyst')).toBe(true)
    expect(matchesOrgQuery(a, 'oslo')).toBe(true)
  })

  // Regression (wf:owen O2): the fixture above has slug `sora` inside name
  // "Sora Petersen", so the slug clause could be deleted and every
  // assertion still passed through the name clause. This slug appears
  // nowhere else on the record.
  it('matches on slug even when the slug is not part of the name', () => {
    const odd = agent('k9', [], 2, { first_name: 'Sora', last_name: 'Petersen', role: 'Researcher', residence: 'Oslo, NO' })
    expect(matchesOrgQuery(odd, 'k9')).toBe(true)
    expect(matchesOrgQuery(odd, 'K9')).toBe(true)
  })

  it('rejects a non-match', () => {
    expect(matchesOrgQuery(a, 'podcast')).toBe(false)
  })
})
