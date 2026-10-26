# ADR-0041 — A binding retires by marking `retired_at`/`retired_reason` in place, never by deletion from `bindings[]`

- **Status**: Proposed (operator ratifies by merging the implementation PR)
- **Date**: 2026-09-27
- **Deciders**: dario (drafted), operator (ratifies)
- **Epics**: [008](../epics/epic-008-skill-repository.md)

## Context

Split from #704 (item 3), itself re-filed from #666. Teo's asymmetry, quoted
via Priya in #666:

> 人格を退任させるときには、それを記録する印が二つ用意されている。しかし一つの
> 業務だけを退役させるときには、その印が一つもない。名前のある人を降ろすことは
> 監査できるが、名前のない仕事を降ろすことは、跡形も残らない。

Retiring a **persona** is recorded twice over: the identity-change `AUDIT#`
trail (every PATCH to an `AGENT#{slug}/META` row is appended there per
[ADR-0007](adr-0007-agent-config-single-source.md) Decision §4) and the
`archived` flag itself (`AgentOperational.archived`,
`workforce/lambdas/shared/agent.ts:195`). Retiring one **binding** out of an
agent's `bindings[]` leaves neither: `AgentBinding`
(`workforce/lambdas/shared/agent.ts:43-86`) has no `status` / `retired_at`
field or equivalent, so the only way to stop a cadence today is to delete its
entry from the array. `agents-api`'s `AUDIT#` trail (Decision §4 above) does
retain the deleted entry's "before" shape as a diff on that PATCH — but only
as one line buried in an append-only log, not a discoverable, queryable
"this binding was retired, here's when and why" the way a persona's own
retirement is.

W-3 charges the monthly ledger for every live binding
([ADR-0037](adr-0037-advisory-per-agent-budget.md)'s advisory model still
*reports* a modelled cost per binding). An orphaned or superseded binding
that nobody marked retired is a budget line with no deliverable and no
record of the decision to stop it — the same "declared vs. actually
enforced" gap #663 named for capability declarations, now on the scheduling
side.

The closest existing precedent is not on `AgentBinding` at all:
`PROJECT#{project_id}/META` already pairs a lifecycle enum with a companion
timestamp (`status ∈ {active, archived}`, `archived_at?` —
[data-model.md](../data-model.md) `PROJECT#` row); the *skill*-level
precedent is a four-value enum (`active | stale | deprecated | archived`,
[ADR-0017](adr-0017-skill-lifecycle-api.md)). Neither is a literal fit: a
project or a skill can be in one of several states; a binding has exactly
two — bound and not — so an enum would carry redundant machinery, and the
already-shipped `AgentBinding.bound_at?` field (Epic-021 Story 4 follow-up,
`agent.ts:76-85`) already establishes the convention this decision extends:
an optional ISO timestamp whose *presence* is the state, no companion
boolean or enum needed.

## Decision

Add two optional fields to `AgentBinding`:

```ts
/** ISO 8601 instant this binding was retired. Presence = retired; absence =
 *  active. Never deleted from bindings[] once set — the array stays the
 *  queryable audit surface Teo's complaint asks for. */
retired_at?: string;
/** Free-text reason, required alongside retired_at (agents-api rejects one
 *  without the other). Mirrors why a persona's own AUDIT# trail records a
 *  `changes[]` diff, not just a bare flag flip. */
retired_reason?: string;
```

**Retiring a binding never deletes it from `bindings[]`.** A retired entry
stays in place, exactly as `AgentOperational.archived` keeps the whole agent
row rather than deleting it. This is the load-bearing call the issue names:
delete-from-array optimises for a clean list at the cost of losing the
"when/why" the moment it happens (today's failure mode); mark-in-place keeps
the array as the audit surface, at the cost of every consumer that iterates
`bindings[]` needing to skip retired entries explicitly.

**Consumers that must skip a retired binding:**

- The orchestrator tick-scan (`workforce/lambdas/orchestrator/handler.ts`,
  the per-binding loop currently starting at line 156) and the on-demand
  `handleDispatch` path (same file, line ~397) both already skip on
  `agent.archived || agent.paused` before reaching a binding. Add the same
  check one level down, per binding: `if (binding.retired_at) return
  skip(binding.skill, "binding_retired")` — same shape as the existing
  `agent.archived` / `agent.paused` skip, one level finer-grained.
- `agents-api`'s write-time validator (`shared/agent-config.ts:validateBinding`)
  gains a paired-field rule (sibling to the existing `S9-binding-*` /
  `R8-binding-skill-archived` family at that call site): reject a PATCH
  setting `retired_reason` with no `retired_at` (a stray reason with nothing
  retired is meaningless), and reject `retired_at` with no `retired_reason`
  (mirrors why the `AUDIT#` trail always carries a `changes[]` diff, never a
  bare flag).
- [`data-model.md`](../data-model.md)'s `AGENT#{slug}/META` row entry gets
  `retired_at?`, `retired_reason?` added to the `bindings[]` shape it
  documents inline.
- The console's binding list (out of scope of this ADR — a follow-up
  implementation PR) should render a retired entry distinctly rather than
  indistinguishably from a live one, so the array staying populated does not
  just move the "is this thing running?" confusion from the API to the UI.

**Un-retiring** is the same PATCH in reverse: clear both fields via the
existing bindings-array-replace path agents-api already uses for every other
binding mutation. No new endpoint.

## Alternatives considered

- **A `status: "active" | "retired"` enum on `AgentBinding`**, matching the
  skill-level convention's shape more literally. Rejected: a binding has
  exactly two states, so an enum adds a value with no third option to
  express, and it still needs a timestamp field alongside it to answer
  "when" — at which point it is strictly more surface than the
  presence-of-timestamp convention `bound_at` already established on this
  same struct, for the same information.
- **Delete from `bindings[]`, rely on the `AUDIT#` trail** (status quo).
  Rejected: this is precisely the failure #768 was filed to fix — the
  before-shape is there, but only as an undiscoverable diff inside an
  append-only log an operator has to know to go read, not a field a query
  or a UI can surface directly.
- **A separate `RETIRED_BINDING#` DDB row**, decoupled from the agent's own
  `META` row. Rejected: `bindings[]` already lives inline on `META`
  (R-N2/R-N8 — one state store, one shape per record family); a second row
  type for the same information duplicates a query path for no benefit a
  field addition doesn't already give.

## Consequences

- Every consumer that loops `agent.bindings` for anything beyond passive
  display (dispatch, budget estimation, the naming validator) must add one
  `if (binding.retired_at) continue/skip` check. This ADR's Decision section
  names the two dispatch call sites; a follow-up implementation PR is
  responsible for finding any others via `rg 'agent\.bindings\b'`.
- `bindings[]` grows monotonically and never shrinks on retirement, the same
  trade `AgentOperational.archived` already accepts at the whole-agent level.
  An agent with a long history will accumulate retired entries; nothing in
  this ADR proposes pruning them, since pruning is exactly the information
  loss the issue is about.
- Bindings deleted from the array **before** this ADR ships are not
  retroactively recoverable — their "before" shape lives only in whatever
  `AUDIT#` rows already captured it. This ADR prevents the pattern going
  forward; it does not backfill history.

**How this would be reversed:** un-retire via PATCH (above), or — if the
mark-in-place trade proves wrong in practice (the array becomes too large to
scan usefully, or the UI-legibility follow-up never lands and retired
bindings keep getting mistaken for live ones) — a superseding ADR moving
retired entries to a separate row, never an in-place rewrite of this one.
**What would tell us it was wrong:** the operator asking "wait, is `<skill>`
still running for `<agent>`?" about a binding that has a `retired_at` set —
that is this ADR's own motivating complaint recurring, and would mean the
mark-in-place trade didn't actually close the legibility gap it was chosen
to close.

## Explicitly out of scope

- The console UI rendering of retired bindings (implementation follow-up,
  not a design decision — no new pattern to choose).
- Whether a retired binding's removal-date rule mirrors #769's deprecation
  window (ADR-0042, sibling issue split from the same #704) — deferred until
  that ADR's field shape exists; deciding it here would be guessing at a
  dependency this ADR does not need to take.
- Backfilling `retired_at` on bindings already deleted from any agent's
  array before this ADR ships.

## Open review findings (carried at merge, PR #773 cycle 1 — 🟡, non-blocking)

The implementing PR must resolve or explicitly accept each of these:

- **D1 (`wf:dario`) — citation.** R-N2/R-N8 do not literally forbid a separate `RETIRED_BINDING#` row; the rejection of that alternative rests on "duplicates a query path for no benefit", not on those rules.
- **D2 (`wf:dario`) — uniqueness check.** `validateBindingUniqueness` keys on `skill@project_id` with no `retired_at` awareness; it must skip retired entries, or a new binding for the same pair after a retirement will collide with the never-deleted retired one.
- **H1 (`wf:hana`) — skip shape differs per call site.** `handleDispatch` can `return skip(...)`, but the tick-scan loop must push to `skipped[]` and `continue` (as the archived/paused skip does). Copying the shared snippet verbatim into the loop would `return` out of `handler()` and abort the rest of the tick.
- **N1 (`wf:nadia`) — follow-up issue.** The audit-trail closure depends on an `issue-implement` follow-up that has no issue number yet; file it when implementation starts.

## Related

- [ADR-0007](adr-0007-agent-config-single-source.md) — the `AGENT#{slug}/META`
  single-source model and its `AUDIT#` trail this ADR extends.
- [ADR-0017](adr-0017-skill-lifecycle-api.md) — the skill-level `status` enum
  this ADR consciously does *not* copy, and why.
- [ADR-0037](adr-0037-advisory-per-agent-budget.md) — the per-binding modelled
  cost this ADR's "why now" leans on.
- [#666](https://github.com/refluster/ai-native-article/issues/666),
  [#704](https://github.com/refluster/ai-native-article/issues/704),
  [#768](https://github.com/refluster/ai-native-article/issues/768) — the
  issue trail this ADR resolves.
- [ADR-0042](adr-0042-deprecation-removal-date-rule.md) — the sibling
  decision (split from the same parent) on requiring a removal date at
  deprecation time; explicitly not merged with this one (see Out of scope).
