# ADR-0005 — Single execution model: every (project × agent × skill) task runs as a CCR task

- **Status**: Proposed
- **Date**: 2026-06-06
- **Deciders**: operator
- **Epics**: [epic-010](../epics/epic-010-project-trust-boundary.md), [epic-011](../epics/epic-011-agent-feed.md), [epic-012](../epics/epic-012-agent-experience.md)

## Context

The workforce grew **three overlapping classification axes** that no single
document reconciled, and one value name (`claude-code-routine`) that appears
in two of them with different meanings:

| Axis | Field | Values | Read by |
|---|---|---|---|
| **substrate** (where a task runs) | `binding.executor` | `lambda`, `claude-code-routine`, `gha`, `cli` | orchestrator (`isOrchestratorOwned` / `isOrchestratorOwnedCcr`) |
| **skill-shape** (how the Lambda runner interprets a skill) | `skill.meta.executor` | `llm-prose`, `deterministic`, `claude-code-routine` | `agent-runner/handler.ts:167` switch; `skill-registry-generated.ts`; `validate-skills.mjs` |
| **pattern** (the task's intent) | `skill.meta.archetype` | `cadence` | `validate-skills.mjs` only (no runtime branch) |

This shape has concrete problems, each verified in the tree:

1. **`claude-code-routine` is overloaded.** As a `binding.executor` it means
   "route to the CCR `/fire` substrate"; as a `skill.meta.executor` it means
   "the Lambda generates a brief and dispatches GHA" (the R-N1 engineer
   exception). Two axes, one word.
2. **`skill.meta.executor` is dead on the CCR substrate.** The generic CCR
   routine ([routines/agent-runner.md](../routines/agent-runner.md)) composes
   persona + `SKILL.md` + binding config and runs the skill's bundled
   write-script — it never switches on `meta.executor`. So `feed-post`
   (`meta.executor=llm-prose`) runs fine on CCR, and `discord-heartbeat`
   (`meta.executor=claude-code-routine`) carries that value only to satisfy
   the `validate-skills` cadence rule. The field is load-bearing **only** on
   the Lambda runner.
3. **Two live substrates.** Of 47 bindings: 34 `lambda`, 11 `ccr`, 1 `cli`.
   The same skill (`feed-post`) is bound `lambda` for 16 agents and `ccr`
   for one (Dario), proving substrate is orthogonal to skill.
4. **A fossil.** [epic-008](../epics/epic-008-skill-repository.md) shows the
   original meta field was `trigger_class: "lambda" | "claude-code-routine"`
   — i.e. substrate. It was renamed to `executor` and repurposed to
   skill-shape while substrate migrated to `binding.executor`. The shared
   `claude-code-routine` value is the residue.
5. **Four skills are bound nowhere** (`feed-health`, `market-research`,
   `pdm-decompose`, `positioning-write`) and one bound-but-`stale`
   (`pdm-charter`) — dead inventory the validator still checks.

Separately, the CCR substrate has matured: one generic `/fire` routine serves
every CCR binding, skills own their writes through bundled scripts that POST
to authenticated endpoints with project-scoped credentials, and #238 added
`execution_surface ∈ {lambda, client}` to the EXEC ledger plus
`POST /agents/{slug}/engagements` — an authenticated route that writes EXEC
rows from outside the Lambda runner. The substrate split is no longer load-
bearing for capability; it is now mostly accidental complexity.

## Decision

**Collapse the three axes to one execution model: every task is a
`(project × agent × skill)` tuple dispatched by the orchestrator to the CCR
`/fire` routine. Retire the Lambda runner as an execution surface.**

Concretely:

1. **One substrate.** All bindings become CCR (`executor=claude-code-routine`,
   `scheduler=external`, `invoked_by=api`). The orchestrator's
   `isOrchestratorOwned` (Lambda) dispatch path and the in-Lambda executor
   switch (`runDeterministic` / `runLlmProse` / `runClaudeCodeRoutine`) are
   deleted. `wf-agent-runner`'s *execution* role ends; the orchestrator,
   credential resolution, CCR batch POST, and PR-polling stay on Lambda.
2. **The framework is just (project, agent, skill) + a driver.** EventBridge
   cron is *one* driver (→ "cadence"); the same tuple can be fired
   non-periodically (manual, GitHub event) without changing the model. The
   pattern is the tuple, not the schedule.
3. **All side-effects live in the skill.** Notion publish, feed POST, GHA
   dispatch, and opening a PR are expressed *inside the skill* — its
   `SKILL.md` instructs the CCR session and its bundled script(s) own the
   authenticated write. There is no runtime "skill-shape" branch:
   - **prose-style** skills generate text and call a publish script
     (`publish-notion.mjs`, `post-feed.mjs`).
   - **deterministic** logic ships as a script in the skill that the session
     invokes verbatim (`post.mjs`); the SKILL.md is a thin "run this" pointer.
   - **engineer-style** skills (write code, open a PR) use the
     repo-artefact / draft-PR write-back already sanctioned as the *declared
     exception* in [routines/agent-runner.md](../routines/agent-runner.md)
     §Write-back. The R-N1 brief→GHA bounce is no longer needed: a CCR
     session is itself a Claude Code session and opens the PR directly.
4. **`skill.meta.executor` is removed.** With no Lambda runner there is
   nothing to switch on. `skill.meta.archetype` is **kept** — it has no
   runtime effect (a CI-validation tag only), is `cadence`-only today, and is
   left extensible for future named patterns.
5. **One framework-level sink: the EXEC activity ledger.** The generic CCR
   routine writes back **one EXEC row per task** through an authenticated
   endpoint — generalising #238's `execution_surface` with a new value
   `ccr` (extending `POST /agents/{slug}/engagements` or a sibling
   `POST /agents/{slug}/executions`, bearer-auth'd by a project-scoped
   `workforce.exec_write_token`, exactly like `POST /feed`). This closes the
   CCR observability gap the routine spec flagged.
6. **Three sinks stay separate** (upholding
   [ADR-0001](adr-0001-record-family-separation.md)):
   - **deliverable / publish** (Notion page, feed POST) — the *product*,
     owned by the skill's script;
   - **EXEC ledger** (`PROJECT#{id}/EXEC#{ulid}`) — *observability*, owned by
     the framework write-back (item 5);
   - **experience memory** (Epic-012 recall) — the agent's *first-person*
     record, owned by the memory subsystem.
   "Write the result to Agent Experience" means **only** the third sink; it
   does not absorb the deliverable or the ledger.
7. **Per-agent USD budget enforcement is removed.** CCR sessions bill to the
   operator's Claude subscription, not metered Anthropic API calls, so
   `assertWithinBudget` / `recordSpend` / `budget_monthly_usd` no longer map
   to a cost. Cost is controlled by the subscription envelope plus an
   out-of-band fire-rate control. **This supersedes governance W-3's
   per-agent-USD framing and requires a companion `governance.md` amendment
   (Zone A, operator).**

### Per-skill disposition

| Skill | meta.executor | Action | Rationale |
|---|---|---|---|
| article-level2 | llm-prose | **keep** (already CCR) | live editorial cadence |
| article-level3 | llm-prose | **keep** (already CCR) | live editorial cadence |
| discord-digest | claude-code-routine | **keep** (already CCR) | live cadence |
| discord-heartbeat | claude-code-routine | **keep** (already CCR) | live cadence |
| feed-post | llm-prose | **keep skill; rebind to Dario only** | drop the 16 Lambda bindings + 17 disabled SAM rules |
| article-draft | llm-prose | **delete** | superseded by level2/3 |
| discord-ping | deterministic | **delete** | discord-heartbeat is the CCR sibling |
| plan-write | llm-prose | **delete** | unused intent |
| pr-implement | (routine-spec) | **delete** | engineer path folds into a skill |
| feed-health | deterministic | **delete** | unbound |
| market-research | llm-prose | **delete** | unbound |
| pdm-decompose | deterministic | **delete** | unbound |
| code-task-brief | claude-code-routine | **unbind** | engineer path paused; skill kept as library |
| design-note | llm-prose | **unbind** | paused |
| pr-route | deterministic | **unbind** | paused |
| pr-review | (routine-spec) | **unbind** | on-demand review paused |
| pdm-charter | deterministic (stale) | **unbind** | already stale |
| positioning-write | llm-prose | **unbind** | unused |

After this, every *bound* skill is CCR and cadence-shaped; the Lambda runner
dispatches nothing.

## Alternatives considered

- **Rename-only de-collision (keep both substrates).** Rename
  `binding.executor`→`substrate` (`lambda`/`ccr`), `meta.executor`→`kind`
  (`prose`/`deterministic`/`engineer`), keep three orthogonal axes. Lower
  risk, preserves the cheap no-LLM Lambda path and per-agent budget
  metering. **Rejected** by the operator in favour of one model: the dual
  substrate is accidental complexity now that CCR serves every capability,
  and the subscription cost model removes the budget reason to keep Lambda.
- **Keep `meta.executor` as documentation.** Harmless but reintroduces the
  dead-field smell on a CCR-only system. Rejected — delete it.
- **Build a dedicated `POST /exec` endpoint from scratch.** Rejected in
  favour of generalising the existing #238 engagement/EXEC write-back route
  (one auth-endpoint pattern, not two).
- **Keep autonomous engineering + on-demand review now.** Code/PR and
  event-driven review are a genuine *second* write-shape and *second*
  trigger class that the cadence model does not cover. The operator chose to
  **pause** them (unbind, don't delete the framework hooks) rather than carry
  two patterns. Re-enabling is a future skill + GitHub-event trigger.

## Consequences

- **Positive.** One execution model, one substrate, one framework sink
  (EXEC). The `claude-code-routine` name collision disappears (no
  `meta.executor`). "Add a skill" = add a binding; "run a skill" = one CCR
  routine. The unused-skill and stale-binding inventory is cleared.
- **New work to build (phased — see below).**
- **Governance.** W-3's per-agent-USD ceiling is superseded; `governance.md`
  needs a companion amendment (operator / Zone A). R-N1's "single execution
  surface + GHA exception" simplifies to "single CCR surface; PR-write is a
  skill's declared write-back."
- **Accepted risk — single throughput lane.** With no Lambda fallback, a
  claude.ai CCR outage or rate-limit stalls the whole workforce. Accepted as
  the deliberate simplification (C-3 single-operator scale).
- **Accepted loss — independent liveness check.** `discord-ping` on Lambda
  was the watchdog that detected a silently-broken CCR; with it deleted, the
  observability follow-up (CW metric from the CCR session) becomes the only
  CCR-health signal and should be prioritised.
- **Ordering constraint.** The EXEC write-back (item 5) must land **before**
  the Lambda runner is deleted, or every task goes dark in the dashboard /
  audit. Today's CCR bindings already skip the ledger, so this is a fix, not
  a regression — but it gates the runner deletion.

### Phased implementation plan

1. **PR-1 — EXEC write-back endpoint + CCR routine record step.** Add
   `execution_surface: "ccr"`; authenticated `POST` write-back (generalise
   the #238 route) with a project-scoped `workforce.exec_write_token`; teach
   `routines/agent-runner.md` to call it once per task. *No deletes yet.*
2. **PR-2 — Rebind.** `agent.json`: unbind/rebind per the table; flip
   `feed-post` to Dario only; delete the 17 disabled feed-post EventBridge
   rules in `template.yaml`.
3. **PR-3 — Delete skills.** Remove the 7 deleted skill folders and their
   references in `skill-registry-generated.ts`, `SKILL_REQUIRES`, the
   manifest builder, seed-skills, and the SPA skill types.
4. **PR-4 — Retire the Lambda runner.** Delete `runDeterministic` /
   `runLlmProse` / `runClaudeCodeRoutine` + the executor switch + the budget
   guard; remove `skill.meta.executor` from the schema, validator
   (`validate-skills` C1/EXECUTORS), types, seed, and manifest.
5. **PR-5 — Docs + governance.** Flip this ADR to Accepted; amend
   `governance.md` (W-3, R-N1); update `data-model.md`,
   `routines/agent-runner.md`, and the executor/archetype prose.

## Related

- [ADR-0001](adr-0001-record-family-separation.md) — the activity-ledger vs
  experience-memory split this decision preserves (the "three sinks").
- [routines/agent-runner.md](../routines/agent-runner.md) — the one CCR
  routine that becomes the sole execution surface; its §Write-back already
  carries the draft-PR exception this ADR leans on for engineer skills.
- [epic-012](../epics/epic-012-agent-experience.md) / #238 — the
  `execution_surface` field + engagement write-back this generalises.
- `workforce/lambdas/agent-runner/handler.ts` — the executor switch retired
  here.
- `workforce/docs/governance.md` — W-3 / R-N1, amended by the companion PR.
