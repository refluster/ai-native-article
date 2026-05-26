# Epic-003 — Org chart (MS Teams-style)

- **Status**: Draft
- **Owner**: Maya
- **Created**: 2026-05-18
- **Implemented by**: —

## Problem

A flat list of agents tells the reader nothing about **how they work together**. Who hands work to whom? Who reports to whom for what? Who is the operator's primary interface vs. an internal-only persona?

Operators and external readers both benefit from a visual org chart in the MS Teams "View profile → Organization tab" tradition: one person at the center, their reports below, their lead above, with names and roles.

## Proposed solution

A `/workforce/org` route that renders the full workforce as a tree, plus the same tree rendered as a subset on each agent profile (Epic-002).

**Data model for relationships (new)**

Today there are no explicit reporting relationships. Add a single optional field to `agent.json`:

```json
"reports_to": "maya"        // null for the root (Maya herself)
```

For the 5 founding personas:

```
                          maya (PM / Founder, root)
                            │
        ┌────────────┬──────┼──────┬────────────┐
       sora         ren    aoi    yuki
   (Researcher) (Engineer)(Designer)(GTM/CS)
```

Maya is the root because she defines the work the others execute. This isn't a hierarchy in the human-management sense — it's a *task-flow* hierarchy. The visual matches MS Teams convention for familiarity.

**Amendment (2026-05-23) — VP layer.** [Epic-009](epic-009-vp-tier-and-functional-expansion.md) introduces a middle `lead` tier between Maya and the ICs. Three VPs (People & Legal, Customer Experience, Engineering Excellence) sit on row 1; four new ICs join the existing four on row 2. The `OrgDAG` page already buckets agents by `tier` (`founder` → row 0, `lead` → row 1, `ic` → row 2) and so renders the expanded shape with no UI code change. This Epic's acceptance criteria still hold; Epic-009 is the design record for the new agents themselves.

**Amendment (2026-05-23) — drop `tier`, derive depth.** The hand-maintained `tier` field on each `_org.json` node was redundant: the layer of any agent is `0` for a root (no `reports_to`) and `1 + min(parent depth)` otherwise — `reports_to` alone is enough to recover it. `tier` is removed from `_org.json` and from the manifest; the build script (`scripts/build-agent-manifest.mjs`) now computes `depth: number` via forward BFS from roots and throws on cycles or unreachable nodes (W-4 fail-loud). The `AgentTier = 'founder' | 'lead' | 'ic'` literal type is gone — there is no hard ceiling on N, a 4-deep org renders the same way a 3-deep one does. UI labels switched from `· FOUNDER/LEAD/IC` to `· L0/L1/L2/…` so they generalise to arbitrary depth without code changes. Behaviour is otherwise unchanged (same 3 rows, same nodes, same edges, same sort order).

**Amendment (2026-05-23) — egocentric `/org` view.** `/org` no longer renders the whole tree by default. It renders one **focus agent** (URL param `?center=<slug>`, default = first root) plus their neighbourhood within `?hops=1` (default) or `?hops=2` edges, where each `reports_to`, `direct_reports`, or `lateral` edge counts as one hop. Clicking any visible node re-centers. A `?hops=full` escape hatch renders the whole graph for explorers. `ReportingCard`'s "VIEW FULL ORG →" link became "VIEW IN ORG GRAPH →" and now passes `center=<slug>` so profile pages bind to the org graph centered on that agent. This implements the Epic's own `N=100+` recommendation ("never render the whole tree on an agent profile; show lead + self + reports") at `N=12` so the layout never needs another redesign as the org grows. Acceptance criteria: clicking any node updates the URL `?center=`; the `?hops=full` mode renders every agent; the absolute `depth` Y-axis stays stable across re-centerings so the tree never visually flips.

**UI**

- Card per agent: procedural avatar, name, role, "N reports" count, click-to-expand.
- Selected agent is centered; the chart redraws around the selection.
- Click an agent to navigate to their profile (Epic-002).

**Library / rendering**
- v1: hand-rolled CSS grid (5 agents fits cleanly).
- v2 (at N > ~15): a tree layout library (e.g. `react-d3-tree`, `dagre`). Pick at v2 time, not now.

## Behaviour at N = 100+ agents

A single-screen visual tree of 100 nodes is unreadable. The right shape at scale:

- **Default to "near neighbours"**: when an agent profile shows "View organisation", render their lead, themselves, and their direct reports — never the whole tree.
- The `/workforce/org` index route shows the **roots and one level down**, with each card expandable.
- At N > 30, switch the layout primitive from CSS grid to a tree library and from full-render to virtualised render.
- The `reports_to` field stays optional — agents with no lead default to root and visually surface as separate trees. The org may have multiple roots (Maya for editorial, a future "head of client services" for client-stream agents).

The `reports_to` value is also used at runtime by the orchestrator (forthcoming) to decide which agent receives an unassigned task — for now, "ask Maya."

## Acceptance criteria

- `/workforce/org` renders the 5 current agents with Maya at top and the other four under her.
- Clicking an agent card navigates to their profile.
- The same tree subset (lead + self + reports) renders inline on each agent profile page.
- Adding a 6th agent with `reports_to: "maya"` makes them appear correctly without any UI code change.

## Open questions

- Q1. Where does **Ren** report when he's working in the `client` stream on someone else's project? Default: still to Maya (workforce-internal hierarchy is one tree; project context is orthogonal). Confirm.
- Q2. Should the chart show "dotted-line" relationships (e.g. Yuki collaborates with Aoi on launches)? Default: no in v1; one-dimensional hierarchy is enough.
- Q3. Should agents have a `team` field (e.g. "editorial-team", "client-team-A")? Useful at N > 20. Defer to a follow-up Epic.

## Out of scope

- Manager-vs-IC distinctions, performance evaluations, anything resembling real-world HR. C-3 (single-operator scale) holds.
- Drag-to-reorganise UI. Reorgs go through `agent.json` PRs (Rule 11 compliant).
- Multi-workforce / cross-organisation visualisation.
