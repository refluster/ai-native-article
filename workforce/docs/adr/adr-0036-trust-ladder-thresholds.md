# ADR-0036 — Trust-ladder thresholds: N/M bars, incident taxonomy, reciprocity constraint, demotion parameters

- **Status**: Proposed (2026-09-13)
- **Date**: 2026-09-13
- **Deciders**: operator (Zone A — thresholds, incident taxonomy, and what
  counts as a reviewer's "own team" are human-owned, same bar as the quality
  layer's rubric/roster)
- **Related**: [Epic-023 — the trust ladder](../epics/epic-023-trust-ladder.md)
  (this ADR is Epic-023 Story 2, issue [#463](https://github.com/refluster/ai-native-article/issues/463));
  [issue #462](https://github.com/refluster/ai-native-article/issues/462)
  (Epic-023 Story 1 — review-event ingestion + `TRUST#` tier cache +
  deterministic replay; this ADR's row-family diff is written for that story
  to implement, and enforcement is inert without it); [adr-0010](adr-0010-autopilot-merge-consensus-widening.md)
  / [adr-0024](adr-0024-panel-mode-not-a-merge-condition.md) (the
  unanimous-green consensus + panel-independence predicate this ladder
  filters the *pool* for, without changing); `MIN_REVIEWERS = 3`
  (`workforce/skills/pr-autopilot/pr-merge.mjs`) — the floor Epic-023 §3's
  `insufficient-t1-pool` escalation reuses; root [`docs/governance.md` §8.1](../../../docs/governance.md)
  (the A/B action-authority matrix — tier assignments are **computed**, never
  a human or agent hand-set, so this ADR adds no new B-authority action other
  than the thresholds themselves).

> **Numbering note.** This tree's ADR-0034 slot is already taken by the
> merged `adr-0034-public-qa-boards.md`, and ADR-0035 is claimed by the
> still-open draft PR [#719](https://github.com/refluster/ai-native-article/pull/719)
> (Epic-021 §A.3, issue #457). This document takes **0036** to avoid a second
> collision; per the README's existing 2026-09-09 numbering-note convention,
> whichever of #719 / this PR merges second should renumber if a gap opens
> up, or an operator/`backlog-reconcile` pass reconciles it.

## Context

Epic-023 (Accepted 2026-07-08) proposes a computed trust tier per
(persona, domain) — T0 (observer) → T1 (lens reviewer) → T2
(routing-eligible) — so that PR-review authority widens and narrows on
recorded track record instead of a human editing a Zone A doc for every
change. The epic deliberately left the **numeric bars, the incident
taxonomy, and the reciprocity/diversity constraint as Zone A constants
"proposed in this Epic for operator sign-off"** (§1) — i.e. explicitly
**not** decided, and explicitly this story's job to propose. Story 1 (#462,
event ingestion + tier computation) is unimplemented as of this writing;
this ADR does not depend on it landing first — enforcement is inert until
both this diff is approved and #462 ships, which is the intended order
(rules before mechanism, matching how the quality layer's rubric/roster
precede `MODEL_REGISTRY` call sites).

Without concrete numbers, "propose thresholds" is not a decision — it is a
restatement of the problem. This ADR proposes specific values, states what
would make each one wrong, and names the alternatives rejected, so the
operator has something to approve or reject rather than a design space to
fill in themselves.

## Decision

Adopt the following as the Zone A constants for the PR-review domain's
trust ladder. All are **initial values for the first live window**, not
permanent constitution — see "Reversal" below.

### 1. Promotion bars

| Transition | Bar | Rationale |
|---|---|---|
| T0 → T1 | **N = 8** recorded shadow-included lens reviews, no attributed incident, **spanning ≥3 distinct PR authors** (the reciprocity constraint, §2) | Reachable inside one sprint at the review volume `pr-autopilot`'s own nomination-load telemetry shows (Epic-019 Story 2b's `NOMINATION_SEAT_CAP` accounting), while still requiring real, varied signal — a single friendly author feeding 8 easy reviews cannot alone promote someone (§2 blocks it). |
| T1 → T2 | **M = 20** consensus participations, clean record, **spanning ≥6 distinct PR authors** | T2 is the routing-eligible / auto-nomination pool (Epic-023 §1's nadia correction: "nominator" was vacuous — T2 is what `pr-autopilot` routing bindings and Epic-019's auto-nomination panel assembler draw from). This is a materially higher bar than T1 because a bad T2 nomination compounds (a captured T2 assembles other reviewers' panels), matching the epic's own capture-risk framing in §"Behaviour at N=100+ agents". |

**Both counted-review windows are rolling and record-based, not time-boxed**:
a persona's Nth/Mth qualifying review is the promotion trigger the moment it
lands (matching 仮説五's "widen a step when the record meets the bar" —
mechanical, not a periodic batch job).

### 2. Reciprocity / diversity constraint (day-one, per Epic-023 §1's tessa finding)

A review counts toward N or M only if **both** hold:
- The PR's author does not share the reviewer's `reports_to` manager
  (`GET /agents/{slug}.reports_to` — the existing org-chart field; no new
  schema). This is the mechanical proxy for "not your own team" the epic
  asks for, reusing data already on the agent record rather than inventing a
  team-membership concept.
- The reviewer's counted-review set for that promotion has **no single PR
  author at more than 40%** of it (e.g. at N=8, no more than 3 of the 8 may
  share an author). This blocks the "one friendly author, many easy PRs"
  capture path even when the two reviewers happen not to share a manager.

A review that fails either check is still recorded (it is real work, and it
still counts for the demotion side's "clean record" — see §3) but does not
advance the counter. This is a **counting rule, not a rejection** — no
review is discarded from the ledger, only excluded from a promotion tally.

### 3. Incident taxonomy

Every incident row (`INCIDENT#{ulid}`, §5) carries exactly one `class`,
closed vocabulary, for monthly-report analytics (Epic-016) and for the
manager-contest reviewer to see the shape of what happened — the class does
**not** change the demotion mechanics (§4), which are uniform regardless of
class:

| `class` | Meaning |
|---|---|
| `correctness-regression` | A reverted-for-cause change shipped a functional defect the review missed. |
| `governance-violation` | A merged change crossed an L0/L1 boundary, a Zone A file, or an R-rule the review should have caught. |
| `editorial-integrity` | A W-1/C-1 guard trip (empty/truncated/artefact content) traced to a change the review passed. |
| `security` | A merged change introduced a credential leak, an auth bypass, or a privilege widening the review missed. |
| `availability` | A merged change caused a production incident (deploy failure, data-plane outage) the review should have flagged. |

A revert or guard-trip that does not fit any class is `correctness-regression`
by default (the most general bucket) rather than blocking the demotion on a
taxonomy debate — the taxonomy is for analytics, not for gating due process.

### 4. Demotion — parameters for Epic-023 §1's two triggers

The two trigger *mechanisms* are decided in the epic itself (§1) and are not
reopened here; this ADR fixes the parameters the epic left unspecified:

- **Drop size**: exactly **one tier** per incident, both triggers, no
  compounding within the same incident (an incident with two green-lighting
  reviewers drops each of them one tier, independently — not the panel as a
  whole).
- **Manager-contest window**: **5 business days** from the ledger row's
  `classification_at` timestamp. Unresolved at expiry → demotion stands
  (matching Priya's "err toward non-attribution, but an unresolved contest
  is not evidence of error" default — silence is not the same claim as a
  successful contest).
- **Re-promotion**: no special path. A demoted persona re-earns the normal
  bar for their *current* tier's next rung (a T2→T1 demotion means re-earning
  M again to return to T2; there is no partial credit and no cool-down
  timer beyond the time the bar itself takes to re-clear) — this is the
  epic's own "no penalty-box timer, no pardon path outside the normal Zone A
  amendment" (§1), made concrete.

### 5. Row-family schema (Zone A diff, for Story 1 to implement)

Adds two proposed row families to `workforce/docs/data-model.md`, in the
same "(proposed — ADR-NNNN)" convention ADR-0032's `LESSON` rows and
ADR-0032's daily `BUDGET` row already use — not implemented until #462
lands, and not this PR's code to write:

- `AGENT#{slug}` / `TRUST#{domain}` — the computed tier cache (a rebuildable
  cache per Epic-023 §2's W-5 firewall: never on `META`, never `PATCH`ed,
  never prompt-injected).
- `AGENT#{slug}` / `REVIEW#{ulid}` — one ingested review-verdict event.
- `INCIDENT#{ulid}` — one classified incident row (evidence, trigger class
  per §3, attributed personas, contest state) — the row every demotion
  reads from, per the epic's "tier computation reads rows, never re-derives
  blame."

See the `data-model.md` diff in this PR for the full attribute list.

## What forced this decision

Epic-023 was Accepted 2026-07-08 with the threshold question explicitly
open ("N, M, and the incident taxonomy are Zone A constants proposed in
this Epic for operator sign-off") and RFC'd with unanimous
support-with-changes. Two months on, Story 1 (#462) and Story 2 (#463) both
sit unclaimed in the backlog with no owner having moved either — the
mechanism (#462) has nothing to compute *with* until the numbers exist, and
the numbers have no reviewer feedback loop until they are written down as a
concrete proposal rather than a placeholder. This ADR exists so the operator
has one document to accept, reject, or amend instead of two open
placeholder issues.

## Alternatives considered

- **No numeric bar — a human approves each promotion.** Rejected: this is
  the exact static, human-gated authority model Epic-023 exists to replace
  (§Problem — "widening anyone's scope means a human editing a Zone A doc").
  It does not scale past a handful of personas and reintroduces the vibes-based
  decision the epic's own hypothesis argues against.
- **Lower bars (N=3, M=8) for faster pool growth.** Rejected: Epic-019's
  measured throughput problem is nomination-pool *size*, not promotion
  *speed* — a T1 pool that grows too fast on too little signal risks the
  exact "vacuous nominator" failure nadia flagged in the epic (§1) for the
  T2 definition. A bar that promotes almost everyone is not a bar.
- **Higher bars (N=20, M=50).** Rejected as making T1 effectively
  unreachable at current review volume (cross-checked against
  `pr-autopilot-scan.mjs`'s nomination-seat accounting) — the ladder would
  read as a formality that never actually widens the pool, defeating
  Epic-019's throughput goal that Epic-023 exists to serve.
- **No reciprocity constraint — trust the diversity to emerge from routing.**
  Rejected: this is precisely the capture risk tessa named in the RFC
  ("an issuer-pays favour economy... 'monthly analytics watches drift' is
  not a defense") — routing is exactly the mechanism a captured pair would
  exploit, so the constraint has to bind at counting time, not be inferred
  after the fact.
- **A single incident class (undifferentiated "incident").** Rejected:
  Epic-016's monthly analytics (the same "make the organisation legible"
  value the north star names) loses the ability to distinguish "this ladder
  is catching correctness bugs" from "this ladder is catching governance
  violations" — different findings imply different fixes upstream, and a
  flat taxonomy erases that signal for no simplicity gain (five closed
  values is not meaningfully harder to reason about than one).

## What this costs

- **A persona genuinely capable of T1/T2 judgement waits** for the record to
  accumulate — there is no fast-track for a demonstrably strong reviewer.
  This is the intended cost (record over feel), but it is a real one for a
  new hire who is, in fact, already trustworthy.
- **The reciprocity constraint under-counts small teams.** A 3-person lane
  where everyone reports to the same manager and reviews mostly each other's
  work will promote slowly under the `reports_to` check even with no actual
  capture happening — a false-positive cost, not just a true-positive catch.
- **Five incident classes is more to get right at classification time** than
  one undifferentiated bucket — the classifying human (or the SHA-traced
  proposal a human confirms) has one more judgement call per incident.

## How this would be reversed, and what would tell us it was wrong

Reversal is a superseding ADR changing the numbers or the constraint, per
this repo's own rule that a reversal is never an in-place edit. Concrete
falsifiers to watch for once #462 ships and shadow mode runs (Epic-023's own
≥2-week, ≥N-PR shadow-window acceptance criterion):

- **T1 pool stays empty or near-empty after 4 weeks of shadow data** →
  N is too high; lower it in a superseding ADR.
- **T1 pool balloons past the pre-ladder ad-hoc reviewer roster's size with
  no corresponding drop in escalations** → N is too low, or the reciprocity
  constraint is not binding the way §2 assumes; tighten the 40%
  same-author cap first (the cheaper lever) before raising N.
- **The shadow report's divergence artifact (actual panel vs. tier-filtered
  panel) shows the `reports_to` check rarely excludes anything** → the
  proxy is too weak (managers rotate infrequently relative to review
  pairs); the diversity cap (the second half of §2) is doing the real work
  and the manager check can be dropped as redundant complexity.
- **Any demotion overturned on contest** should be read individually before
  touching the parameters — a contest working correctly (catching a
  misattributed incident) is the due-process design succeeding, not
  evidence the drop-size or window is wrong.

## Explicitly out of scope

- Implementing the ingestion job, the tier-computation replay, or the
  `pr-autopilot` nomination filter — all Story 1 (#462).
- Any change to the R-N10 merge predicate, the unanimous-green consensus
  requirement, or `MIN_REVIEWERS` — Epic-023 §"Out of scope" already rules
  this out and this ADR does not reopen it.
- Tiering domains beyond PR review (curation authority, cadence
  self-modification, budget requests) — each is its own future Zone A
  proposal per the epic.
- Public display of tiers or demotion notes — internal-view-only per the
  epic's celeste finding; a public surface is a separate, unproposed idea
  with its own comms-owner question.
- Compensation or model-access changes as promotion rewards — the epic rules
  this out explicitly and this ADR does not touch it.

---
Authored by an LLM persona (workforce `issue-design`, R-N1(a)). This proposes
a decision; it does not make one. Verify before merging.
