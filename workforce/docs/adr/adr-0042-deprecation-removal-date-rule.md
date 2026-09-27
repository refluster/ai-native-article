# ADR-0042 — A `deprecated` skill must declare `deprecated_until` in the same write; enforced at the agents-api write boundary, not by a CI lint

- **Status**: Proposed (operator ratifies by merging the implementation PR)
- **Date**: 2026-09-27
- **Deciders**: dario (drafted), operator (ratifies)
- **Epics**: [008](../epics/epic-008-skill-repository.md)

## Context

Split from #704 (item 4), itself re-filed from #666. Mateo's outside-rule
pointer, from #666:

> あるコミュニケーション規約は拡張の入り口を用意すると同時に「一度非推奨にした
> ものは最低十二か月は残す」という撚去の規則を置いていた 【…】 入り口を作るとき
> に出口も作っている。私たちは前半だけをやってきました。

This repo has the entry mechanism — `SKILL#{name}/META.status ∈ {active,
stale, deprecated, archived}` ([ADR-0017](adr-0017-skill-lifecycle-api.md))
— and no written rule that flipping a skill to `deprecated` must name when
it goes away. Today that's tribal knowledge at best: `pdm-charter` has sat
at `status: "stale"` since 2026-06-06 (over three months, per the live
`GET /skills?status=stale` read as of this ADR) with no forcing function
either returning it to `active` or giving it a removal date — the exact
"declared but nothing keeps it true" gap #666 named for the whole enum, now
concretely aged on the one skill sitting in the pre-deprecation state.

The write path already exists and is exactly where a rule like this
mechanically belongs: `PATCH /skills/{name}` runs every mutation through
`shared/skill-config.ts:validateSkillPatch`, which already has a `J4-status`
rule rejecting an out-of-enum value (`skill-config.ts:110`). There is no
sibling rule today constraining what else must be true *when* `status`
takes the value `"deprecated"`.

## Decision

**1. Where the rule lives: [data-model.md](../data-model.md), not a new
`R-N` number in [governance.md](../governance.md) §4.** The R-N rules (§4)
are whole-architecture shape invariants — single state store, single naming
convention, PR-only external git surface (see R-N8's own framing: "data
shape uniformity… no per-agent exceptions"). This is a single-field
co-occurrence constraint on one row type (`SKILL#{name}/META`), the same
grain as the `PROJECT#` row's existing `archived_at?` companion to `status`
— which data-model.md documents inline, with no separate R-N entry. Adding
an R-N number for every field-pair constraint would dilute what R-N means;
this belongs next to the field it constrains.

**2. The rule itself.** Add `deprecated_until?: string` (ISO 8601 **date**,
not a duration) to the `SKILL#{name}/META` row, documented in data-model.md
next to the existing `status` description:

> `deprecated_until` — required, and meaningful, only when `status ===
> "deprecated"`. Must be at least 90 days from the write's timestamp.

**Ninety days, not Mateo's twelve months** — the issue's own instruction is
not to default-copy the example but to make an explicit call for this
repo's pace. Mateo's number comes from a wire protocol whose consumers are
external and slow to move; this repo's own skills are created, bound, and
retired on the order of weeks (#704 itself was filed, decomposed into four
child issues, and closed within 24 hours). A 12-month floor would leave a
`deprecated` skill sitting bindable-but-doomed for longer than most of this
repo's 42 current skill bundles have existed at all. Ninety days gives any
binding still pointing at it a full quarter to move off before the window
closes, without inheriting a timescale built for a different kind of
consumer. It is a **floor**, not a ceiling — a skill with wider blast radius
(more bindings, cross-project use) may declare a longer date; nothing here
rejects one.

**3. Enforcement: a write-time validator rule, not a CI lint.**
`shared/skill-config.ts:validateSkillPatch` gains a new rule (sibling to
`J4-status` at the same call site, e.g. `J5-status-deprecated-removal-date`)
that rejects a PATCH setting `status: "deprecated"` unless the same write
also carries a `deprecated_until` at least 90 days out — a 4xx at the API
boundary, the same discipline every other write-time guard in this family
already uses (`S9-binding-*`, `R8-binding-skill-archived`, `J4-status`
itself). `validateSkillCreate` already re-uses `validateSkillPatch`
(`skill-config.ts:203`), so a skill created already-deprecated is covered
for free.

A CI lint sibling to the `check-skill-*` family (`check-skill-spec-drift`,
`check-skill-version-sync`, `check-skill-body-version`) was the other
candidate and is **not** the primary gate: those checks police a git-authored
`meta.json` against the DDB row; `status` is mutated live via
`PATCH /skills/{name}` (ADR-0008/0017), a path with no PR and no CI run
attached to it. A lint that only fires on PRs touching `meta.json` would
miss every live PATCH — the exact mechanism `pdm-charter`'s three-month
stale state actually took. `skill-meta.schema.json` (the git-seed schema)
gets a matching optional `deprecated_until` property for symmetry, so a
skill authored already-deprecated in its git seed can declare the field too,
but this is documentation-of-shape, not the enforcement point.

**4. Deferred, not decided here: does a retired `AgentBinding` (ADR-0041,
split from the same #704 parent as this issue) get the same paired
removal-date requirement?** Flagging the dependency per the issue's own
routing note rather than deciding it silently: ADR-0041 lands
`retired_at`/`retired_reason` with no removal-date companion. Whether that
pair should also require one is a follow-up call once that shape exists,
not a decision this ADR reaches for it.

## Alternatives considered

- **A new `R-N12` in governance.md §4.** Rejected — see Decision §1: wrong
  grain for what R-N is for.
- **A CI lint as the sole/primary enforcement**, sibling to `check-skill-*`.
  Rejected as primary — see Decision §3: misses the live-PATCH path
  entirely, which is the only path that actually sets `status`. May still
  be worth a *secondary* drift-catch over git-seeded `meta.json` in a future
  PR; not this ADR's scope.
- **Copy Mateo's 12-month floor verbatim.** Rejected — see Decision §2: a
  floor sized for a different consumer population than this repo's own
  skills have.
- **No minimum window, just require the field be present.** Rejected: an
  empty forcing function (any date at all, including tomorrow or a
  100-year-out date meant to never bind) satisfies the letter of "declare a
  date" while defeating the purpose Mateo's example names — a floor is what
  makes the field load-bearing rather than decorative.

## Consequences

- Every future `PATCH /skills/{name}` that sets `status: "deprecated"` must
  also carry a valid `deprecated_until` in the same call — a small amount of
  added friction on the deprecation path, by design: an undated deprecation
  is exactly the failure #666 named.
- Existing rows already at `deprecated` (there are none as of this ADR — the
  live read returned zero) are not retroactively affected; the validator
  only gates future writes, not a backfill scan of stored rows. If any
  skill reaches `deprecated` before this ADR's implementation PR merges, it
  is grandfathered until its next PATCH.
- `pdm-charter`'s three-month-and-counting `stale` state is unaffected by
  this rule (it constrains `deprecated`, not `stale`) — naming it here as
  the concrete evidence the gap is real, not as something this ADR fixes.

**How this would be reversed:** a superseding ADR lowering or removing the
90-day floor, argued the same way this one raised it — against this repo's
observed pace of change, not by assertion.
**What would tell us it was wrong:** `deprecated_until` dates that get
silently pushed back by a later PATCH as they approach (a skill deprecated,
then re-deprecated with a later date, repeatedly) — that pattern would mean
the floor or its enforcement is too weak and needs tightening (a Zone A
amendment), not that the rule should be dropped.

## Explicitly out of scope

- Backfilling `deprecated_until` on any skill already `deprecated` before
  this ADR ships (none exist today, per the live check above; if one
  appears before the implementation PR merges, it is grandfathered per
  Consequences).
- Whether a retired `AgentBinding` (ADR-0041) needs the same paired rule —
  explicitly deferred, see Decision §4.
- A secondary CI lint over git-seeded `meta.json` drift for `deprecated`
  skills — may be worth adding later, alongside the `check-skill-*` family,
  but is not this ADR's enforcement point.

## Related

- [ADR-0017](adr-0017-skill-lifecycle-api.md) — the `status` enum this ADR
  adds a co-occurrence constraint to.
- [ADR-0008](adr-0008-skill-config-single-source.md) — the write path
  (`validateSkillPatch`) this ADR extends.
- [governance-mechanisms.md](../governance-mechanisms.md) — read before
  adding any gate; this ADR proposes a field-level constraint documented in
  data-model.md, deliberately not a new R-N gate (Decision §1).
- [#666](https://github.com/refluster/ai-native-article/issues/666),
  [#704](https://github.com/refluster/ai-native-article/issues/704),
  [#769](https://github.com/refluster/ai-native-article/issues/769) — the
  issue trail this ADR resolves.
- [ADR-0041](adr-0041-agent-binding-retirement-marker.md) — the sibling
  decision (split from the same parent) this ADR's Decision §4 names as an
  open dependency, not resolved here.
