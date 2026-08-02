# ADR-0023 — A 🔴 verdict returns to the author with a brief, not to a human

- **Status**: Proposed
- **Date**: 2026-08-02
- **Deciders**: operator (proposed by the workforce SDLC review session)
- **Related**: [adr-0022](adr-0022-issue-to-merge-flow.md) (the author lane this extends), [Epic-019](../epics/epic-019-autonomous-finalization-rate.md) (autonomous finalization rate), R-N9 / R-N10 / W-4 / W-5 ([governance.md](../governance.md)), [pr-escalation-reasons.md](../pr-escalation-reasons.md) (taxonomy v3)

## Context

adr-0022 gave the review loop's **interim** states an owner: a conflicted branch,
a behind branch and a 🟡 verdict now go to the agent-worked author lane
(`autopilot:needs-author` → `pr-remediate`) instead of ageing until the sweep
escalated them.

It left one door to the operator wide open. Under `pr-autopilot` Step 5, **any
single reviewer's veto** — a 🔴 from one lens on a ≥3-lens panel — hands the PR
straight to a human, whatever the veto is about. In practice most vetoes are not
governance questions or scope disagreements; they are ordinary implementation
defects: a missing guard, an unhandled case, a test that should exist, a script
that swallows an error. Those are exactly the class `pr-remediate` was built to
fix, and exactly the class the panel is best at finding. The colour of the
verdict was being used as a proxy for "does this need a human", and it is a poor
one: 🟡 and 🔴 differ in a lens's *confidence*, not in *who can act*.

The cost is the one Epic-019 measured. A 🔴 spends an operator decision on work
no human needed to do, and it does so at the point in the loop where the fix is
best specified — the panel has just written down what is wrong and where.

There is a second, subtler problem with escalating on 🔴: the panel's findings
are handed on **unorganised**. Three lenses produce three lists, overlapping,
unordered, some of them premise questions and some of them one-line fixes.
Whoever picks the PR up next — human or agent — redoes the synthesis. That
synthesis is the routing persona's actual job (a PdM lens); it was simply never
asked for.

## Decision

**Split the 🔴 by what the veto is about, and make the router organise the fix.**

1. A 🔴 whose blocking cause is a **defect in the diff** goes to the **author
   lane**, under a new reason code `review-findings-blocking`. The router
   synthesises the panel's blocking findings into an ordered **remediation
   brief**; `pr-remediate` implements or rebuts each item and pushes; the next
   `pr-autopilot` tick re-reviews at cycle N+1.

2. A 🔴 about anything **no agent may resolve** — the change's premise or scope,
   an L0/L1 surface, a missing R-N10 delegation, a human's `CHANGES_REQUESTED`, a
   persona escalation trigger, an unseatable panel — still goes to a human,
   unchanged.

3. **The human gate moves to the cycle budget.** A `review-findings-blocking`
   hand-off is refused when the loop it would authorise (cycle + 1) exceeds the
   binding's `cycle_cap` (W-4 hard cap 7); at the cap the code is
   `cycle-cap-exceeded` and the lane is the human one. The operator is therefore
   still guaranteed to be reached on a PR the loop cannot close — after a bounded
   number of *organised* attempts rather than after none.

4. **The brief is machine-checked, not templated.** Every item names the
   reviewer's finding-ID, a location, the concrete change, and a `Done when:`
   acceptance clause. `pr-autopilot-post.mjs` refuses (exit 1) a
   `review-findings-blocking` post whose brief does not parse
   (`remediation-brief.mjs`), and stamps `<!-- autopilot:brief -->` only *after*
   it parses — so the marker records a validated artefact rather than a claim.

Every adr-0022 guard continues to apply to this code unchanged: the lanes stay
mutually exclusive, the lane is fail-closed on L0/L1, the 3-attempt remediation
cap bounds the work, and `pr-autopilot-sweep.mjs` escalates a PR whose head stops
moving (`author-stale`). The two-outcome contract is untouched: the loop is an
interim state with an owner and three independent bounds, not a third terminal
state.

**Not decided here.** The merge predicate (R-N10), `MIN_REVIEWERS`, the panel's
provenance rules, and the flaky-rerun latch are all unchanged. `checks-failing`
keeps its adr-0022 treatment (allowed in the lane, never automatic).

## Consequences

**Good.** The 🔴 class that is ordinary engineering work stops consuming operator
decisions, which is the Epic-019 metric this moves. The handover is *better
specified* than what a human used to receive: an ordered work-list with
acceptance criteria beats three overlapping review threads. And the funnel gains
a real distinction — `review-findings-open` (the author was asked to revise)
versus `review-findings-blocking` (the panel blocked and the router organised the
fix) — where before both were invisible under one escalation.

**Bad, and accepted.** A wrong veto now costs a remediation attempt and a review
cycle instead of a human's one-line dismissal; the brief's "do not re-litigate,
`pr-remediate` may rebut by ID" rule is the cheap path back, and the cycle cap
bounds the waste. The router's brief is the loop's single point of failure — a
brief that misreads a finding sends the cadence at the wrong fix — which is why
the brief is parsed rather than trusted, and why the panel re-reads the result at
cycle N+1 rather than the router self-certifying it. And a PR can now legitimately
take more cycles before a human sees it; that is the trade the cycle cap prices.

**Skew.** The new code is deliberately new rather than a widening of
`review-findings-open`: a SKILL body still running the pre-0.25.0 text emits only
the old code and is unaffected by the brief and cycle-budget guards, so this
lands without an activation window (ADR-0008 / OP-015).

## Alternatives considered

- **Keep 🔴 → human, and let the operator forward the PR to the lane.** No new
  mechanism, but it keeps the decision on the human's desk — the exact cost being
  removed — and the forwarding still needs the synthesis nobody writes.
- **Route every 🔴 to the author lane.** Simpler, and wrong: a veto on the
  change's premise is not fixable by an agent, and a loop that tries burns its
  cycle budget rediscovering that the question was never about the code.
- **Widen `review-findings-open` to cover 🔴.** One code, no skew window — but it
  makes "was the panel blocking?" unanswerable in the funnel and forces the brief
  requirement onto the 🟡 path, breaking every running SKILL body on landing.
- **Require unanimous 🔴 before escalating.** Treats a lone veto as noise; a
  single lens is often the only one holding the relevant expertise, and the fix
  here is to *act* on the veto, not to outvote it.

## Consumers

- `workforce/skills/pr-autopilot/SKILL.md` (Step 5 — the verdict table, the 🔴
  loop, the brief template) · `meta.json` 0.25.0
- `workforce/skills/pr-autopilot/remediation-brief.mjs` (new — the parser + both
  guards) · `pr-autopilot-post.mjs` (enforcement) ·
  `escalation-reasons.mjs` (taxonomy v3)
- `workforce/skills/pr-remediate/pr-remediate-scan.mjs` (classifies the code,
  surfaces the parsed brief as the run's work-list)
- `workforce/docs/pr-escalation-reasons.md` (v3)
