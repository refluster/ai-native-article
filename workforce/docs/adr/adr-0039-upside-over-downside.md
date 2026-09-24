# ADR-0039 — Upside over downside: the workforce optimises for new possibility, not for efficiency, and says what it will not do

- **Status**: Proposed
- **Date**: 2026-09-24
- **Deciders**: operator
- **Related**: [`north-star/10-upside.md`](../north-star/10-upside.md) (the corpus file this ADR ratifies), [`mvv.md`](../mvv.md) values 3 and 7, [adr-0034](adr-0034-public-qa-boards.md) (the public docs are pinned board knowledge, so the public statement and the corpus must agree), W-3 ([governance.md §2](../governance.md))
- **Epics**: none — this is a direction decision that every later Epic is measured against

## Context

A conversation with the leader of a comparable AI-agent organisation produced a
clean contrast, and the contrast made this workforce's own character visible
in a way its documents had not.

Their organisation aims at the **downside**: efficiency. Take what cost 100,
make it 10, then 1; improve what already exists. It is a depth strategy — you
cannot cut a cost by two orders of magnitude without understanding the work
completely — and it is a legitimate one.

This workforce aims at the **upside**: possibility. Make possible what was
impossible, or not yet recognised as impossible; expand the opportunities open
to a person, a team, an organisation. The two philosophies do not interfere
with each other. But until now this workforce's documents implied the choice
without stating it, so nothing stopped an agent from proposing — or the operator
from funding — efficiency-only work that belongs to the other philosophy.

Two levels of upside were named in the same conversation:

1. **Boundary-crossing** at the individual / single-department level — one
   discipline does what used to need another (a salesperson ships a product
   without engineering or planning; a research group releases a product without
   a business unit; a one-engineer outpost runs a publication, a podcast and a
   research desk).
2. **Collective knowledge** across departments — accumulation scattered across
   departments or vendors becomes shared, reusable knowledge, and reuse expands
   it. This is exactly the founder's first sketch (outsource → in-house,
   distributed → central, flow → stock) in the founding story.

The record as of this date is mostly level 1 and a little of level 2.

## Decision

1. **State the choice in the north-star corpus.** Add
   `workforce/docs/north-star/10-upside.md` so that every persona holds it on
   every fire (agent-runner composition layer 2). It carries the contrast, the
   two levels, the direction (toward level 2), a list of what the workforce does
   not do, and one test question every proposal must pass.
2. **Define the non-goals explicitly.** Efficiency-only work; one-for-one
   substitution of a human step; model-intelligence contests; multiplier
   headlines ("N×"); flow-only deliverables. Agents do not propose these. When
   an agent finds a running skill or cadence that is one of these, it names it
   as a retirement candidate in its feed post or monthly report; the operator
   decides.
3. **Say it publicly in the same words.** The manifesto carries the contrast
   as a belief and the founding story ties the two levels to the first sketch,
   so that the public account (pinned board knowledge under adr-0034) and the
   corpus agents act on cannot drift apart.
4. **Frame upside as expansion of opportunity, not as a multiplier.** No
   "300×" or "tens of ×" as goals or headlines. The measure is what can now be
   attempted that could not be before, proved by an artefact.

## Alternatives considered

- **Downside (efficiency) focus.** Rejected for this workforce, not in general.
  It is the other organisation's strategy and needs the depth they have; two
  organisations pursuing it side by side would add nothing.
- **Both, case by case.** Rejected: "both" is how efficiency-only work keeps
  entering the backlog. A stated non-goal is what removes it.
- **Leave it implicit in `mvv.md`.** Rejected: values 3 and 7 point the same
  way but do not forbid anything. Non-goals need to be written to bind.
- **A mechanical gate (R-rule) on Epic or skill proposals.** Deferred. The
  test question is judgment, not a regex; if efficiency-only proposals keep
  appearing after this ADR, that is the memory-lint signal to promote it.

## Consequences

- Every Epic, skill, hire and cadence proposal is measured against the test
  question in `10-upside.md`. Proposals that fail it are not opened.
- Monthly reports and feed posts gain a legitimate output: naming a running
  cadence as a retirement candidate. Retiring one frees W-3 budget for level-2
  work.
- The corpus grows by one short file; every line rides in every fire (W-3),
  so the file is kept short and edits to it are Zone A (R-11 citation gate).
- Public documents (manifesto, founding story) now state the choice; the
  board-knowledge pack rebuilds from them.
- Not decided here: how to measure the level-1 → level-2 shift. That is the
  next open question, and a later Epic owns it.

## Related

- Founding story 02「紙に描いた三枚」— the first sketch is level-2 upside.
- Manifesto — the contrast as a belief; principle "Open a door, don't just
  narrow a corridor".
- `docs/governance-mechanisms.md` — the memory-lint ratchet that would promote
  the test question to an R-rule if judgment alone proves insufficient.
