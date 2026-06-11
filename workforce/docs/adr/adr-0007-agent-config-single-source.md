# ADR-0007 — Agent config is single-sourced from git; DDB holds only operational state

- **Status**: Proposed
- **Date**: 2026-06-11
- **Deciders**: operator
- **Epics**: [epic-006](../epics/epic-006-scalability.md), [epic-007](../epics/epic-007-agent-management-api.md)

## Context

The `AGENT#{slug}/META` row is a three-way merge of data with three different
owners (`workforce/lambdas/shared/agent.ts`):

| Slice | Fields | Authoritative source | Mutated by |
|---|---|---|---|
| **Identity / config** | `bindings[]`, `model`, `prompt_version`, `budget_monthly_usd_default`, `streams`, … | `workforce/agents/{slug}/agent.json` (git) | PR + merge |
| **Operational** | `paused`, `archived`, `budget_monthly_usd_override`, `last_run_at`, `last_run_status` | the DDB row itself | agents-api PATCH, orchestrator |
| **Computed** | `runs_this_month`, `cost_this_month_usd`, `deliv_count_total` | the DDB row itself | runner roll-ups |

Only the first slice is duplicated: git is its declared source of truth, but
runtime consumers (orchestrator dispatch scan, agents-api GET) read the DDB
mirror. The mirror is refreshed by a **manual, two-stage** sync: a merge to
`main` triggers the data-plane deploy, which bakes the `workforce/agents/**`
tree into the `wf-seed-agents` Lambda artefact (its Makefile copies the
tree); the operator must then remember to invoke it
(`node workforce/scripts/seed-agents.mjs prod`) to upsert the rows.

This shape has produced two concrete failure modes:

1. **Forgotten seed.** A merged config change silently never takes effect.
   Observed on 2026-06-11: the feed-post daily-cadence rollout (PR #282)
   merged green, and the orchestrator kept dispatching the old 2-hourly
   bindings until the operator was told, out of band, to run the seed. A
   silently-stale scheduler is the W-4 / C-4 anti-pattern — broken state
   that does not fail loud.
2. **Seed-before-deploy race.** Invoking the seed while the data-plane
   deploy is still running re-seeds the *previous* agents tree (the Lambda
   artefact is the data source), reporting success while writing stale
   config.

Meanwhile the codebase already contains the alternative, in production:
`wf-messaging-reply` reads `agents/{slug}/system.md` and `agent.json`
directly from its **own bundled copy** of the agents tree
(`messaging-reply/handler.ts` `AGENTS_ROOT`) — no DDB mirror, no seed, no
drift window. The same datum therefore has two supply chains today: bundled
file for messaging, seeded DDB row for dispatch and the API.

Supporting machinery that exists only to serve the mirror: the
`identity_hash` change-detection in `shared/identity-hash.ts`, the noop/upsert
accounting in `seed-agents/handler.ts`, and the `ensureSelfProject` call that
piggybacks on the seed pass.

## Decision

**Make git the only authoritative store for agent identity/config. Deliver
it to runtime as a build-time projection bundled into each consuming Lambda
artefact. Shrink the DDB row to the operational + computed slices it
uniquely owns. Retire the seed.**

Concretely:

1. `workforce/agents/{slug}/agent.json` + `system.md` are the sole source of
   identity/config. The SAM Makefile of every Lambda that needs identity at
   runtime (orchestrator, agents-api; messaging-reply already does) copies
   the agents tree into its artefact — the pattern `wf-seed-agents` and
   `wf-messaging-reply` already use, promoted from exception to rule.
2. A shared loader (`shared/agent-bundle.ts` or similar) reads the bundled
   tree; the orchestrator iterates bundled identities instead of scanning
   `AGENT#*/META` for config; agents-api composes its GET responses from
   bundled identity + the DDB state row.
3. The `AGENT#{slug}` DDB row keeps **only** operational + computed
   attributes. Identity attributes stop being written; the row is no longer
   a "definition mirror" (`docs/data-model.md` row catalogue updated
   accordingly).
4. `wf-seed-agents`, `workforce/scripts/seed-agents.mjs`, and the
   `identity_hash` machinery retire. `ensureSelfProject` rehomes to a path
   that still runs for every agent (orchestrator first-encounter or
   agents-api lazy-create — implementation PR decides).
5. Propagation contract: **deploy = sync.** The data-plane workflow already
   auto-triggers on `workforce/agents/**`; once it completes, every Lambda
   is serving the merged config. No second step exists to forget, and the
   stale-bundle race disappears because the artefact and the code ship
   atomically.

This is the workforce sibling of the newsletter's C-2 invariant: git is to
workforce config what Notion is to article content — every other copy is a
derived projection, rebuilt mechanically, never hand-refreshed.

## Alternatives considered

- **Status quo + auto-seed step appended to the deploy workflow.** Removes
  the forgotten-seed mode cheaply, but keeps two authoritative-looking
  stores, keeps the identity-hash/upsert machinery, and keeps a window where
  rows and artefacts disagree mid-deploy. Rejected as treating the symptom;
  it was the fallback if this ADR is not accepted.
- **DDB as the single source (edit config via console/API).** Reverses the
  governance model: `agent.json` edits are Zone B with PR review, CI
  validation (`validate-agent-json.mjs`), and git history; a DB-first source
  has none of those. Rejected outright.
- **Read GitHub at runtime (orchestrator fetches agent.json per tick).**
  Couples every 2-hourly tick — and every messaging reply — to GitHub
  availability, credentials, and latency, for data that changes a few times
  a week. Rejected; the build-time projection gets the same freshness
  (changes only land via deploy anyway) with zero runtime dependency.
- **Bundle into a Lambda layer instead of per-function copies.** Saves a few
  hundred KB of duplication across artefacts but adds a layer-versioning
  moving part; the agents tree is small (~hundreds of KB). Rejected for v1;
  revisit if artefact size ever matters.

## Consequences

- **Positive.** The config-drift failure class is structurally eliminated,
  not guarded against; the seed runbook step and its two failure modes
  disappear; one supply chain for identity instead of two; `data-model.md`'s
  agent row shrinks to fields with exactly one owner; the mental model
  matches the rest of the repo (build-time projections: skill registry
  codegen, SPA agent manifest, messaging-reply bundle).
- **Accepted costs.** (a) Config changes take effect only after a successful
  data-plane deploy — minutes of latency, already true for the
  messaging-reply path. (b) Every identity-consuming Lambda's artefact
  carries the agents tree. (c) Runtime config edits from the console remain
  impossible — unchanged: the PATCH endpoint is operational-only today.
  (d) Emergency controls are unaffected: `paused` / `archived` stay in DDB
  and keep working mid-incident without a deploy.
- **Migration.** Existing `META` rows retain stale identity attributes until
  a one-time cleanup (or are left in place and ignored — implementation PR
  decides, with a preference for cleanup so the row catalogue stays
  truthful). `ensureSelfProject` must be rehomed **before** the seed is
  deleted, or new agents lose their self-project row.
- **Until implemented**, the manual seed remains required after every
  `agent.json` merge; the operator runbook stands.

## Related

- [ADR-0005](adr-0005-single-execution-model-ccr.md) — the CCR
  consolidation that left the orchestrator as the only META-scan consumer
  of `bindings[]`.
- `workforce/lambdas/messaging-reply/handler.ts` — the in-production
  precedent for bundled identity.
- [docs/governance.md](../governance.md) R-N2 — DDB/S3 remain the stores for
  *state*; this ADR narrows "state" to exclude config mirrors.
- Root [docs/governance.md §2 C-2](../../../docs/governance.md) — the
  newsletter invariant this decision mirrors.
