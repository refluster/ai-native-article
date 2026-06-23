# ADR-0013 — pr-autopilot fires on PR-open via a CCR-native `github_event` trigger

- **Status**: Proposed
- **Date**: 2026-06-22
- **Deciders**: mateo, sana (proposed) / operator (ratifies — touches L0/L1)
- **Epics**: serves the pr-autopilot cadence (adr-0010 / adr-0011); refines adr-0005

## Context

`pr-autopilot` is the workforce's LLM-judgment cadence: it routes an open PR to
reviewer personas, applies each lens, synthesises the consensus verdict, and —
for a non-L0/L1 unanimous green — merges (adr-0010 / adr-0011). Today it fires
**only on a cron**: `wf-orchestrator-tick` evaluates nadia's binding
(`scheduler: external`, `invoked_by: api`, `cron: 0 */2 * * ? *`) every ~2h and
dispatches the CCR `agent-runner` routine, which discovers candidate PRs via
`pr-autopilot-scan.mjs` and processes them (`workforce/lambdas/orchestrator/handler.ts`,
`workforce/lambdas/shared/ccr-fire.ts`).

The operator wants a PR to be picked up **when it is opened**, not up to ~2h
later. Two facts shape the answer:

1. **The schema already has the field.** `BindingTrigger.github_event`
   (`workforce/lambdas/shared/agent.ts`) is declared and the write-validator
   accepts a CCR binding triggered by `github_event` OR `cron`
   (`agent-config.ts` S9-binding-ccr-trigger). But **no workforce code consumes
   `github_event`** — the orchestrator only evaluates crons. The event path is a
   *trigger-model* gap, not a missing field.
2. **CCR is the execution substrate (adr-0005).** The judgment legs (route /
   review / verdict) need an LLM; adr-0005 makes **one** execution model — the
   CCR `agent-runner` routine — authoritative. Any event path must keep the
   cadence running as that same CCR task, or it forks the execution model.

The operator's question was literally *"is this a governance edit, or a skill
edit?"* — i.e. where does the change belong. This ADR answers that.

## Decision

**Fire pr-autopilot on `pull_request` events through a CCR-native
`github_event` trigger — the same CCR routine, a different trigger — not a new
in-repo workflow or Lambda.**

Concretely:

1. **The binding declares the event trigger** (the org-design change, in data):
   nadia's pr-autopilot binding moves from the orchestrator-cron shape to
   ```jsonc
   {
     "skill": "pr-autopilot",
     "executor": "claude-code-routine",
     "trigger": {
       "scheduler": "claude-code-routine",
       "github_event": "pull_request.opened",   // + .ready_for_review, .synchronize
       "cron": "0 */2 * * ? *"                    // KEPT as the safety-net sweep
     },
     "routine_spec": "workforce/docs/routines/agent-runner.md",
     "project_id": "agent-workforce",             // this repo; + the asp-cloud binding
     "config": { /* nomination_rules, cycle_cap, … unchanged */ }
   }
   ```
   The cron is **retained** as a backstop: if an event is missed (webhook
   outage), the ≤2h sweep still catches the PR. Event = latency floor; cron =
   completeness floor. (`effectiveSchedule` already renders a load-bearing cron
   on `claude-code-routine` as live, so the console stays honest.)

2. **The CCR routine carries the GitHub trigger** (operator runbook, not repo
   code): in claude.ai/code the `agent-runner` routine is configured with a
   `pull_request` trigger and the target repo's webhook points at it. This is
   the FU-002 instantiation step — the event ingestion + webhook-signature
   handling are CCR's responsibility, so the workforce adds **no** webhook
   receiver of its own.

3. **The cadence is trigger-agnostic.** `pr-autopilot-scan.mjs` discovers *which*
   open PRs need a cycle-1 routing comment and skips ones already routed — so a
   run fired by an event and a run fired by cron do the identical, idempotent
   thing (the event run simply happens seconds after open). No change to the
   route→review→verdict→merge logic. The SKILL.md header is updated from
   "CCR cron-poll routing leg" to "cron **or** `github_event`"; the body is
   unchanged.

**Where the change lives (the operator's question, answered):** a **binding**
(data, agents-api PATCH), this **ADR**, and a one-line **SKILL.md** contract
note. **Not** `docs/governance.md`, and **no** new `.github/workflows/**` file
or Lambda — Method 1 stays inside adr-0005's single execution model.

## Alternatives considered

- **Method 2 — GHA workflow on `pull_request` → `repository_dispatch` →
  orchestrator.** A `.github/workflows/pr-autopilot.yml` fires the orchestrator,
  which dispatches the CCR. Fully in-repo and version-controlled, and a clean
  fallback — but it adds an L0/L1 workflow, a new multi-source branch in
  `orchestrator/handler.ts` (L0/L1), and a `governance.md` L0/L1-block edit, for
  a path that still ends in the same CCR fire. **Named as the in-house fallback**
  if CCR-native `github_event` triggers prove insufficient (e.g. the trigger
  class isn't available for a given repo), because it depends on nothing outside
  our control.
- **Method 3 — a workforce webhook-receiver Lambda + API Gateway route.** Most
  decoupled and fastest, but a new Lambda + infra surface (signature validation,
  DLQ, alarms) duplicating what CCR already does. Rejected as over-built for a
  single-operator cadence (C-3); revisit only if a project-generic event ingress
  is needed.
- **Do nothing (cron only).** Rejected: a ≤2h latency floor is the exact gap the
  operator asked to close.

## Consequences

- **Latency drops from ≤2h to seconds** on PR-open, with the cron sweep retained
  as the completeness backstop — no regression if a webhook is dropped.
- **Execution model unchanged (adr-0005 intact):** still one CCR routine, one
  composition `(persona × skill × binding-config × project creds)`. No second
  LLM execution surface, no new infra.
- **Operator runbook step (B-authority):** configure the
  `agent-runner` routine's `pull_request` trigger in claude.ai and register the
  target repo webhook (FU-002). Until that is done, the cron path keeps working —
  so this ADR is safe to land before the runtime wiring exists.
- **Coupling to CCR event ingestion:** if CCR cannot trigger on `github_event`
  for a repo, fall back to Method 2 (no other part of the design changes — the
  binding/skill stay; only the *delivery* of the fire changes).
- **Own-repo coverage:** an `agent-workforce` (this repo) pr-autopilot binding is
  added so PRs here are auto-routed too — today that cadence is session-driven
  (run by hand); this makes it a first-class binding like the asp-cloud one.
- **No L0/L1 predicate loosened:** the merge gate (adr-0010 `pr-merge.mjs`,
  fail-closed) is untouched; this changes only *when* the cadence starts.

## Related

- [adr-0005](adr-0005-single-execution-model-ccr.md) — the single CCR execution model this stays within.
- [adr-0010](adr-0010-autopilot-merge-consensus-widening.md) / [adr-0011](adr-0011-own-repo-autopilot-merge.md) — the merge predicate the cadence ends in (unchanged).
- [bindings.md](../runbooks/bindings.md) — `BindingTrigger.github_event`, executor×scheduler compatibility, `effectiveSchedule`.
- [pr-autopilot/SKILL.md](../../skills/pr-autopilot/SKILL.md) — the cadence contract (trigger-agnostic discovery).
- FU-002 (follow-ups.md) — the CCR routine instantiation this ADR resolves.
