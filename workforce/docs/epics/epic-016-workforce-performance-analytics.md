# Epic-016 — Workforce performance analytics (per-project + cross-project)

- **Status**: In-progress (Phase 1 shipped 2026-06-22 — #357 IA + both metric families, #359 graceful fallback; Phase 2 code-complete #361, pending operator `sam deploy`)

> **Status reconciliation (2026-06-23, Nadia).** Normalized the prose Status to the lifecycle word **In-progress**. Phase 1 (console IA + both metric families + graceful illustrative fallback) is live; Phase 2 (live lifecycle reducer Lambda + `/performance` endpoints, #361; Q1/Q2/Q3 resolved) is code- and infra-complete but **not yet live on AWS** — it is gated on the operator's `sam deploy` + wiring `build-pr-metrics.mjs --publish-ddb` into the deploy workflow. Flip to Implemented once that deploy lands.
- **Owner**: nadia
- **Created**: 2026-06-22
- **Implemented by**: Phase 1 — #357 / #359. Phase 2 — nadia (lead, IA + endpoint shape), hana (data plane: the `AUDIT#`/`bindings[]`/`EXEC#` partition + roll-up item contract), ren (reducer Lambda build under Dario's L2 bar).

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

The lifecycle series was **illustrative** in Phase 1 (clearly labelled, exactly
as the Dashboard heat strip is "illustrative until the live activity endpoint
exists") — grounded in the real `AUDIT#` / `bindings[]` / `EXEC#` definitions
above. **Phase 2 (2026-06-22) makes it live**: the `performance-reducer`
snapshots these definitions daily into `PERF#{scope}/LIFECYCLE` and the
`/performance` endpoints serve it (see "Phase 2" below). The headline read is
the absolute **delivered count** (Q2), not a share.

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

- `/performance` renders DECK 03 (lifecycle funnel, stacked area, delivered-count
  headline — Q2) and DECK 04 (PR automation, stacked daily bars + autopilot-share /
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

## Open questions — resolved (operator, 2026-06-22)

- **Q1 — RESOLVED: count personas (pure head-count).** The funnel counts
  **agents** by furthest reached state, one persona per band, not
  binding/task-assignment cardinality. Implemented in `tallyLifecycle`
  (`workforce/lambdas/shared/performance.ts`) and the reducer's per-agent
  classification; the band defs stay `AGENT#`-anchored.
- **Q2 — RESOLVED: absolute delivered count, not a rate.** The deck headline is
  the **absolute number of personas that have delivered** (`LifecyclePoint.delivered`),
  not the delivered *share* and not an adjacent-stage conversion rate. The
  `deliveredShare` helper stays for a secondary/hover read. Implemented in
  `AgentLifecycleDeck.tsx`; the live `PerformanceSeries` shape is unchanged (the
  count is already a field).
- **Q3 — RESOLVED: keep the path-prefix heuristic, no `project:` label.** PR→project
  attribution stays the `newsletter/**`→`editorial`, `workforce/**`→`workforce-meta`
  path-prefix mapping in `build-pr-metrics.mjs`; a PR spanning both counts in
  both (acceptable for a trend). No canonical `project:` PR label is introduced
  (a labels change remains its own decision if ever revisited).

## Phase 2 — live lifecycle endpoint (implemented 2026-06-22)

Phase 2 makes **Metric 2 real** (Metric 3 was already git-true). Scope is exactly
what this epic deferred: *the scheduled pre-aggregating reducer over
`AUDIT#`/`bindings[]`/`EXEC#`* + the read endpoints. Architecture (the one design
fork resolved here — keep the surface honest and inside the Epic-010 trust
boundary):

- **The endpoint returns a complete `PerformanceSeries`** = live lifecycle ⊕
  git-derived PR sections. No client/loader change — the Phase-1 live-first /
  mock-fallback contract already fetches a full series.
- **Reducer (`workforce/lambdas/performance-reducer`)** — EventBridge daily
  (`02:00 UTC`). Scans `AGENT#…/META` (the cohort), and per agent decides
  *delivered* (≥1 `EXEC#` `status:ok` + `artifact_ref`) → *assigned*
  (≥1 load-bearing binding via `bindingCronIsLoadBearing` — the same predicate
  the orchestrator fires on, so a dead cron never inflates `assigned`) →
  *registered*. Snapshots **today** and appends one `LifecyclePoint` to a
  `PERF#{scope}/LIFECYCLE` item (trailing 28d, idempotent per day), workforce-wide
  and per active project (sparse). It pre-aggregates server-side — the SPA never
  scans the ledger (the N=100+ requirement). *Per-project nuance:* a project's
  `assigned` band counts a member only if a load-bearing binding is **attributed
  to that project** (`binding.project_id === projectId`); a member whose
  triggerable bindings carry no `project_id` reads as `registered` on that
  project while still counting `assigned` workforce-wide (freya, cycle-1 review).
- **PR sections stay git-derived.** `build-pr-metrics.mjs --publish-ddb` writes
  the `PERF#{scope}/PR` item from `git log` in CI **under the deploy role's
  existing AWS creds** — an *internal* writer, **no new external/public write
  surface**, so the Epic-010 trust boundary is unchanged. (The authoritative
  GitHub merge-metadata split for autopilot-vs-human — see the build script's
  header — is a Phase-2.1 follow-up; today it carries the git "no human author"
  proxy in both phases, no regression.)
- **Endpoint (`GET /performance`, `GET /projects/{id}/performance`)** reads both
  `PERF#` items and composes the series (`composeSeries`). `LIFECYCLE` is the
  live differentiator: **absent → 404**, and the client serves its illustrative
  fallback (#359). `PR` is optional (empty block until first publish).
- **Observability (W-4):** the reducer throws on any failure (Errors alarm) and
  carries a 2-day missed-run alarm so a frozen funnel is loud.

**Remaining operator steps (B-authority / W-3 cost):** `sam deploy` the new
function + routes; the schedule ships `Enabled: true` (Phase-2 greenlit); wire
`build-pr-metrics.mjs --publish-ddb --table $TABLE_NAME` into the deploy
workflow so the live endpoint serves PR sections. Until then the surface keeps
rendering the illustrative fallback — no user-visible regression.

## Out of scope

- ~~**The live `/performance` endpoint** (Phase 2)~~ — **DONE 2026-06-22**, see
  "Phase 2 — live lifecycle endpoint" above. The `ren`/`hana` build landed in the
  same epic rather than a separate follow-up issue; only the operator deploy
  (`sam deploy` + PR-publish wiring) remains.
- **Authoritative GitHub merge-metadata PR split** (Phase 2.1) — having the
  reducer read GitHub's `mergedBy` / `autopilot:*` labels for the exact
  autopilot-vs-human split, replacing the git "no human author" proxy. Its own
  follow-up (needs a GitHub token in the reducer, like config-digest).
- **Real-time / streaming** updates — the surface is a daily roll-up, not a live
  socket.
- **Cross-project comparison / ranking views** ("which project converts best") —
  a later deck once the per-project series proves out.
- **Any new credential type or endpoint auth change** — reuses the existing
  public-read agents-api surface; no Epic-010 trust-boundary change.
