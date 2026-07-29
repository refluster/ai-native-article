# ADR-0022 — The issue→merge flow: a dispatcher at intake, an author lane at review

- **Status**: Proposed
- **Date**: 2026-07-29
- **Deciders**: operator (proposed by the workforce SDLC review session)
- **Related**: [Epic-019](../epics/epic-019-autonomous-finalization-rate.md) (autonomous finalization rate — the metric this moves), [adr-0010](adr-0010-autopilot-merge-consensus-widening.md) / [adr-0011](adr-0011-own-repo-autopilot-merge.md) / [adr-0013](adr-0013-event-driven-pr-autopilot.md) / [adr-0014](adr-0014-drafts-are-merge-eligible.md) (the merge-predicate trail), R-N9 / R-N10 / W-5 ([governance.md](../governance.md))

## Context

The workforce has a review engine and an implementation cadence, and no path
between the two when anything goes wrong. Concretely, on 2026-07-29:

**1. A PR conflicts and nobody resolves it.** #517 (`issue-implement`, Ren) sat at
`mergeable_state: dirty` because #513 and #514 merged into `main` after its branch
was cut and touched the same skill body. `pr-merge.mjs` refuses a non-clean PR
(`not-mergeable`) and `pr-autopilot` is comment-and-label only by construction
(R-N9 / W-5) — so the refusal became an escalation to the operator. Nothing in the
system rebases a branch. As PR throughput rises this failure gets *more* common,
not less: it is caused by other PRs merging successfully.

**2. A 🟡 verdict waits for an author who does not exist.** `pr-autopilot` Step 5's
🟡 means "the author is expected to revise; next tick re-routes at cycle N+1". But
the author is a fire-and-forget CCR session that ended when the PR opened. No
cadence owns "a PR of mine has open findings", so the 🟡 ages until the
terminal-state sweep escalates it `stale-routed` — again to the operator, again
for work no human needed to do.

**3. Whole classes of issue are eligible for nobody.** The tracker's only consumer
was `issue-implement`, an engineer cadence that (correctly) denies `layer:L0`,
`layer:L1` and `type:tracker`. The `role:architecture` / `role:product` / L1 tail
of the backlog — #212, #454, #463 and their neighbours — had therefore sat
untouched since early June: not rejected, never claimed. Meanwhile
`issue-implement:needs-human` was an absorbing state with no path back, holding
issues (#355, #461, #464, #493, #515) whose blockers may well have resolved since.

The shape common to all three: **the system's terminal states are reachable, but
its interim states have no owner.** Every non-trivially-green path ends at the
operator, which is exactly what Epic-019 measured as the 2.8% autonomous
finalization rate and diagnosed as "wiring, not authority".

## Decision

Add the two missing owners. Nothing about who may *merge* changes.

### 1. The author lane — an agent-owned interim state on PRs

A third label, **`autopilot:needs-author`**, marks a PR whose blocking cause is
**agent-fixable**: a conflict with the base, an out-of-date branch, or open
blocking lens findings (`AUTHOR_LANE_CODES` in `escalation-reasons.mjs`). It is
stamped by `pr-autopilot-post.mjs --needs-author` at verdict time and by
`pr-merge.mjs`'s refusal path (which now splits `not mergeable (state=dirty|behind)`
into `merge-conflict` / `branch-behind`).

A new cadence, **`pr-remediate`**, owns that queue: it resolves the conflict,
updates the branch, or addresses the findings, pushes to the **head branch**
(R-N9 — never the default branch, never a merge), and hands the PR back for
re-review at cycle N+1.

**The two-outcome contract is unchanged.** MERGED and ESCALATED remain the only
terminal states. The author lane is an interim state exactly like 🟡, and it is
bounded three ways, mechanically:

- **an attempt cap** — `REMEDIATION_CAP` (3), counted from
  `<!-- autopilot:remediation:<n> -->` markers written on every attempt, escalating
  or not;
- **a staleness bound** — `pr-autopilot-sweep.mjs` escalates a lane PR untouched
  past `--author-stale-hours` (36) even if `pr-remediate` never fires at all;
- **fail-closed on L0/L1** — a PR touching the target's declared L0/L1 set (or
  whose set is unreadable) is *refused* entry to the lane, because resolving a
  conflict inside a governance file is an edit to it, and those are the operator's.

The lanes are mutually exclusive (`resolveLabels` throws on both), the author lane
may only carry causes an agent can clear (`assertAuthorLaneReasons`), and leaving
the lane always moves the PR rather than adding to it.

### 2. Lanes at intake — a dispatcher instead of self-selection

Every open issue is assigned exactly one **lane** by a router persona, as
`wf:lane:<lane>` + `wf:owner:<slug>` labels plus a stated dispatch comment:

| Lane | Deliverable | Worker |
|---|---|---|
| `implement` | a code/config diff | `issue-implement` (existing) |
| `design` | a decision/document diff — ADR, epic decomposition, statute-amendment **proposal**, design record | `issue-design` (new) |
| `operator` | an action no agent can perform | the operator |

Two new cadences: **`issue-triage`** (the router — Nadia's PdM lens) and
**`issue-design`** (the design lane's worker — an architecture/product persona).
`issue-implement` is **unchanged**: it already supports
`binding_config.issue_selection.allow_labels`, so consuming its lane is a binding
edit, not a skill-body edit.

The design lane rests on a distinction the tracker was missing: **an L0/L1 issue
may not be implemented autonomously, but a proposal for it can always be drafted.**
The operator-only surface does not move an inch — an L0/L1 artefact still escalates
by the existing merge predicate. What changes is that it arrives as a reviewable
diff instead of silence.

`issue-triage` also **un-absorbs the parked states**: an issue carrying
`*:needs-human` and untouched for `requeue_days` (14) is re-examined, and either
re-laned or re-parked with today's evidence. "Blocked on 2026-07-08" is a claim
about a world that has since changed.

## Consequences

**What gets better.** The three stalls above stop consuming operator decisions:
conflicts and review findings are worked by an agent, and the design tail produces
proposals instead of ageing. Epic-019's funnel should move without touching the
R-N10 predicate — which is precisely the hypothesis it pre-committed to test, so
the effect is measurable against a stated baseline rather than asserted.

**A measurement debt this creates, and its condition.** (`wf:farah` F2 on #518.)
A lane PR is neither escalated nor finalized, so it is absent from Epic-019's
funnel by construction — correct, since it is not an escalation, but it means the
funnel's rate can improve *partly by moving PRs out of its numerator*, and the only
thing distinguishing a healthy lane from a dead one is `author-stale` firing. The
lane therefore owes its own counter — entries, exits by kind, mean dwell — in
`build-pr-metrics-github.mjs` (tracked as **FU-029**). **The condition attached to
this decision: that counter ships before Epic-019's next funnel is published**, so
the published number is never read without the lane's volume beside it. Until then
the lane's health is observable only through the escalations it produces, and any
funnel citing it must say so.

**What gets worse, honestly.** (a) A third state is a third place to get stuck; the
sweep bound is what makes that recoverable, and it is the part most worth watching
in the first weeks. (b) `pr-remediate` resolving conflicts is the highest-risk
autonomous write this workforce performs — a conflict resolution can silently
revert what the other side shipped. The SKILL.md's semantic-resolution discipline
and the "escalate on an intent-level conflict" rule are the mitigation; the target
repo's own CI is the backstop; neither is a proof. (c) Cost: three new cadences ×
daily fires, inside the W-3 envelope but not free — the trip condition is the same
one Epic-019 Story 2 carries.

**What is explicitly NOT changed.** The R-N10 predicate, the L0/L1 path set, the
≥3-reviewer unanimous-green consensus rule, `MIN_REVIEWERS`, the kill-switch
semantics, and W-5. No agent gains merge authority; `pr-remediate` and
`issue-design` both declare `external-pr`, never `external-pr-merge`. The author
lane cannot touch L0/L1 at all — it is *tighter* than the merge leg there, not
looser.

**Reversal.** Delete the three bindings; the labels become inert and every PR falls
back to the pre-0022 path (the sweep escalates anything left in the lane on its
next fire). Nothing in the merge predicate has to be restored, because nothing in
it was changed.

## Alternatives rejected

- **Let `pr-autopilot` fix the PRs it reviews.** Shortest path, and it collapses
  author, reviewer and merger into one session — the separation that makes the
  delegated merge trustworthy at all (FU-028 / adr-0011). Rejected: the panel is
  the author≠merger separation.
- **Have the operator rebase.** The status quo. It is exactly the human-touch cost
  Epic-020 is trying to measure down, spent on the most mechanical work in the
  system.
- **Auto-rebase every PR mechanically (no judgment).** A conflict resolution is a
  semantic decision; a scripted "take theirs" silently reverts merged work. The
  judgment has to be in a session, which is why this is a cadence and not a script.
- **Widen `issue-implement` to take design issues.** One skill, two contracts, and
  a body edit to a Zone-A skill under W-5's one-bump rule. A separate lane keeps
  each contract legible and the deliverable unambiguous.
