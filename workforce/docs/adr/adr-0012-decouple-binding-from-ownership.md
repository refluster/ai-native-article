# ADR-0012 — Binding is decoupled from skill ownership: any agent may bind any skill

- **Status**: Proposed (operator ratifies by merging the implementation PR)
- **Date**: 2026-06-21
- **Deciders**: operator, mateo (VP Agent Workforce Platform)
- **Epics**: [008](../epics/epic-008-skill-repository.md)
- **Related**: [ADR-0007](adr-0007-agent-config-single-source.md) (agent-config single source / write-time validator), [ADR-0008](adr-0008-skill-config-single-source.md) (skill judgment-config single source)

## Context

Until now, binding an agent to a skill required the agent's slug to appear in
that skill's `owners[]`. The rule (`R8-binding-skill-owner`) was enforced in
two places:

1. **The write-time validator** (`workforce/lambdas/shared/agent-config.ts`):
   `validateBinding` rejected a binding whose `ctx.slug` was not in the
   target skill's `owners[]`.
2. **The console picker** (`workforce/app/src/lib/agents.ts:fetchBindableSkills`
   + `BindingsEditor.tsx`): the add-binding `<select>` was populated with
   `GET /skills?owner={slug}`, so the operator could only *see* the skills the
   agent already owned. Binding any other skill meant first amending the
   skill's `owners[]` (a second audited write), and before ADR-0008 that
   amendment cost a deploy.

A third, downstream guard followed from the same coupling — `R8-reverse` in
`PATCH /skills/{name}`, which blocked shrinking `owners[]` if some agent still
had a live binding on the skill (an owners-shrink would otherwise orphan that
binding into a future 422).

This coupling conflates two unrelated concepts:

- **Ownership** = *who is responsible for a skill's judgment text* — the
  Rule-11 bump authority, the authorship credit, the `improvement_agent`
  lineage. A small, curated set.
- **Binding** = *which agents run a skill on a cadence*. Operationally this
  is the `(agent × skill × project)` composition the platform performs at fire
  time; there is no reason a runner must also be a maintainer.

The result was operator friction (the "add to owners first" two-step), a
limited console picker that hid most of the repository, and an extra guard
(`R8-reverse`) that existed only to protect an invariant the coupling created.
The operator's instruction (2026-06-21): drop the limitation — every agent can
be bound to every skill; simplify.

## Decision

**Decouple binding from ownership. Any agent may bind any *existing* skill.
The binding validator keeps the existence cross-check (`R8-binding-skill-exists`)
and drops the ownership cross-check (`R8-binding-skill-owner`). `owners[]`
retains its authorship / Rule-11 / `improvement_agent` meaning only; it no
longer gates bindings.**

Concretely:

1. **Validator** (`shared/agent-config.ts`): `validateBinding` no longer emits
   `R8-binding-skill-owner`. A binding to a skill with no `SKILL#` row still
   fails (`R8-binding-skill-exists`) — binding a *non-existent* skill is still
   an error. The now-unused `IdentityPatchContext.slug` field is removed.
2. **Reverse guard retired** (`agents-api/handler.ts`): the `R8-reverse`
   owners-shrink guard in `PATCH /skills/{name}` is removed. With binding
   decoupled from ownership, shrinking `owners[]` can never orphan a binding,
   so the guard protected nothing.
3. **Console picker** (`app/src/lib/agents.ts` + `BindingsEditor.tsx`):
   `fetchBindableSkills()` lists **all active skills** (`GET /skills?status=active`)
   instead of `?owner={slug}`. The empty-state copy ("add {slug} to owners
   first") is replaced — the only empty state now is a genuinely empty
   repository.

Everything else about `owners[]` is unchanged: it is still validated
(must-exist, non-archived, owner-slug shape, no-duplicate), still drives
Rule-11 skill-body bump authority, and still surfaces on the skill page.

## Alternatives considered

- **Keep the owner gate, widen owners[] in bulk.** Rejected: it keeps the
  conceptual conflation and the two-step ("own then bind") the operator
  explicitly wants gone; every new binding still needs an owners amendment.
- **Make the console picker show all skills but keep the server gate.**
  Rejected: a picker that offers skills the server will 422 is a worse UX than
  the limited picker. The gate has to go server-side too, or not at all.
- **Add a separate `binders[]` set distinct from `owners[]`.** Rejected:
  this is the C-3 over-engineering reflex — a second access-control list to
  maintain for a single-operator hobby workforce. The instruction is to
  *simplify*; the existence check is sufficient.

## Consequences

- **Positive.** The "add to owners first" two-step disappears; the console
  bind picker shows the full active repository; one mechanical guard
  (`R8-reverse`) and one context field (`slug`) are deleted. `owners[]` now
  means exactly one thing (authorship/maintenance).
- **Accepted costs.** (a) Loosens a write-time check — a Zone A change
  (this ADR + the governance.md §4 R-N4 amendment), ratified by the operator
  merging. (b) An agent can now be bound to a skill it has no authorship stake
  in; this is intended, and the binding still carries `project_id` + audit, so
  every fire is attributable. (c) `owners[]` and `bindings[]` are now fully
  independent edits — neither constrains the other.
- **Not changed.** The skill must still **exist** to be bound
  (`R8-binding-skill-exists`); executor/scheduler allowlists, the G1 cadence
  floor, the CCR-batch `project_id` requirement, and all `owners[]` shape
  validation are untouched.

## Related

- Root `docs/governance.md` R-11 citation gate: this PR cites this ADR.
- `workforce/docs/governance.md` §4 R-N4 — amended to drop "ownership" from the
  binding cross-check description.
- `workforce/docs/runbooks/bindings.md`, `agent-registration.md` — updated to
  drop the owners-prerequisite step.
