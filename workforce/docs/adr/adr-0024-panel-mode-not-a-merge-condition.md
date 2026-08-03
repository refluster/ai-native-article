# ADR-0024 — Panel provenance mode is not a merge condition: an inline panel is a wording discount, never a hold

- **Status**: Proposed (2026-08-03 — operator-initiated)
- **Date**: 2026-08-03
- **Deciders**: operator, nadia
- **Extends**: [adr-0011](adr-0011-own-repo-autopilot-merge.md) (the L0/L1 boundary as the single line) and [adr-0010](adr-0010-autopilot-merge-consensus-widening.md) (the non-L0/L1 + unanimous-consensus predicate). Neither is reversed; this ADR closes the open question those two left about panel independence.
- **Epics**: [epic-019](../epics/epic-019-autonomous-finalization-rate.md)

## Context

`pr-autopilot`'s verdict step declares how its reviewer lenses were produced —
`<!-- autopilot:panel:isolated -->` (one subagent per lens) or
`<!-- autopilot:panel:inline -->` (all lenses in the router's own context). The
marker exists so the verdict's *evidentiary wording* is honest: an inline panel's
agreement is one session's conclusion stated N times, not N independent readings.

The SKILL.md has always said that this disclosure governs wording only and does
not change the merge predicate, while explicitly leaving open "whether a
collapsed panel should also suspend the merge leg" as a question for a
superseding ADR. In practice that open question has been read as a live merge
constraint, and it has stalled merges. PR
[#529](https://github.com/refluster/ai-native-article/pull/529) is the worked
example: 🟢 unanimous-green, no L0/L1 surface, checks green, `mergeable_state`
clean, R-N10 delegation present, plus an *executed* test run on the head ref —
and the verdict declined the merge with:

> adr-0011 rests the merge authority on the panel being the author≠merger
> separation, and an inline panel cannot supply that separation.

Two problems with that reading:

- **It reads a condition into adr-0011 that adr-0011 does not state.** adr-0011's
  predicate is: unanimous-green consensus, no L0/L1 path in the *target's* own
  governance, checks green, mergeable, R-N10 delegation, no `autopilot:off`. Panel
  execution mode appears nowhere in it, and `pr-merge.mjs` — the fail-closed
  server-side re-verification — has never checked it. The constraint existed only
  in prose, and only as an unresolved question.
- **The separation it appeals to is not supplied by lens isolation anyway.** Even
  an `isolated` panel is N subagents on one base model, spawned by the same
  session; SKILL.md already caps the strongest claim available to it at "real but
  correlated, never independent." So `isolated` would not clear the bar the
  citation demands either — which makes the constraint one that no reachable
  panel mode can satisfy. A gate nothing can pass is not a gate; it is a stall.
- **The objective audit is not the panel.** In practice this repo's PRs are read
  by several reviewers and merged by an operator who is a different party from the
  session that authored them. The author≠merger separation is supplied by that
  human merge step plus the server-side predicate re-verification, not by how many
  contexts the lenses ran in.

Escalating on this ground also mislabels the telemetry: an
`autopilot:reason:other` on a PR that satisfies every clause of the predicate
reads, in Epic-019's escalation counts, as a wiring failure when nothing was
mis-wired.

## Decision

**The panel's provenance mode is never a merge-eligibility condition. An
`inline` panel — including one where the router also authored the PR — is a
disclosure and a discount on the verdict's evidentiary wording, and nothing
more.**

Concretely:

1. **The merge predicate is unchanged and exhaustive.** The clauses listed in
   adr-0010/adr-0011 and re-verified by `pr-merge.mjs` are the *complete* set. No
   clause may be added in prose; a new hold requires an ADR plus a corresponding
   server-side check in the engine, so that a stated rule and an enforced rule
   cannot diverge again.
2. **`autopilot:panel:inline` (and an author↔router collapse) MUST NOT produce a
   hand-off.** A 🟢 verdict whose only unmet item is panel independence merges.
   The disclosure sentence stays mandatory — the discount goes in the prose, not
   in the terminal action.
3. **The SKILL.md's open question is closed.** The paragraph deferring "should a
   collapsed panel suspend the merge leg?" to a future superseding ADR is
   answered here: **no.** SKILL.md is amended to state the answer rather than the
   question.
4. **What still holds a merge is untouched.** L0/L1 paths, missing R-N10
   delegation, non-consensus, an unseatable panel, `CHANGES_REQUESTED`, failing
   checks, `dirty`/`behind` branches, `autopilot:off`, the cycle cap, and every
   persona escalation trigger all escalate exactly as before.

## Consequences

- **Merges that the predicate already permits actually happen.** The 🟢 →
  `needs-human` leak on green own-repo PRs closes; Epic-019's
  autonomous-finalization rate stops being depressed by a condition no panel mode
  can satisfy.
- **Honest wording is preserved, and separated from authority.** The provenance
  line, the "never present convergence as independent corroboration" rule, and the
  mandatory author↔router-collapse disclosure all stay in force verbatim. This ADR
  changes what the disclosure *does*, not whether it is made.
- **The governance wall is unmoved.** Every Zone A surface — statute docs, ADRs,
  workflows, prompts, rosters, rubrics — is inside the L0/L1 set and still
  escalates. Notably this ADR is itself under `workforce/docs/adr/**` and amends a
  `SKILL.md`, so **the PR carrying it escalates to the operator by construction**;
  the workforce cannot self-merge the loosening of its own merge rule.
- **What gets worse, honestly.** A shared-context panel's blind spots now reach a
  merge without a human in the path on non-L0/L1 PRs. That risk is real; it is
  bounded by the fact that it was *already* reachable via an `isolated` panel
  (equally correlated, and always merge-eligible), by the target repo's own CI,
  and by C-4 fail-loud behaviour in the engine. What this ADR removes is the
  inconsistency, not a protection that was doing work.
- **Reversal.** Restore the hold as an explicit predicate clause — in
  `pr-merge.mjs` *and* the SKILL.md together, per Decision-1 — in a superseding
  ADR. Reverting the prose alone would recreate exactly the stated-but-unenforced
  condition this ADR exists to eliminate.

## Alternatives considered

- **Keep the hold and make it real** (add a `panel:inline` refusal to
  `pr-merge.mjs`). Rejected by the operator: the review panel plus the operator's
  own merge already supply the objective audit, so the hold buys no safety — it
  only converts green PRs into operator queue depth, which is the exact cost
  Epic-019 measures.
- **Require `isolated` panels before merging.** Rejected: it gates merge
  authority on a runtime capability (can a CCR `agent-runner` session spawn
  subagents mid-skill?) that is unresolved and, by SKILL.md's own ceiling, would
  not deliver independence even when available.
- **Leave the question open and fix the verdict case-by-case.** Rejected: an
  unresolved question in a skill body is read as a live constraint by the next
  session, which is how #529 stalled. The status quo is the failure mode.
