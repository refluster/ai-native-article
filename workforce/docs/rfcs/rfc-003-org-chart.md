# RFC-003 — Org chart (MS Teams-style)

- **Status**: Draft
- **Owner**: Maya
- **Created**: 2026-05-18
- **Implemented by**: —

## Problem

A flat list of agents tells the reader nothing about **how they work together**. Who hands work to whom? Who reports to whom for what? Who is the operator's primary interface vs. an internal-only persona?

Operators and external readers both benefit from a visual org chart in the MS Teams "View profile → Organization tab" tradition: one person at the center, their reports below, their lead above, with names and roles.

## Proposed solution

A `/workforce/org` route that renders the full workforce as a tree, plus the same tree rendered as a subset on each agent profile (RFC-002).

**Data model for relationships (new)**

Today there are no explicit reporting relationships. Add a single optional field to `agent.json`:

```json
"reports_to": "maya"        // null for the root (Maya herself)
```

For the current 5 personas:

```
                          maya (PM / Founder, root)
                            │
        ┌────────────┬──────┼──────┬────────────┐
       sora         ren    aoi    yuki
   (Researcher) (Engineer)(Designer)(GTM/CS)
```

Maya is the root because she defines the work the others execute. This isn't a hierarchy in the human-management sense — it's a *task-flow* hierarchy. The visual matches MS Teams convention for familiarity.

**UI**

- Card per agent: procedural avatar, name, role, "N reports" count, click-to-expand.
- Selected agent is centered; the chart redraws around the selection.
- Click an agent to navigate to their profile (RFC-002).

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
- Q3. Should agents have a `team` field (e.g. "editorial-team", "client-team-A")? Useful at N > 20. Defer to a follow-up RFC.

## Out of scope

- Manager-vs-IC distinctions, performance evaluations, anything resembling real-world HR. C-3 (single-operator scale) holds.
- Drag-to-reorganise UI. Reorgs go through `agent.json` PRs (Rule 11 compliant).
- Multi-workforce / cross-organisation visualisation.
