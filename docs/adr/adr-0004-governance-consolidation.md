# ADR-0004 — Governance consolidation: de-duplicated statute, R-11 full-law coverage, R-13 terminal-state sweep

- **Status**: Proposed (operator ratifies by merging this PR)
- **Date**: 2026-07-03
- **Deciders**: operator (refluster), drafted by a Claude Code session on the operator's request ("法体系のリファクタリング")

## Context

The law code grew by amendment. Every rule change since v1.0 was layered on
top of the existing text — a run-on W-3 cost-history sentence spanning five
raises, four independently-maintained projections of the same operator-only
boundary, a "what we did not adopt" table kept in three places, a repo-wide
freeze clause in AGENTS.md describing a `workforce/` rebuild that finished
weeks ago, and an R-11 citation gate whose coverage never followed the law it
protects: the workforce's statute docs (`architecture.md`, `naming.md`,
`data-model.md`, `mvv.md`) and its entire `workforce/docs/adr/` log — all
declared L0/L1 in `docs/governance.md §4.4` — were invisible to the gate, so
the densest law-making in the repo could ship un-announced.

Separately, the pr-autopilot two-outcome contract ("every PR ends merged or
escalated") was an invariant enforced only in prose. ML-009 crossed the
ratchet's promotion threshold (2 occurrences, 2026-06-22) and its guard
script existed but was wired into no CI surface (OP-010 sat open); the
stalled-run and window-aged classes had no guard at all.

The operator directed a refactor of the law itself: treat the accumulated
complexity and contradictions as tech debt, simplify while keeping day-to-day
behaviour stable, and accept (but report) minor behaviour changes.

## Decision

1. **One statement per rule; amendments become tables.** The W-3 cost-ceiling
   history is a dated amendment table under the current cap, not a run-on
   parenthetical. The "not adopted (C-3 boundary)" table lives only in
   `governance-mechanisms.md §5`; `governance.md §9` now points there instead
   of carrying a drifting copy.
2. **Dead law is deleted, provenance kept one line long.** The AGENTS.md
   workforce freeze clause (contradicted by the fully-built
   `workforce/docs/governance.md`) is replaced by a live pointer to that
   statute. Retired-GAS historical asides in C-4 / I-2 shrink to one-line
   provenance; stale cross-references (design-policy "R-1〜R-9",
   governance-mechanisms "R-5/R-10") now reference the active rule set.
3. **R-11 covers the whole law.** `check-l1-citation.mjs` adds the workforce
   Zone A statute docs and `workforce/docs/adr/` to its L1 set, so touching
   any law — root or workforce — must announce itself. `workforce/docs/mvv.md`
   is added to the workforce zone table (it declared itself Zone A but was
   listed nowhere) and to the §4.4 L0/L1 block.
4. **R-13 — the terminal-state sweep — is promoted from ML-009.** A daily
   scheduled workflow (`workforce-pr-terminal-sweep.yml`) runs
   `pr-autopilot-sweep.mjs --apply`: any open PR in a non-terminal autopilot
   state (unlabelled hand-off, stalled cycle ≥48h, never-routed and aged out
   of the 7-day discovery window) is escalated with `autopilot:needs-human`.
   This makes the two-outcome contract mechanical. It is a *scheduled
   automation with a write action* (labels/comments on PRs — never a push),
   which is why it gets its own workflow file rather than a `ci.yml` step:
   the §4 anti-reinvention rule's "fold small checks into ci.yml" applies to
   PR gates; the precedent for scheduled loops is
   `weekly-content-insights.yml`. Resolves OP-010; ML-009 flips
   `accepted → promoted`.
5. **ADR hygiene.** The root ADR index is brought back in sync (0002/0003
   were missing — the index violated its own "keep in sync" rule). Broken
   relative links in workforce adr-0011/adr-0014 are fixed. The status
   inversion around adr-0010 (Accepted ADRs extending a Proposed base whose
   implementation had long since merged) is corrected by flipping adr-0010 to
   Accepted with a ratification note.

## Behaviour changes (accepted, reported)

- **New enforcement**: R-13 auto-escalates PRs that previously sat silently
  in a non-terminal state (this is the operator-requested fix for "いずれに
  もならないケース").
- **New citation obligation**: PRs touching workforce statute docs / ADRs now
  fail R-11 without a citation or `RULE-N/A:` line. Previously they passed
  silently — that was the hole, not the contract.
- **mvv.md joins L0/L1**: the autopilot can no longer autonomously merge a
  change to the MVV. It never should have been able to.
- Everything else is textual consolidation with no behavioural surface.

## Alternatives considered

- **Rewrite the statute from scratch as one document.** Rejected: the layered
  L0–L3 model and the two-subsystem split are load-bearing (the l0l1 block is
  read live by the merge engine; the zone tables drive review posture).
  Refactoring in place preserves every mechanical consumer.
- **Merge the four boundary projections (AGENTS.md Zone A, §4.4 l0l1 block,
  workforce zone table, R-11 doc list) into one generated artefact.**
  Deferred: attractive, but the four serve different readers (humans vs the
  merge engine vs CI) and a generator is new machinery (§4 anti-reinvention).
  Revisit if they drift again — the drift found this time (R-11's hole) is
  fixed by this ADR, and R-11 now watches all four files.
- **Wire the ML-009 check into `ci.yml` as a PR gate.** Rejected: it inspects
  repo-global PR state, so one stale PR would fail every unrelated PR's CI.
  A daily sweep that *repairs* (labels) instead of merely failing is both
  quieter and stronger.

## Consequences

- The statute is shorter and single-sourced; future amendments have an
  obvious landing shape (a dated row, not a longer sentence).
- R-11 gains real coverage of the workforce's law-making; expect an
  occasional extra `RULE-N/A:` line on mechanical PRs — the cost of the gate
  actually gating.
- R-13 runs with the repo-scoped `GITHUB_TOKEN`; it can only label/comment on
  this repo. External delegated targets (e.g. `PSVL/asp-cloud`) are swept by
  the cadence itself (SKILL.md Step 6), not by this workflow.

## Related

- [governance.md](../governance.md) (§4 R-13 row, §4.4 l0l1 block, §9 pointer)
- [governance-mechanisms.md](../governance-mechanisms.md) (§2 catalogue, §2.1 operating notes)
- [workforce/docs/governance.md](../../workforce/docs/governance.md) (W-3 table, zone table, R-N10 two-outcome note)
- [memory-lint-backlog.md](../memory-lint-backlog.md) ML-009 / ML-011
- [ADR-0001](adr-0001-self-driving-governance-mechanisms.md) (the machinery this extends)
- workforce [adr-0010](../../workforce/docs/adr/adr-0010-autopilot-merge-consensus-widening.md) … [adr-0015](../../workforce/docs/adr/adr-0015-skill-bodies-not-l0l1.md) (the autopilot decision trail)
