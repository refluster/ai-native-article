# ADR-0014 — Autopilot un-drafts as the terminal step of an eligible merge

- **Status**: Proposed
- **Date**: 2026-06-23
- **Deciders**: operator, sana, nadia
- **Supersedes**: extends [adr-0010](adr-0010-autopilot-merge-consensus-widening.md) (the non-L0/L1 + unanimous-consensus predicate) and [adr-0011](adr-0011-own-repo-autopilot-merge.md) (own repo as a normal delegated target)
- **Epics**: [epic-010](epics/epic-010-project-trust-boundary.md)

## Context

[adr-0010](adr-0010-autopilot-merge-consensus-widening.md) put **drafts in scope** for the `pr-autopilot` cadence: a draft PR is routed and reviewed like any other (early feedback before "Ready for review"). But the **merge** leg could never complete on a draft — GitHub reports a draft's `mergeable_state` as `"draft"`, so `pr-merge.mjs`'s `verifyMergeable` refused it at the clean-state check. The result, for a 🟢 unanimous-green, non-L0/L1 **draft**, was an awkward limbo: the engine had verified everything that matters (consensus, no L0/L1 surface, no conflicts, checks green) yet could not merge, because the draft flag is a *second* human gate.

This bites hardest in this org specifically: **the workforce's own agents open draft PRs** (every Claude Code session that runs `create_pull_request(draft: true)` does — e.g. #369). So the operator's directive to "increase the chances agent-workforce auto-merges PRs" was partly defeated by the very PRs the workforce authors getting stuck on their own draft flag.

A first patch (#369) papered over this: it labelled green drafts `autopilot:reviewed` and had the verdict say "mark ready, then merge", leaving the un-draft + merge to the operator. The operator asked to go further — **have the autopilot clear the draft gate itself** when (and only when) the PR is otherwise mergeable — to remove the special-cased draft path rather than annotate it.

## Decision

**A draft PR that passes the full R-N10 merge predicate is un-drafted by the engine as the *terminal* pre-merge step, then merged.** Concretely, in `workforce/skills/pr-autopilot/pr-merge.mjs`:

1. `verifyMergeable` treats a draft as a **pending-mergeable** state, not a refusal: it does not trust `mergeable_state` for a draft (which masks `"clean"`), but verifies the real gates explicitly — **no L0/L1 path** (from the target repo's own governance), **all checks green**, **unanimous reviewer consensus**, **no `CHANGES_REQUESTED`**, **`mergeable===true`** (no conflicts; a still-computing `null` fails closed and retries). It returns `wasDraft`.
2. `applyDecisions`, only when `verifyMergeable` returned `ok` **and** `wasDraft`, calls the GraphQL **`markPullRequestReadyForReview`** mutation (the REST pulls API cannot flip draft→ready), then proceeds to the existing approve (advisory) + squash-merge.

**Bounds (what keeps this safe):**

- **Terminal only.** The un-draft happens *after* the full predicate has already passed — never speculatively, never at scan/review time. A draft is touched only in the same breath as the merge it has already earned.
- **Escalations stay draft.** A draft that would hand off to a human (touches **L0/L1**, a 🔴 / non-consensus verdict, cycle-cap, no delegation) is **never** un-drafted — it remains a draft for the operator. The L0/L1 boundary is unchanged and still the single line between "agent merges" and "human merges".
- **Fail loud.** If the mutation does not land, the engine **refuses** the merge (no silent half-state) and the next tick retries.

The `autopilot:reviewed` label (#369) is **retained** — its primary purpose is the **L0/L1 escalation** (a reviewed, merge-ready PR a human must merge), which is independent of drafts and unaffected by this ADR. What this ADR removes is only the *non-L0/L1 draft* limbo: those now merge instead of waiting.

## Consequences

- **New external write capability.** `pr-autopilot` now performs one mutation beyond comment / label / squash-merge: `markPullRequestReadyForReview`. This is an extension of the [R-N9](../governance.md#4-r-n-design-rules-basic-design-simplicity) external-git-surface boundary, declared there and reconciled with W-5 below.
- **W-5 / R-N9 / R-N10 unaffected in substance.** The workforce still does not *take* merge authority it was not granted: un-drafting is a sub-step of a merge the target repo's own statute already delegated (R-N10), gated identically (L0/L1 set + consensus + clean + checks + no `autopilot:off`). It cannot un-draft anything it could not already merge. Persona/identity config remains operator-only.
- **Author intent.** A human who deliberately drafts a PR to signal "not done" will have it un-drafted **only** if it is simultaneously green-reviewed, non-L0/L1, conflict-clear and checks-green — i.e. genuinely merge-ready. The `autopilot:off` per-PR label remains the explicit opt-out.
- **SKILL.md.** The draft-specific "mark ready, then merge" cue narrows to the *escalation* case (an L0/L1 draft a human must both ready and merge); the non-L0/L1 draft path is now "the engine readies + merges."
