# ADR-0024 — Panel provenance mode is not a merge condition: an inline panel is a wording discount, never a hold

- **Status**: Proposed (2026-08-03 — operator-initiated)
- **Date**: 2026-08-03
- **Deciders**: operator, nadia
- **Extends**: [adr-0011](adr-0011-own-repo-autopilot-merge.md) (the L0/L1 boundary as the single line) and [adr-0010](adr-0010-autopilot-merge-consensus-widening.md) (the non-L0/L1 + unanimous-consensus predicate). Neither is reversed; this ADR closes the open question those two left about panel independence.
- **Narrows**: [adr-0022](adr-0022-issue-to-merge-flow.md) §Alternatives-rejected, whose "the panel **is** the author≠merger separation" is restated here as a claim about *seats*, not about panel execution mode (see §Reconciliation below). adr-0022's decision — that `pr-autopilot` must not fix the PRs it reviews — is untouched and still in force.
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
  in prose: as an unresolved question in the skill body, and as an unexamined
  premise in [adr-0022](adr-0022-issue-to-merge-flow.md)'s rejected alternatives
  (reconciled below). It was never a clause of any predicate and never a check.
- **Both of its citations are loose, in the same way adr-0011 diagnosed.** The
  constraint cited `adr-0011 / FU-028`. adr-0011 contains no "panel",
  "separation" or "independence" claim at all — its predicate is the six clauses
  above. And [FU-028](../follow-ups.md) states no separation rule either: its
  subject is that the workforce authors PRs under the **same** GitHub identity it
  merges with (hence the self-approve 422, hence the approve step becoming
  advisory) — i.e. it documents the *absence* of an identity-level separation, the
  opposite of what it was cited for. This is the pattern adr-0011 named when it
  found the own-repo veto attributed to W-5, whose actual text is persona
  stability: an over-broad reading hardening into a quoted rule. The SKILL.md
  citation is corrected in this PR.
- **The separation it appeals to is not supplied by lens isolation anyway.** Even
  an `isolated` panel is N subagents on one base model, spawned by the same
  session; SKILL.md already caps the strongest claim available to it at "real but
  correlated, never independent." So `isolated` would not clear the bar the
  citation demands either — which makes the constraint one that no reachable
  panel mode can satisfy. A gate nothing can pass is not a gate; it is a stall.
- **What actually audits a delegated merge is not the panel's context count.** Be
  precise about which safeguard applies to which class of PR, because the appeal
  to "a human merges it anyway" is only true for one of them. On an **escalated**
  PR — any L0/L1 surface, this ADR included — the operator is a different party
  from the authoring session and reads the panel's verdict before merging. On a
  **delegated** (non-L0/L1) PR there is no human in the path at all, and — per
  [FU-028](../follow-ups.md) — not even a distinct GitHub identity, since the
  workforce authors under the same identity it merges with. What audits *that*
  class is the fail-closed server-side re-verification in `pr-merge.mjs` (which
  re-checks every clause independently of the router's judgment and refuses on
  any miss), the L0/L1 boundary, `MIN_REVIEWERS`, and the target repo's own CI.
  None of those depend on how many contexts the lenses ran in. The honest claim is
  therefore not "a human still merges it" but "the safeguards that were doing the
  work are untouched, and panel mode was never one of them."

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

## Reconciliation with adr-0022

[adr-0022](adr-0022-issue-to-merge-flow.md) §Alternatives-rejected turns down
"let `pr-autopilot` fix the PRs it reviews" with: *"it collapses author, reviewer
and merger into one session — the separation that makes the delegated merge
trustworthy at all (FU-028 / adr-0011). Rejected: the panel is the author≠merger
separation."* Both ADRs are live, so state plainly which half survives:

- **Survives, unchanged.** adr-0022's *decision*: the reviewing cadence does not
  become the fixing cadence. `pr-autopilot` still declares `external-pr-merge` and
  `pr-remediate` still declares `external-pr`; the author lane stays a separate
  skill with a separate binding. Nothing here lets the router push commits to a
  PR it is reviewing.
- **Narrowed.** The sentence "the panel **is** the author≠merger separation" is
  read here as a claim about **seats** — that ≥3 nominated reviewer lenses, each
  posting a machine-checked green marker the engine re-verifies, stand between
  the author and the merge — and **not** as a claim about the panel's *execution
  mode*. adr-0022 never examined isolated-vs-inline; it was arguing against
  merging the review and remediation *roles*, which is a different collapse. Under
  that reading the two records agree, and Decision-2 below does not disturb
  adr-0022's rationale so much as decline to extend it to a question it did not
  ask.

If a future operator wants the stronger reading — that a shared context between
author and lenses is itself disqualifying — that is a new decision, and per
Decision-1 it ships as a superseding ADR **plus** an engine clause, not as prose.

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
  merge without a human in the path on non-L0/L1 PRs. Name the sharpest case
  rather than folding it in: Decision-2 explicitly blesses the **author↔router
  collapse** — one session that authored the diff, produced every lens on it, and
  emits the merge — subject only to the engine's server-side re-verification. That
  is the configuration adr-0022 singled out as untrustworthy, and this ADR accepts
  it for the delegated class. That risk is real; it is
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
  `pr-merge.mjs`). Rejected by the operator: the safeguards that actually audit a
  delegated merge — the ≥3 seated lenses with engine-verified green markers, the
  fail-closed server-side re-verification, the L0/L1 boundary, and the target's
  CI — are all independent of panel mode, so the hold buys no safety it does not
  already have. It only converts green PRs into operator queue depth, which is the
  exact cost Epic-019 measures.
- **Require `isolated` panels before merging.** Rejected: it gates merge
  authority on a runtime capability (can a CCR `agent-runner` session spawn
  subagents mid-skill?) that is unresolved and, by SKILL.md's own ceiling, would
  not deliver independence even when available.
- **Leave the question open and fix the verdict case-by-case.** Rejected: an
  unresolved question in a skill body is read as a live constraint by the next
  session, which is how #529 stalled. The status quo is the failure mode.
