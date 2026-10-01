# ADR-0007 — Registries record current state, not just events: owner + scheduled trigger on every dated commitment

- **Status**: Proposed
- **Date**: 2026-09-15
- **Deciders**: dario (proposal), operator (ratification pending)

## Context

Four workforce analysts, in four different letters this month, converged
independently on the same structural gap without consulting each other
(quoted in full in [#669](https://github.com/refluster/ai-native-article/issues/669)):

- **Tessa** — a registry can record *when* a rule takes effect, but not *how
  fast things are moving toward it*.
- **Ishaan** — a filing deadline was rewritten three times in a year; the
  record only ever shows "the current date," never that it's the third
  revision.
- **Astrid** — her own log can show what she did at a point in time, but not
  what she currently believes.
- **Grace** — she logged the same stalled concern on two consecutive days and
  the record cannot distinguish "just noticed" from "still true."

Two concrete, in-repo instances of the same shape:

1. **`docs/risk-acceptance-ledger.md`** has a `Re-eval` column (the date to
   look again) but no `Owner` column, and its own §1 states plainly: *"`Re-eval`
   in the past triggers a re-review, not auto-expiry"* — with nothing
   scheduled to notice. RAL-004, RAL-005 and RAL-006 have all sat at
   *"agent-proposed … awaiting operator sign-off"* since they were opened
   (2026-08-24 and 2026-09-07), and nothing pages anyone when that wait grows.
2. **`workforce/docs/follow-ups.md`** has `Owner` and `Status` but no due
   date; Priya's own 2026-08 proposal to add one sat in the same file,
   itself unimplemented, and her 2026-09 letter records that fact about
   herself: *"my diagnosis was correct, and I became the example of the side
   that didn't implement it."* Her backlog count — 49 named open items, 29
   genuinely unstarted — has not shrunk month over month.

Separately, **Maya's** 2026-09 §7 letter reports hypotheses A/B/C all missing
a shared 2026-08-31 deadline, and traces the cause precisely: *"setting a date
and building a mechanism that enforces the date are different jobs, and I had
only been doing the first one."* **Noor's** framing sharpens the fix: *"an
option with a deadline is not a risk — a risk has severity, an option has a
clock. Filing a clocked item as a risk loses the clock, because a low-severity
row simply waits."*

This is exactly the shape `governance-mechanisms.md`'s Engine A (the
memory→lint ratchet) already exists to fix for *code* failure modes, and
`ops-accountability-watch` (workforce) already runs a structurally identical
sweep — 6-month staleness on `docs/memory-lint-backlog.md`'s `watching` rows,
routed to a named owner. The registries this ADR concerns are missing the two
things that sweep depends on: a named owner per row, and a due-date column to
sweep against.

## Decision

Extend both governance registries with the minimum schema that lets a
scheduled sweep do what a human currently has to remember to do:

1. **`docs/risk-acceptance-ledger.md`** gains an `Owner` column (a persona
   slug or `operator`) — required, non-empty on every row, enforced by R-12
   the same way every other declared column already is.
2. **`workforce/docs/follow-ups.md`**'s Open table gains a `Due` column for
   rows whose `Target` names a concrete calendar date rather than an event
   ("next Epic", "story-6") — optional per row (many follow-ups are correctly
   event-triggered, not date-triggered), but when present it is swept the
   same way `Re-eval` is.
3. **Risk vs. option is a reading discipline, not a new table.** Per Noor's
   distinction: a ledger row is a *risk* (has a severity/why-accepted
   rationale, its `Re-eval` is a reconsider-if-still-relevant date) or it
   names a *time-limited option* (a decision with a clock — a hypothesis
   deadline, a regulatory date). A row of the second kind gets its `Re-eval`
   read as a hard trigger, not a soft one, and this distinction is stated in
   the ledger's own §1 operating rules rather than requiring a schema split —
   seven rows do not justify a third registry (see Alternatives).
4. **R-12** (`scripts/check-governance-registries.mjs`) requires `Owner`
   non-empty via the existing anchor-declared-column mechanism — the same
   generic empty-cell check every column already gets; no new validation
   logic.
5. **The scheduled trigger is `ops-accountability-watch`'s existing daily
   sweep, extended, not a new Cadence.** It already reads
   `docs/memory-lint-backlog.md` for 6-month-stale `watching` rows and routes
   each to a named owner via a GitHub Issue. The same sweep gains two more
   signals: `risk-acceptance-ledger.md` rows whose `Re-eval` date has passed,
   and `follow-ups.md` rows whose new `Due` date has passed — each routed to
   the row's own `Owner`/`Owner` column, exactly like the existing signal.

## Alternatives considered

- **Leave it to persona memory / the next retrospective.** Rejected — this is
  the finding itself, independently reached by four analysts in one month,
  and Priya is her own counter-example: diagnosing the gap did not close it.
- **A new, third "dated commitments" registry.** Rejected under
  `governance-mechanisms.md §4`'s anti-reinvention rule: the two existing
  registries are missing exactly two columns, not a different shape. A third
  registry duplicates R-12's parsing/enforcement machinery for no new
  capability.
- **A new scheduled Cadence dedicated to this sweep.** Rejected the same way:
  `ops-accountability-watch` already runs daily, already sweeps a staleness
  signal on one of these two files, and already has the owner-routing +
  issue-open-or-update machinery built and unit-tested
  (`owner-routing.mjs`/`signals.mjs`). Extending it is two more signal
  functions; a new Cadence would rebuild all of that.
- **Enforce the due-date check as a CI (PR) gate rather than a scheduled
  sweep.** Rejected — a stale date is a property of *time*, not of a diff, the
  same reasoning that put R-15 (corpus freshness) and R-19 (budget runway) on
  a daily cron instead of `ci.yml`. A PR gate cannot fire on a Tuesday when no
  PR is open.
- **Also solve "is this a new stall or a reconfirmation" (current-state, not
  just event-state) in this same ADR.** Rejected as scope creep — Tessa's,
  Astrid's and Grace's findings name a materially harder problem (a value
  that changes without a new row, i.e. state that needs a diff-over-time view,
  not a point-in-time cell). Explicitly out of scope below; the owner+trigger
  fix in this ADR is the cheap 80%, not the whole finding.

## Consequences

- **Positive.** RAL-004/005/006 (and any future signed-but-unrevisited row)
  get a named owner and a date a machine actually checks, closing exactly the
  gap Odette's and Silas's letters describe ("I pre-registered a date and
  nothing happened when it arrived"). `follow-ups.md` rows with a real
  deadline stop aging invisibly between Epic boundaries.
- **Cost.** Every existing `risk-acceptance-ledger.md` row (RAL-001…006) needs
  an `Owner` value backfilled in the same PR that adds the column, or R-12
  goes red on merge — implementation work, named below, not done here.
  `ops-accountability-watch`'s SKILL.md body edit is a Rule-11 version-bump PR
  (ADR-0017/0018 gate) plus `workforce:skills` — routine, but real work, and
  its own review.
- **What this does not fix.** "Is this the first time we've noticed X is
  still stalled, or the fifth?" (Tessa/Astrid/Grace) stays unsolved — filed as
  a candidate follow-up issue, not designed here.
- **Reversal.** Drop the two columns from the anchor + table (a normal doc
  edit); revert the `ops-accountability-watch` signal extension. Nothing this
  ADR proposes is irreversible or blocks on external state.
- **What would tell us this was wrong.** The new sweep signal pages an owner
  who cannot act on the finding more often than it pages one who can (i.e.
  owner routing itself needs the fix, not the trigger) — or the backfilled
  `Owner` column goes stale as fast as the un-owned rows did, meaning a named
  owner alone doesn't change behaviour without something enforcing follow-up
  on the routed issue.

## Out of scope

- Recording *current state* (a value's latest read, distinguishable from a
  re-confirmation) rather than *events* — Tessa's, Astrid's and Grace's
  sharper finding. Needs its own design (likely a "last confirmed" timestamp
  per row plus a diff-on-sweep, not a plain column) and its own ADR.
- Retroactively investigating why Priya's own 2026-08 proposal specifically
  went unimplemented for a month (a process question, not a schema one).
- Any change to `docs/memory-lint-backlog.md`'s schema — it already has the
  6-month watch rule and is not named in #669's finding.

## Related

- [ADR-0001](adr-0001-self-driving-governance-mechanisms.md) — the two
  registries and R-12, which this ADR extends rather than replaces.
- [governance.md §6.1](../governance.md#61-the-memorylint-ratchet), [§6.2](../governance.md#62-the-risk-acceptance-ledger) —
  the ratchet and ledger this ADR adds a scheduled trigger to.
- [governance-mechanisms.md §4](../governance-mechanisms.md#4-extending-the-machinery-anti-reinvention) —
  the anti-reinvention rule this ADR follows (extend, don't duplicate).
- [risk-acceptance-ledger.md](../risk-acceptance-ledger.md), [workforce/docs/follow-ups.md](../../workforce/docs/follow-ups.md) —
  the two registries.
- [workforce/skills/ops-accountability-watch/SKILL.md](../../workforce/skills/ops-accountability-watch/SKILL.md) —
  the existing Cadence this ADR extends instead of duplicating.
- [#669](https://github.com/refluster/ai-native-article/issues/669) — the
  issue this ADR answers; Part of [#659](https://github.com/refluster/ai-native-article/issues/659).
