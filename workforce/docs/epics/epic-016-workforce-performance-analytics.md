# Epic-016 — Workforce performance analytics (per-project + cross-project)

- **Status**: In-progress (2026-06-22)
- **Owner**: nadia
- **Created**: 2026-06-22
- **Implemented by**: (this PR — opening implementation lands the IA + both metric families against the live-API-first / mock-fallback contract per operator greenlight)

## Members

The performance surface composes the three axes of `(agent × skill × project)`,
so it is staffed across the platform group rather than owned by one IC:

| Slug | Role | Lane on this Epic |
|---|---|---|
| `nadia` | PM | Owner. IA / screen-transition design, story decomposition, ships the SPA pages (console-Epic precedent: Epic-014). |
| `freya` | Agent Experience Designer | The **agent axis** — defines the `registered → assigned → delivered` lifecycle funnel (Metric 2) as the agent-fulfilment / meaningful-work signal. |
| `hana` | Agent Platform Engineer | The **data plane** — where each metric is sourced from (`AUDIT#` creates, `META.bindings[]`, `EXEC#` rows, git PR history). Owns the eventual live `/performance` endpoint shape. |
| `mateo` | VP Agent Workforce Platform | Sponsor. Holds the cross-project rollup seam and carries the operator escalation for the live-endpoint (Phase 2) cost. |

`ren` (Engineer) is available for the live-endpoint Lambda build under Dario's
L2 bar when Phase 2 is filed; this PR is SPA-only and needs no Lambda change.

## Problem

The console answers *"is the crew running right now?"* (`/performance` →
`Dashboard`: live KPIs, a 30-day heat strip, the live-trace ribbon, a crew
table) and *"what has this project executed?"* (`/projects/{id}` →
`ProjectProfile`: KPI strip + execution history). Neither answers the two
questions the operator actually asks of an **agentic** organisation as it
scales:

1. **Is the workforce converting hiring into delivered output?** A persona that
   is *registered* (hired) but never *assigned* a task, or *assigned* but never
   *delivers* an artefact, is dead weight. Today there is no view of the
   `registered → assigned → delivered` funnel over time — so "we hired six
   analysts last month" reads as progress even if none of them shipped.
2. **Is the delivery process itself getting more autonomous?** The whole thesis
   is that the workforce removes humans from the loop. PRs are the unit of
   shipped work; the share of them that `pr-autopilot` reviews-and-merges with
   **no human touch** is the cleanest single read on that. Today it is invisible
   — the operator cannot see whether human involvement per merged PR is trending
   to zero.

Both questions are *cross-project* (the workforce as one organism) **and**
*per-project* (which project is converting, which is stalling). The console has
no home for either framing.

## Proposed solution

One **performance analytics** surface, rendered at two scopes against a single
data contract, plus the screen-transition (IA) wiring to reach it.

### Information architecture / screen transitions

- **Cross-project (workforce)** lives on the existing **`/performance`**
  Dashboard (already titled *PERFORMANCE · OVERVIEW*, reached from the nav "Me"
  pill). We **extend** it — no new top-level route, no nav churn — with two new
  decks below the existing live KPIs / heat / crew table:
  - **DECK 03 · AGENT LIFECYCLE** — Metric 2, workforce-wide.
  - **DECK 04 · PR AUTOMATION** — Metric 3, workforce-wide.
- **Per-project** lives on the project profile under a new **Overview /
  Performance** tab pair. Performance is a sibling view of the existing
  overview, addressable at **`/projects/{id}/performance`**:
  - `/projects/self/ren` → overview (unchanged).
  - `/projects/self/ren/performance` → the same two decks, project-scoped.
  - The router already routes `/projects/*` to `ProjectProfile` via the
    wildcard (project ids contain `/`, e.g. `self/ren`); the page parses a
    trailing `/performance` segment off `params['*']` to pick the view, so **no
    `App.tsx` route change is needed** and existing deep links keep working.
  - Tabs render in the hero; switching tabs is a client navigation (no refetch
    of the project record). A "← workforce performance" affordance links the
    project view back up to `/performance` so the two scopes are reachable from
    each other.

This keeps the IA legible: *"Me" → workforce performance; a project → that
project's performance, one tab away from its overview.*

### Metric 2 — agent lifecycle funnel (`registered → assigned → delivered`)

A **cumulative, stacked area chart** over a daily date axis. Each day is a
snapshot of the active cohort partitioned by its **furthest reached state** (the
three bands are mutually exclusive and sum to the cohort, so band shares are
readable):

- **registered** — hired (an `AGENT#{slug}` row exists; first `AUDIT#…kind=create`) but holds no non-manual binding yet.
- **assigned** — carries ≥1 triggerable binding (`META.bindings[]`, `trigger ≠ manual`) but has not yet produced a delivered artefact.
- **delivered** — has produced ≥1 `EXEC#` row with `status:ok` + an `artifact_ref`.

The headline read is the **delivered share** = `delivered / (registered +
assigned + delivered)`. The thesis (and the chart's whole point) is that this
share **climbs** as the workforce matures: hiring converts into bound tasks,
bound tasks convert into shipped output. A flat or falling delivered share is
the alarm — hiring outrunning delivery. At project scope the same three bands
count the project's *members* by furthest state on that project's partition.

The lifecycle series is **illustrative** in this PR (clearly labelled, exactly
as the Dashboard heat strip is "illustrative until the live activity endpoint
exists") — grounded in the real `AUDIT#` / `bindings[]` / `EXEC#` definitions
above, with the live `/performance` roll-up deferred to Phase 2.

### Metric 3 — PR automation

A **stacked daily bar series** of merged PRs split into **autopilot-merged**
(no human in the loop — green) vs **human-involved** (amber), with a summary
band carrying:

- **autopilot share** — the headline (target: → 100%).
- **churn** — mean ± lines changed per PR (additions / deletions).
- **humans involved** — the distinct human handles that touched any merged PR in
  the window (the set we are trying to shrink).

Unlike the lifecycle funnel, **this series is real**: a build script
(`workforce/scripts/build-pr-metrics.mjs`) derives it offline from `git log`
over the window — merged-PR commits (`… (#NNN)` squash subjects), `--numstat`
churn, author trailers, and the `pr-autopilot` merge signature — and writes the
workforce + per-project PR sections into the mock dataset. Per-project
attribution maps a PR to a project by changed-file path prefix
(`newsletter/**` → `editorial`, `workforce/**` → `workforce-meta`, …); PRs that
touch no mapped path are counted workforce-wide only.

### Data contract

A single `PerformanceDataset` (`workforce/app/src/types/performance.ts`) with a
`workforce` scope and a `projects: Record<projectId, …>` map. The loader
(`lib/performance.ts`) is **live-API-first, mock-fallback**, identical to the
`/stats` precedent: when `WORKFORCE_AGENTS_API_BASE` is set it `GET`s
`/performance` (workforce) or `/projects/{id}/performance`; otherwise it serves
`public/workforce-mock-performance.json`. A non-OK live response throws (C-4 —
fail loud, never silently serve stale mock over a live deploy). The mock path
renders the same "* mocked — wire WORKFORCE_AGENTS_API_BASE for live data"
advisory the project page already uses, so nothing on the surface ever claims
false live truth (C-1).

## Behaviour at N = 100+ agents

- **Lifecycle funnel stays O(days), not O(agents).** The chart is a per-day
  partition into three integers, independent of cohort size; at N=100+ the
  bands just get taller. The *delivered share* is the scale-invariant read — it
  answers "is hiring converting?" identically at N=10 and N=1000.
- **Live endpoint must pre-aggregate.** The Phase-2 `/performance` roll-up must
  emit the daily three-band series server-side (a scheduled reducer over
  `AUDIT#` / `bindings[]` / `EXEC#`), **not** ship raw rows to the client — the
  SPA must never scan the ledger. This is called out now so the endpoint is born
  pre-aggregated; the client contract (`LifecyclePoint[]`) already assumes it.
- **PR series scales with PR volume, not agents**, and the build script windows
  to last-N days so the git walk stays bounded as history grows.
- **Per-project map is sparse by construction** — only projects with activity
  carry a series; a 100-project org doesn't bloat the payload with empty scopes.
- **The delivered-share alarm is the governance hook**: at scale, a falling
  workforce-wide delivered share is the earliest signal that hiring (a B-cost
  decision) is outrunning the substrate's ability to bind and ship work.

## Acceptance criteria

- `/performance` renders DECK 03 (lifecycle funnel, stacked area, delivered-share
  headline) and DECK 04 (PR automation, stacked daily bars + autopilot-share /
  churn / humans-involved summary), workforce-scoped.
- `/projects/{id}` shows an **Overview / Performance** tab pair; `…/performance`
  renders the same two decks project-scoped without an `App.tsx` route change,
  and existing `/projects/{id}` links are unaffected.
- A reusable `StackedAreaChart` renders the funnel from `LifecyclePoint[]` with
  no chart-library dependency (custom SVG, matching the HeatStrip aesthetic) and
  is unit-tested.
- `lib/performance.ts` is live-API-first with mock fallback and is unit-tested;
  the mock path shows the "* mocked" advisory.
- `workforce/scripts/build-pr-metrics.mjs` regenerates the real PR sections from
  `git log` (offline), supports `--dry-run`, and is idempotent.
- All SPA colours route through `wf-*` tokens / `--wf-svg-*` CSS vars — `npm run
  lint:tokens` stays green. `npm run build:workforce`, the `workforce:*`
  validators, and `vitest` all pass.

## Open questions

- **Q1.** Should the lifecycle funnel count **agents** (a registered persona) or
  **task-assignments** (a binding)? This PR counts personas by furthest state;
  if the operator wants per-task granularity the band definitions move from
  `AGENT#` to `bindings[]`-cardinality. (Draft: personas — it answers the hiring
  question directly.)
- **Q2.** Is *delivered share* the right single KPI, or should the headline be a
  **conversion rate** between adjacent stages (assigned/registered,
  delivered/assigned) to localise *where* the funnel leaks? (Draft: delivered
  share for the headline, adjacent ratios available on hover.)
- **Q3.** PR→project attribution by path prefix is heuristic; a PR spanning
  `newsletter/**` and `workforce/**` counts in both. Acceptable for a trend, but
  do we want a canonical `project:` PR label instead? (Defer — a labels change is
  its own decision.)

## Out of scope

- **The live `/performance` endpoint** (Phase 2) — the agents-api Lambda + the
  scheduled pre-aggregating reducer over `AUDIT#`/`bindings[]`/`EXEC#`. This PR
  ships the client contract + mock; the endpoint is a `ren`/`hana` build under a
  follow-up issue (a W-3 cost decision → operator B-authority).
- **Real-time / streaming** updates — the surface is a daily roll-up, not a live
  socket.
- **Cross-project comparison / ranking views** ("which project converts best") —
  a later deck once the per-project series proves out.
- **Any new credential type or endpoint auth change** — reuses the existing
  public-read agents-api surface; no Epic-010 trust-boundary change.
