# ADR-0040 — Per-`(agent, skill)` dispatch marker replaces the any-skill `last_run_at` dedup key

- **Status**: Proposed
- **Date**: 2026-09-26
- **Deciders**: `wf:dario` (proposed) / operator (ratify)
- **Epics**: [012](../epics/epic-012-agent-experience.md) (agent-experience surface `last_run_at` was written for)

## Context

`workforce/lambdas/orchestrator/handler.ts`'s per-tick dedup guard
(`evaluateBinding`) exists to stop a binding from firing twice inside one
`TICK_WINDOW_MINUTES=120` window — the header comment calls it "guards
against same-window double-fire", and `DEDUP_MINUTES_BY_SKILL` carries six
per-skill tuned windows with reasoning attached (e.g. `feed-post: 30`,
explicitly commented *"must stay short: dedup keys on `agent.last_run_at`
(any skill), so a long window would starve feed-post on multi-binding
agents"*).

The guard reads `agent.last_run_at` (`handler.ts:502-514`). **Nothing writes
that field.** `grep -rn "last_run_at" workforce/lambdas` turns up: this read,
the `AgentOperational` type declaration (`shared/agent.ts:196`), and one
read-only display fallback in `agents-api/handler.ts:622`
(`lastRow?.started_at ?? meta.last_run_at ?? ""`, itself sourced from the
most recent `EXEC#` row, not the META field). No `UpdateItem` call anywhere
sets `AGENT#{slug}/META.last_run_at`. Confirmed against live `wf-table-prod`:
absent on most agents, three-months-stale where present (`nadia`: 2026-06-06,
`ren`: 2026-06-05) — leftovers from the retired `wf-agent-runner` Lambda
(ADR-0007 migration). The guard's branch has been dead since June: `if
(agent.last_run_at)` is `false` for most agents, and stale-but-present for
the rest never falls inside any `dedupMin` window measured in tens of
minutes.

This stopped being cosmetic once **#678** made the W-3 modelled cost charge
follow the dispatch decision: a re-dispatch inside the same tick window is
now also a re-*charge*, and nothing in the tick catches a Lambda-retry
re-scan (EventBridge async invoke retries by default) from re-dispatching
the same binding twice.

**The obvious fix is wrong.** Simply starting to write `last_run_at` on
every dispatch would activate a dormant guard whose key is *any skill*, not
the bound one — the code's own comment says so. A multi-binding agent (most
of them: R-N8 gives every agent the same binding shape, and Epic-021+ has
been adding multi-skill agents) would have a later binding in the same tick
skipped because an unrelated earlier skill just ran. That is a silent
behaviour change to dispatch for every multi-binding agent at once, on a
component the code already flags as the wrong lever: *"A per-skill last-run
index lives at GSI1 in v2."*

## Decision

Key the dedup guard on **`(agent, skill)`**, not `(agent)`, by adding one
new operational field to the `AGENT#{slug}/META` row and reading/writing it
in place of the scalar `last_run_at`:

```ts
// shared/agent.ts — AgentOperational
last_dispatch_by_skill?: Record<string, string>; // skill name -> ISO timestamp of the last tick that dispatched it
```

- **Read** (`evaluateBinding`): replace `agent.last_run_at` with
  `agent.last_dispatch_by_skill?.[binding.skill]` as the dedup timestamp
  compared against `dedupMin`.
- **Write**: the orchestrator's per-binding scan loop (`handler.ts` around
  the `ccrBatchByRoutine.set(routineId, slot)` call, i.e. the point where a
  task is actually accepted into the fire batch — not merely where
  `evaluateBinding` returns `{action: "dispatch"}`, since a later per-task
  prep error must not stamp a marker for work that never left the tick)
  calls `updateOperational(agent.pk, agent.sk, { [\`last_dispatch_by_skill.${binding.skill}\`]: tickedAt })`.
  The orchestrator already holds the `UpdateItem` grant this uses today for
  the DELIV# promotion path (`handler.ts:480,491`) and the ADR-0037 budget
  stamp (`recordCapReached`) — no new IAM surface.
- **No new partition, no new GSI.** One nested map field on the row every
  consumer already reads on every tick (`scanPrefix` over `AGENT#`), so the
  guard's read stays the single GET it is today. This is R-N2 (single state
  store) and R-N8 (data-shape uniformity: no per-agent branch, the field
  exists on every row, empty for an agent that has never dispatched)
  applied to the smallest change that makes the guard's own stated key
  correct.
- **No flag day.** An agent with no `last_dispatch_by_skill` entry for a
  skill behaves exactly as an absent `last_run_at` does today — the branch
  is skipped and the binding dispatches. The first tick after deploy sees
  an empty map everywhere and changes nothing; the guard only starts
  binding correctly from the first dispatch it itself records.
- **`last_run_at` (scalar) is left in place, unwritten, for this ADR.**
  `agents-api/handler.ts:622`'s display fallback already prefers the live
  `EXEC#` row and only reads the META scalar as a last resort; deciding
  whether to backfill it from the same write path, or retire the field
  entirely once nothing reads it as a fallback, is a separate, smaller
  follow-up (see Consequences) — bundling it here would make one ADR own
  two unrelated call sites (the scheduler's own correctness vs. a UI
  display fallback).

## Alternatives considered

1. **A `DISPATCH#{yyyy-mm-dd}` partition, keyed `AGENT#{slug}#SKILL#{name}`.**
   Cleaner separation between "current dedup state" and "AGENT# identity
   row", and would give a per-day dispatch history for free (useful for a
   future audit view). Rejected for v1: it is a new partition shape (R-N8
   asks "same DDB row shapes" across agents, and this adds one), a second
   `GetItem`/`Query` per binding evaluation (today's guard is a field read
   off the row `evaluateBinding` already has in memory), and the guard has
   no use for history — it only ever needs the single most recent
   dispatch per skill. Worth revisiting if the audit-history need becomes
   real; until then it is a data-model addition to buy a use case nobody
   has asked for.
2. **Just start writing the existing scalar `last_run_at`.** Rejected per
   the Context section — it activates the any-skill key the comment
   already identifies as wrong, changing dispatch behaviour for every
   multi-binding agent simultaneously with no opt-in and no test coverage
   of the new behaviour.
3. **Do nothing; shorten `TICK_WINDOW_MINUTES` or the per-skill windows
   instead.** Rejected: per R-N11's own diagnosis discipline (adr-0038),
   "an unworked queue and a slow worker emit the same signal" — shrinking a
   window to paper over a guard that never fires hides the defect instead
   of fixing it, and does nothing about a same-instant Lambda retry, which
   is the actual double-dispatch vector named in #685.

## Consequences

- **What it costs.** One extra `UpdateItem` per successful dispatch (the
  orchestrator already writes on the DELIV#-promotion and budget-stamp
  paths in the same handler, so this is not a new write pattern, just one
  more call site). `AgentMetaRow` grows one optional field that every
  future agents-api / console consumer of the META row now needs to know
  is dedup-internal state, not identity — worth a one-line note in
  `workforce/docs/data-model.md`'s `AGENT#` row section when this lands.
- **What it forecloses.** Per-skill dispatch history (when was `feed-post`
  last fired, three fires ago) is still not queryable — only the most
  recent timestamp per skill is kept. If that history becomes a real need,
  Alternative 1 is the natural upgrade path and does not conflict with this
  shape (the map can be dropped once the partition ships, or kept as a
  cheap current-state cache in front of it).
- **How this would be reversed.** Revert the read in `evaluateBinding` to
  `agent.last_run_at` and stop writing the map — the field simply stops
  being read; no migration needed since nothing else depends on it existing
  once the guard doesn't.
- **What would tell us it was wrong.** A dedup skip firing for the *wrong*
  skill on a multi-binding agent post-deploy (the exact false-positive this
  ADR exists to remove) means the map's write path landed on the wrong key,
  or a consumer is still reading the old scalar.
- **Explicitly out of scope.** Backfilling or retiring the unwritten
  `last_run_at` scalar and its `agents-api/handler.ts:622` display fallback;
  a per-skill dispatch **history** view (Alternative 1); anything about the
  W-3 budget ledger beyond confirming this closes the re-charge vector
  #678 opened — the ledger's own accounting is unchanged by this ADR.

## Acceptance (from #685, carried forward for whoever implements this)

- `agent.last_dispatch_by_skill[skill]` exists at runtime after a real
  dispatch, verified against live rows post-deploy — not merely asserted
  in a unit test.
- A regression test in `workforce/lambdas/orchestrator/handler-tests.ts`
  that dispatches binding A of skill `x`, re-evaluates the same tick
  window, and asserts binding A is skipped (`dedup_window`) while a
  sibling binding of skill `y` on the **same agent** in the **same tick**
  still dispatches — the false-positive this ADR removes.
- Confirmation (can be a follow-up comment on #678, not new work here)
  that the budget ledger cannot be charged twice for one logical fire now
  that the guard's key matches what actually needs deduplicating.

## Related

- [#685](https://github.com/refluster/ai-native-article/issues/685) — the
  filing issue; carries the live-row evidence and the two candidate shapes
  this ADR chooses between.
- [#678](https://github.com/refluster/ai-native-article/issues/678),
  [#663](https://github.com/refluster/ai-native-article/issues/663) — why
  the guard is now load-bearing for money, and the "declared vs. actually
  running" defect class #685 is an instance of.
- [ADR-0007](adr-0007-agent-config-single-source.md) — the `AGENT#{slug}/META`
  row this field extends, and the retirement of the git-tree `wf-agent-runner`
  Lambda that left `last_run_at` orphaned.
- [ADR-0037](adr-0037-advisory-per-agent-budget.md) — the existing
  once-per-tick conditional-stamp pattern (`recordCapReached`) this ADR's
  write path mirrors.
