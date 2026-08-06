// Whole-workforce org model — the data behind /org/chart.
//
// The console already had two reporting views, both deliberately narrow:
// AgentOrgGraph (±2 hops around one agent) and /org (an egocentric 1-hop
// spine). Neither answers "what does the whole organisation look like?",
// and at 50+ agents the obvious answer — one deep indented tree — is a
// column of text several screens tall.
//
// This module reshapes the flat roster into the structure the wide chart
// needs: the root band (L0), then one **division** per root-child, each
// division being a self-contained subtree that can be laid out as an
// independent card. Divisions tile across the page width instead of
// stacking, which is what turns a 3000px column into one screen.
//
// Everything here is pure and synchronous so the layout rules are unit
// testable without rendering: the page component only maps rows to markup.
//
// Two failure modes are handled explicitly rather than silently (C-4):
//   - **Multiple managers.** A node is *placed* under exactly one primary
//     parent (shallowest, then slug) so it appears once; the remaining
//     edges survive as `alsoReportsTo` and the chart draws them as a
//     dotted secondary line. Rendering the node under every parent would
//     inflate the headcount the chart displays.
//   - **Unreachable nodes.** An agent inside a reports_to cycle, or one
//     whose whole cluster is detached from a root, can never be reached
//     from the root band. Those become `orphans` — rendered in their own
//     flagged section, never dropped, so a broken graph is visible on the
//     surface the operator opens to look at the graph.

import type { WorkforceAgent } from '../types/agent'

/** Connector glyph drawn in one indent column of a member row. */
export type RailShape = 'vertical' | 'empty' | 'branch' | 'corner'

export interface OrgNode {
  agent: WorkforceAgent
  /** Depth **within the division** — 0 is the division lead. */
  level: number
  children: OrgNode[]
  /** Resolvable managers other than the one this node is placed under. */
  alsoReportsTo: string[]
}

/** A flattened node, carrying the rails needed to draw its indent. */
export interface OrgRow {
  agent: WorkforceAgent
  level: number
  railShapes: RailShape[]
  alsoReportsTo: string[]
}

export interface OrgDivision {
  /** Stable key — the lead's slug. */
  key: string
  lead: WorkforceAgent
  /** Lead first (level 0, no rails), then every descendant in tree order. */
  rows: OrgRow[]
  /** Head-count including the lead. */
  size: number
  /** Deepest level inside the division (0 = lead only). */
  depth: number
  /** True when this subtree could not be reached from a root. */
  orphan: boolean
}

export interface OrgChartModel {
  /** Agents with no resolvable manager — normally just the president. */
  roots: WorkforceAgent[]
  /** One per root-child subtree, largest first. */
  divisions: OrgDivision[]
  /** Subtrees unreachable from any root (cycle / detached cluster). */
  orphans: OrgDivision[]
  /** Roster size. */
  total: number
  /** Head-count per org depth; index = `WorkforceAgent.depth`. */
  levelCounts: number[]
}

/** Deepest org level the header tally will render. Anything past this is a
 *  bad `depth` off the wire, not an organisation. */
const MAX_LEVEL = 32

function bySlugAsc(a: WorkforceAgent, b: WorkforceAgent) {
  return a.slug.localeCompare(b.slug)
}

/**
 * Flattens a subtree into rows, computing each row's connector rails.
 *
 * `flags[j]` answers "does the ancestor at indent j+1 have a younger
 * sibling?" — i.e. whether that column's rail continues past this row.
 * The last entry describes the row itself and becomes its corner (last
 * child) or branch (has siblings below) glyph. Same vocabulary as
 * AgentOrgGraph so the two views read as one system.
 */
export function flattenDivision(lead: OrgNode): OrgRow[] {
  const rows: OrgRow[] = []
  const walk = (node: OrgNode, flags: boolean[]) => {
    const railShapes: RailShape[] = []
    for (let j = 0; j < flags.length - 1; j++) railShapes.push(flags[j] ? 'vertical' : 'empty')
    if (flags.length > 0) railShapes.push(flags[flags.length - 1] ? 'branch' : 'corner')
    rows.push({
      agent: node.agent,
      level: flags.length,
      railShapes,
      alsoReportsTo: node.alsoReportsTo,
    })
    node.children.forEach((child, i) => walk(child, [...flags, i !== node.children.length - 1]))
  }
  walk(lead, [])
  return rows
}

function toDivision(lead: OrgNode, orphan: boolean): OrgDivision {
  const rows = flattenDivision(lead)
  return {
    key: lead.agent.slug,
    lead: lead.agent,
    rows,
    size: rows.length,
    depth: rows.reduce((m, r) => Math.max(m, r.level), 0),
    orphan,
  }
}

/**
 * Builds the whole-org model from the roster.
 *
 * Division order is head-count descending, then slug — the big teams
 * anchor the top-left of the tiled layout and the one-card divisions fill
 * the gaps, which is what keeps the balanced-column packing tight.
 */
export function buildOrgChart(agents: WorkforceAgent[]): OrgChartModel {
  const bySlug = new Map(agents.map((a) => [a.slug, a]))

  // Placement parent: the shallowest resolvable manager, slug as tiebreak.
  // Deterministic, so the chart doesn't reshuffle between loads.
  const parentOf = new Map<string, string>()
  const childrenOf = new Map<string, WorkforceAgent[]>(agents.map((a) => [a.slug, []]))
  for (const a of agents) {
    const managers = a.reports_to
      .map((s) => bySlug.get(s))
      .filter((m): m is WorkforceAgent => !!m)
      .sort((x, y) => x.depth - y.depth || x.slug.localeCompare(y.slug))
    const primary = managers[0]
    if (!primary) continue
    parentOf.set(a.slug, primary.slug)
    childrenOf.get(primary.slug)!.push(a)
  }
  for (const list of childrenOf.values()) list.sort(bySlugAsc)

  const visited = new Set<string>()
  const build = (agent: WorkforceAgent, level: number): OrgNode | null => {
    if (visited.has(agent.slug)) return null
    visited.add(agent.slug)
    const primary = parentOf.get(agent.slug)
    return {
      agent,
      level,
      // De-duplicated: a roster row that lists the same manager twice would
      // otherwise render "⇄ also reports to b, b" (wf:dario D5).
      alsoReportsTo: [
        ...new Set(agent.reports_to.filter((s) => bySlug.has(s) && s !== primary)),
      ],
      children: childrenOf
        .get(agent.slug)!
        .map((c) => build(c, level + 1))
        .filter((n): n is OrgNode => n !== null),
    }
  }

  const roots = agents.filter((a) => !parentOf.has(a.slug)).sort(bySlugAsc)
  for (const r of roots) visited.add(r.slug)

  const divisions: OrgDivision[] = []
  for (const root of roots) {
    for (const child of childrenOf.get(root.slug)!) {
      const node = build(child, 0)
      if (node) divisions.push(toDivision(node, false))
    }
  }

  // Anything still unvisited is unreachable from a root. Rebuild those as
  // their own divisions so a detached cluster keeps its shape on screen
  // instead of collapsing into a flat "missing agents" list.
  //
  // Seeding matters here (wf:owen O3). Walking the leftover agents in slug
  // order seeds wherever the alphabet lands, so a cluster like
  // `aa → zz ↔ yy` seeded at `aa` produced a one-row card for `aa` and a
  // separate `yy → zz` card — the cluster shredded, exactly what the
  // paragraph above promises not to do. Instead, climb from each leftover
  // to the top of its component (the entry point of the cycle that holds
  // it up) and seed there, so the whole component lands in one card.
  const seedOf = (start: WorkforceAgent): WorkforceAgent => {
    const path = new Set<string>()
    let cur = start
    for (;;) {
      path.add(cur.slug)
      const parent = parentOf.get(cur.slug)
      // No parent, parent already placed, or we've come full circle: `cur`
      // is as high as this component goes.
      if (!parent || visited.has(parent) || path.has(parent)) return cur
      cur = bySlug.get(parent)!
    }
  }

  const orphans: OrgDivision[] = []
  for (const a of [...agents].sort(bySlugAsc)) {
    if (visited.has(a.slug)) continue
    const node = build(seedOf(a), 0)
    if (node) orphans.push(toDivision(node, true))
  }
  // A component whose seed was reached first can leave stragglers (a node
  // whose primary parent sits below it in the same cycle). Sweep them up so
  // the "every agent appears exactly once" invariant holds unconditionally.
  for (const a of [...agents].sort(bySlugAsc)) {
    if (visited.has(a.slug)) continue
    const node = build(a, 0)
    if (node) orphans.push(toDivision(node, true))
  }

  const bySizeDesc = (x: OrgDivision, y: OrgDivision) =>
    y.size - x.size || x.key.localeCompare(y.key)
  divisions.sort(bySizeDesc)
  orphans.sort(bySizeDesc)

  // `depth` comes off the wire, so it is bounded before it indexes an array
  // (wf:dario D6): one record with depth 400 turned the page header into 401
  // "L{n} 0" chips, and a negative depth set a non-index property, silently
  // dropping that agent from the tally — the C-4-wrong direction.
  const levelCounts: number[] = []
  for (const a of agents) {
    if (!Number.isInteger(a.depth) || a.depth < 0 || a.depth > MAX_LEVEL) continue
    levelCounts[a.depth] = (levelCounts[a.depth] ?? 0) + 1
  }
  for (let i = 0; i < levelCounts.length; i++) levelCounts[i] = levelCounts[i] ?? 0

  return { roots, divisions, orphans, total: agents.length, levelCounts }
}

/** Row-height model used to balance the columns. Approximate by design —
 *  it only decides which column a card lands in, never how it renders. */
export interface PackMetrics {
  /** Division header (lead card) height, px. */
  leadHeight: number
  /** One member row, px. */
  rowHeight: number
  /** Padding around the member list, px. */
  listPadding: number
  /** Gap below each card, px. */
  cardGap: number
  /** The "⇄ also reports to" annotation line, px. */
  secondaryLineHeight: number
}

/** Estimated rendered height of a division card, in unscaled px. */
export function estimateDivisionHeight(division: OrgDivision, m: PackMetrics): number {
  const members = division.size - 1
  const secondaries = division.rows.filter((r) => r.alsoReportsTo.length > 0).length
  return (
    m.leadHeight +
    (members > 0 ? m.listPadding + members * m.rowHeight : 0) +
    secondaries * m.secondaryLineHeight +
    m.cardGap
  )
}

/**
 * Distributes divisions across `columns` explicit columns, tallest-first
 * into whichever column is currently shortest (LPT scheduling).
 *
 * CSS `column-width` was the first attempt and it packs badly here: with
 * `column-fill: balance` the browser targets a height no shorter than the
 * tallest single card, so a 12-card org with one 11-person division left
 * the last three columns of a 1440px viewport completely empty — the chart
 * then had to zoom out further than the content actually required. Explicit
 * columns spend the width the operator asked us to spend.
 */
export function packDivisions(
  divisions: OrgDivision[],
  columns: number,
  metrics: PackMetrics,
): OrgDivision[][] {
  // `Math.max(1, NaN)` is NaN and `Math.floor(NaN)` is NaN, so the obvious
  // clamp does not clamp — `new Array(NaN)` then throws RangeError
  // (wf:dario D4). This module is exported for callers other than the page,
  // so the contract is enforced here rather than assumed.
  //
  // Never more buckets than there are cards to put in them. Every bucket
  // becomes an equal-width track at the call site, so returning 7 buckets
  // for 1 division rendered that division at 1/7 of the row — and the
  // section that hit hardest was UNPLACED, whose whole job is to be
  // impossible to miss (wf:dario D3). Clamped here rather than at the call
  // site so no caller can get it wrong.
  const requested = Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : 1
  const n = Math.max(1, Math.min(requested, divisions.length))
  const buckets: OrgDivision[][] = Array.from({ length: n }, () => [])
  if (n === 1) return [[...divisions]]
  // Height is computed once per division, not twice per comparison — the
  // comparator ran O(rows) work on every keystroke otherwise (wf:dario D7).
  const heightOf = new Map(divisions.map((d) => [d.key, estimateDivisionHeight(d, metrics)]))
  const h = (d: OrgDivision) => heightOf.get(d.key) ?? 0
  const heights = new Array<number>(n).fill(0)
  for (const d of [...divisions].sort((a, b) => h(b) - h(a) || a.key.localeCompare(b.key))) {
    let target = 0
    for (let i = 1; i < n; i++) if (heights[i] < heights[target]) target = i
    buckets[target].push(d)
    heights[target] += h(d)
  }
  return buckets
}

/**
 * How many columns of `columnWidth` fit in `available` px, given `gap`
 * between them. Always at least one — a phone gets a single stack.
 */
export function columnCountFor(available: number, columnWidth: number, gap: number): number {
  if (!Number.isFinite(available) || available <= 0) return 1
  return Math.max(1, Math.floor((available + gap) / (columnWidth + gap)))
}

/**
 * Does this agent match the chart's highlight query?
 *
 * The chart *dims* non-matches rather than removing them — an org chart
 * whose boxes disappear as you type stops being an org chart. Matching is
 * the same field set as the crew index search so muscle memory carries.
 */
export function matchesOrgQuery(agent: WorkforceAgent, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    agent.slug.toLowerCase().includes(q) ||
    `${agent.first_name} ${agent.last_name}`.toLowerCase().includes(q) ||
    agent.role.toLowerCase().includes(q) ||
    agent.residence.toLowerCase().includes(q)
  )
}
