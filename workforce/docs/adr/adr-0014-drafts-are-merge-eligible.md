# ADR-0014 — Drafts are merge-eligible: the engine marks a green, non-L0/L1 draft Ready for Review, then merges

- **Status**: Accepted (2026-06-23 — operator direction)
- **Date**: 2026-06-23
- **Deciders**: operator, nadia
- **Supersedes**: extends [adr-0010](adr-0010-autopilot-merge-consensus-widening.md) (the non-L0/L1 + unanimous-consensus predicate) and applies uniformly across delegated repos per [adr-0011](adr-0011-own-repo-autopilot-merge.md)
- **Epics**: [epic-010](../epics/epic-010-project-trust-boundary.md)

## Context

`pr-autopilot` has always **routed and reviewed** draft PRs (adr-0010): "every open PR is in scope — draft and non-draft." But a draft could never reach the **merge** leg, for two reasons that were never an intentional policy — they were mechanics:

1. **The predicate refused it.** `verifyMergeable()` required `mergeable_state === "clean"`. GitHub reports a draft as `mergeable_state: "draft"`, so a green, non-L0/L1 draft failed the predicate at that line.
2. **GitHub refuses to merge a draft.** Even past the predicate, the `PUT /pulls/{n}/merge` endpoint rejects a draft outright — there is no REST way to merge one.

The result was an asymmetry the SKILL.md half-codified as policy: *"drafts get an early review pass so issues surface before Ready for review."* In the workforce's actual flow, agents **open their PRs as drafts** and a human (or a later manual step) flipped them Ready. So a reviewed, green, non-L0/L1 draft sat waiting on a manual un-draft — the exact kind of human-in-the-loop step the autopilot exists to remove. The operator's intent is that a draft is **not** a hold signal for the merge predicate; the only line between "agent merges" and "human merges" should remain the **L0/L1 boundary** (adr-0011), not draftness.

## Decision

**A draft is a first-class merge target. The merge predicate treats `mergeable_state: "draft"` as acceptable, and the engine marks a qualifying draft Ready for Review immediately before the merge — uniformly across every delegated repo.**

Concretely, in `workforce/skills/pr-autopilot/pr-merge.mjs`:

1. **`verifyMergeable()` accepts a draft.** The mergeability clause widens from `mergeable_state === "clean"` to `mergeable_state ∈ {"clean", "draft"}` (with `mergeable === true` still required — a draft with a real conflict is still refused). It surfaces `draft` and the PR `nodeId` in its result.
2. **`applyDecisions()` auto-un-drafts before merging.** When the verdict says the PR is a draft, the engine calls the GraphQL `markPullRequestReadyForReview` mutation **before** any merge-intent side effect (comment / approve / merge). **Fail closed:** if the mutation errors or the PR is still a draft afterward, the merge is refused — no merge PUT is issued.
3. **Uniform, no per-repo carve-out.** This applies to every R-N10-delegated target, consistent with adr-0011's "one predicate, one engine path." The L0/L1 set, unanimous-green consensus, checks-green, the delegation, and the `autopilot:off` pause are **all unchanged** — draftness is simply removed as an implicit blocker.

The SKILL.md "early review pass before Ready" framing is replaced accordingly, and root `docs/governance.md §4.4`'s "mergeable/clean" predicate now reads "clean or draft."

## Consequences

- **One fewer manual step.** A green, non-L0/L1 draft no longer waits on a human to flip it Ready — the engine does it and merges, which is the whole point of the delegation.
- **The L0/L1 boundary is still the only line.** Nothing about *what* may merge changes: a draft touching governance / ADR / identity / schedule / a `SKILL.md` prompt still escalates to the operator exactly as before. Draftness was never a safety property; the L0/L1 set is.
- **Still fail-closed.** The new GraphQL un-draft is gated the same way every other write is: a non-200, a GraphQL `errors` array, or a still-`isDraft` PR aborts the merge. The merge PUT remains the authoritative gate.
- **Reviewer-visibility note.** Auto-un-drafting flips the PR's GitHub status from Draft to Ready at merge time. For an **external** delegated repo this is visible to that repo's maintainers; it is bounded by the same delegation + L0/L1 + consensus guards that already authorise the merge itself, so it grants no new authority — only the cosmetic state transition the merge requires.

## Alternatives considered

- **Per-repo opt-in (own repo only).** Rejected: re-introduces the special-casing adr-0011 deliberately removed. The uniform predicate is the simpler, single-concept design; the L0/L1 boundary already does the per-surface gating.
- **Leave drafts review-only, require a human un-draft.** Rejected: that is the manual step the operator asked to remove, and it left reviewed-green PRs stalled.
