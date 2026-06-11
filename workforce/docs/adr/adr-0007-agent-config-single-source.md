# ADR-0007 — Agent identity/config is single-sourced from DynamoDB; git definition files retire

- **Status**: Accepted (ratified by the operator via PR #286 merge, 2026-06-11)
- **Date**: 2026-06-11
- **Deciders**: operator
- **Epics**: [epic-006](../epics/epic-006-scalability.md), [epic-007](../epics/epic-007-agent-management-api.md)

## Context

The `AGENT#{slug}/META` row is a three-way merge of data with three different
owners (`workforce/lambdas/shared/agent.ts`):

| Slice | Fields | Authoritative source | Mutated by |
|---|---|---|---|
| **Identity / config** | `bindings[]`, `model`, `prompt_version`, `budget_monthly_usd_default`, `streams`, `system.md` content, … | `workforce/agents/{slug}/` (git) | PR + merge |
| **Operational** | `paused`, `archived`, `budget_monthly_usd_override`, `last_run_at`, `last_run_status` | the DDB row itself | agents-api PATCH, orchestrator |
| **Computed** | `runs_this_month`, `cost_this_month_usd`, `deliv_count_total` | the DDB row itself | runner roll-ups |

Only the first slice is duplicated: git is its declared source of truth, but
runtime consumers (orchestrator dispatch scan, agents-api GET) read the DDB
mirror, refreshed by a **manual, two-stage** sync (merge-triggered deploy
bakes `workforce/agents/**` into the `wf-seed-agents` artefact; the operator
must then remember to invoke the seed). This produced two concrete failure
modes, both observed:

1. **Forgotten seed.** A merged config change silently never takes effect
   (the PR #282 feed-post rollout, 2026-06-11 — a W-4 / C-4 anti-pattern).
2. **Seed-before-deploy race.** Seeding mid-deploy re-seeds the *previous*
   agents tree while reporting success.

Two single-source directions eliminate the drift class. An earlier draft of
this ADR chose **git-first** (build-time bundle into every consuming Lambda,
the `wf-messaging-reply` pattern; deploy = sync). The operator rejected that
direction on operational grounds: agent config is the workforce's *runtime
roster*, and routine adjustments (cadence, budgets, wiring a skill to a
persona) should not each cost a PR + review + data-plane deploy at
single-operator scale. Epic-007's original operator direction already pointed
here — "a DynamoDB-backed list with basic CRUD API operations" — and its v1
compromise (identity in git, operational overrides in DDB) is what created
the mirror this ADR removes. The operator's judgment: the governance value of
per-change PR review on config is real but disproportionate to its ceremony,
and can be preserved more cheaply by a **periodic (weekly) review of an audit
trail** plus mechanical write-time guards.

## Decision

**Make the DynamoDB `AGENT#{slug}` item family the only authoritative store
for agent identity/config, alongside the operational + computed slices it
already owns. All mutations flow through agents-api. Rebuild the governance
functions that git provided — validation, history, review — as DB-native
mechanisms. Retire the git definition tree and the seed.**

Concretely:

1. **Single store.** `AGENT#{slug}/META` carries identity/config
   authoritatively: `bindings[]`, `model`, `prompt_version`, budget defaults,
   `streams`, and the persona prompt (`system.md` content inline, or an S3
   object pointer if size warrants — implementation PR decides; both stores
   are already sanctioned by R-N2). `workforce/agents/{slug}/` is seeded into
   DDB one final time, then deleted from the repo (history preserves it).
   `wf-seed-agents`, `seed-agents.mjs`, and the `identity_hash` machinery
   retire with it.
2. **Single writer.** agents-api is the only mutation path (extends the
   existing PATCH to full CRUD over identity fields, IAM-auth as today).
   The orchestrator keeps scanning `AGENT#*/META` for dispatch — unchanged,
   since it already reads DDB. `wf-messaging-reply` migrates from its bundled
   file copy to reading the same rows (an in-VPC DDB read on an async path —
   the latency/availability objection to *GitHub*-at-runtime does not apply
   to the store the hot path already queries).
3. **Write-time validation replaces CI validation.** The JSON-schema checks
   in `validate-agent-json.mjs` move into a shared module enforced
   synchronously by agents-api on every write; invalid config is rejected at
   the boundary (W-4: fail loud, and earlier than CI did).
4. **Audit trail replaces git history.** Every config mutation appends an
   immutable `AGENT#{slug}/AUDIT#{iso-ts}` item: actor, field-level
   before/after diff, request context. No write path may bypass it (single
   writer makes this enforceable).
5. **Weekly review replaces per-change PR review.** A scheduled weekly
   digest — built on the existing EventBridge → orchestrator cadence
   machinery, not a parallel mechanism — compiles the week's AUDIT items
   into a reviewable summary for the operator (delivery surface:
   implementation PR decides; a GitHub issue is the default). Producing the
   digest is mechanical and fail-loud: a week with mutations but no digest
   is an alarm condition, so the review step cannot silently lapse the way
   the manual seed did. The human act is *reading* the digest, not
   remembering to assemble it.
6. **Blast-radius guards bound the unreviewed window.** Because review is
   now post-hoc (up to ~7 days), the API validator enforces mechanical
   ceilings an unreviewed change cannot exceed: a cadence floor (no binding
   may fire more often than the orchestrator tick), per-agent budget caps,
   and a model allowlist. These are L2-style limits; loosening one is a
   Zone B change.
7. **Durability.** Git no longer reconstructs the org, so the table gets
   point-in-time recovery plus a scheduled export to the existing S3 bucket.
   Environment rebuild = restore, not re-seed.
8. **Propagation contract: write = live.** A validated write is
   authoritative immediately; no deploy, no second step, no drift window.

### Rule amendments this decision entails (not applied in this PR)

Ratifying this ADR commits the operator to a follow-up governance PR that:

- Amends **W-5 / Rule 11** (an L0 amendment — explicit operator approval
  required per §3): "one persona's `system.md` bump per PR" becomes "one
  persona's prompt bump per write, each carrying its own AUDIT item and
  surfacing in the weekly digest." The discipline (atomic, reviewable,
  versioned persona changes) survives; the substrate changes.
- Updates the §3 zone table rows for `workforce/agents/{slug}/*` (the files
  cease to exist) to equivalent rows governing the API mutation classes.
- Re-words **R-N2** to note that agent config is now *state* in the R-N2
  sense, and names the audit/digest/export machinery as its guard.
- Marks epic-007's "identity stays in git" split as superseded by this ADR.
- Updates `docs/data-model.md`'s row catalogue (META becomes authoritative
  for identity; AUDIT items added).

## Alternatives considered

- **Git-first: build-time projection bundled into each consuming Lambda**
  (the previous draft of this ADR). Keeps PR review, CI validation, and git
  history intact with zero new machinery, and structurally eliminates drift
  via deploy = sync. Rejected by the operator: every routine config
  adjustment costs a PR plus a multi-minute data-plane deploy, runtime
  console editing stays impossible, and epic-007's CRUD-API direction stays
  permanently truncated to operational fields. What is genuinely given up by
  rejecting it — *pre-change* human gating — is consciously traded for
  post-hoc weekly review bounded by write-time guards (Decision §5–6).
- **Status quo + auto-seed appended to the deploy workflow.** Removes the
  forgotten-seed mode cheaply but keeps two authoritative-looking stores,
  the identity-hash machinery, and a mid-deploy disagreement window.
  Rejected as treating the symptom.
- **Read GitHub at runtime (orchestrator fetches agent.json per tick).**
  Couples every tick and every messaging reply to GitHub availability,
  credentials, and latency. Rejected; note this objection is specific to
  GitHub-as-runtime-dependency and does not apply to DDB, which the
  dispatch path already reads.
- **DDB-first without the audit/digest/guard machinery** (just open up
  PATCH). Rejected outright: config changes with no review, no history, and
  no ceilings is the C-4 anti-pattern as a *governance* property — silent
  degradation of the change-control layer itself.

## Consequences

- **Positive.** The config-drift failure class is structurally eliminated
  (one store, no mirror); the seed runbook step and both its failure modes
  disappear; config changes take effect in seconds without a deploy;
  agents-api becomes the full management surface epic-007 originally aimed
  at, unlocking console editing and (a future ADR) programmatic persona
  creation; `wf-messaging-reply` and the orchestrator converge on one supply
  chain for identity.
- **Accepted costs.** (a) Review of config changes is post-hoc — a bad-but-
  schema-valid change can run for up to a week before a human sees it,
  bounded by the Decision §6 ceilings. (b) The audit-trail, weekly-digest,
  and export machinery must be built and maintained — governance moves from
  "free with git" to "owned code." (c) Prompt changes lose git-diff review
  ergonomics; the weekly digest must render prompt diffs legibly or the W-5
  discipline degrades in practice. (d) Disaster recovery now depends on DDB
  PITR/exports, not `git clone`. (e) Local development reads prod-shaped
  config from a table, not the worktree.
- **Migration order.** (1) Extend agents-api with identity writes + AUDIT +
  validation + guards; (2) migrate `wf-messaging-reply` and any other
  bundled-file consumer to DDB reads; (3) final seed from the git tree;
  (4) ship the weekly digest; (5) governance amendment PR (W-5, zone table,
  R-N2, data-model); (6) delete `workforce/agents/**`, `wf-seed-agents`,
  `seed-agents.mjs`, `identity_hash`, and `validate-agent-json.mjs`'s
  agent-tree duty. Steps 1–4 precede 6; until 6, the git tree is frozen
  (changes go to DDB only) to avoid a two-master interregnum.
- **Until implemented**, the manual seed remains required after every
  `agent.json` merge; the operator runbook stands.

## Related

- [Epic-007](../epics/epic-007-agent-management-api.md) — this ADR completes
  its CRUD-API direction and supersedes its "identity stays in git" split.
- [ADR-0005](adr-0005-single-execution-model-ccr.md) — the CCR consolidation
  that left the orchestrator as the only META-scan consumer of `bindings[]`.
- `workforce/lambdas/messaging-reply/handler.ts` — the bundled-file consumer
  that must migrate (Decision §2).
- [docs/governance.md](../governance.md) W-5 and R-N2 — the rules the
  follow-up governance PR amends.
- Root [docs/governance.md §2 C-2](../../../docs/governance.md) — the
  newsletter's single-source invariant; this ADR is its workforce sibling
  with DDB, not git, as the master copy.
