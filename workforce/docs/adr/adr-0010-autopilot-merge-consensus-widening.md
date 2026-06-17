# ADR-0010 — Autopilot merge widens to "non-L0/L1 + unanimous reviewer consensus"

- **Status**: Proposed
- **Date**: 2026-06-17
- **Deciders**: operator, nadia
- **Epics**: [epic-010](../epics/epic-010-project-trust-boundary.md)

## Context

The original R-N10 delegated-external-merge predicate (the 2026-06-16 Autopilot
direction) gated autonomous merge to a single narrow class: a **clean
Dependabot security-update PR** — lockfile-only, semver-patch/minor-on-≥1.0,
all checks green, `AUTOPILOT_PR=on`. A tick-behaviour review of `pr-autopilot`
running against `PSVL/asp-cloud` surfaced a structural dead-leg:

1. **The merge leg was dormant.** `pr-autopilot` *skips* Dependabot/bot PRs at
   discovery (the #530/#514 fix) — yet the only class its merge leg could act
   on was Dependabot security PRs. So `pr-autopilot` never routed the only
   thing it could merge; every human-authored PR it *did* route (e.g. #553)
   hit a 🟢 verdict and then handed off, because it fell outside the safe
   class. The autonomous-merge path therefore never fired from `pr-autopilot`.
2. **Two lanes for one job.** Dependabot auto-merge lived in a *separate*
   no-review Cadence (`dependabot-triage`), sharing the same `pr-merge.mjs`
   engine but bound to nobody after the ADR-0007 rebind era — dead inventory.
3. **The merge bar was about the wrong thing.** "Is it a lockfile semver
   bump?" is a proxy for "is it safe to merge without a human?". The operator's
   actual risk boundary is **governance**: an autopilot must never merge a
   change to the project's constitutional (L0) or framework (L1) layer, but a
   reviewed, consensus-approved feature/fix that touches neither is exactly
   what a human merge would rubber-stamp.

The operator chose to make the merge bar match the real boundary and to fold
all PRs (draft, non-draft, human, bot) into one reviewed path.

## Decision

**Widen the R-N10 eligibility predicate from the Dependabot safe class to
"the PR touches no L0/L1 governance path of the target repo AND the nominated
reviewers reached unanimous green," and route every open PR (draft, non-draft,
human, bot) through the one `pr-autopilot` review→consensus→merge path.**
Supersedes the Dependabot-only predicate clause of R-N10 (the rule itself
stands; only its clause-2 predicate and clause-3 kill-switch are amended).

Concretely:

1. **Discovery widens.** `pr-autopilot-scan.mjs` drops the `draft` skip and the
   bot skip. Every open PR updated within the window is a candidate; the only
   discovery filter left is "already routed this cycle." `--max` default 3 → 5.
2. **Verdict is reviewer consensus, not the router's solo call.** The colour is
   the aggregate of the nominated reviewers: **🟢 only when every nominee is
   non-blocking** (unanimous green); any reviewer's 🔴 / `CHANGES_REQUESTED` is
   a veto → escalate; a still-open finding → 🟡 (re-cycle).
3. **Merge bar = non-L0/L1 + consensus.** On a 🟢 unanimous-green verdict,
   `pr-autopilot` merges **iff** the PR touches no L0/L1 path. **A PR touching
   the target repo's governance L0/L1 always escalates to a human** — the
   operator's final call.
4. **L0/L1 is sourced from the target repo's own statute.** The merge engine
   reads the **target repo's `docs/governance.md`** and extracts the declared
   off-limits path globs from a machine-readable block:

   ```
   <!-- autopilot:l0l1-paths -->
   - docs/governance.md
   - docs/adr/**
   - <project-specific L0/L1 paths…>
   <!-- /autopilot:l0l1-paths -->
   ```

   The maintainer declares what is off-limits; the workforce never self-asserts
   it (upholding R-N10 clause 1). If that doc is unreadable or declares no such
   block, **the L0/L1 set is unknown and every merge fails closed** (route +
   review + verdict still run; the verdict hands off). A target repo opts into
   autopilot *merge* by publishing the block — until then `pr-autopilot` is a
   reviewer, not a merger, on that repo.
5. **The `AUTOPILOT_PR` repo-variable kill-switch is removed.** The L0/L1
   boundary read from the target's own governance now carries the "what may
   autopilot merge" decision; a second repo-variable toggle was redundant
   ceremony. The R-N10 *delegation* (clause 1, in the target's statute) and the
   workforce-side per-binding switch remain.
6. **`dependabot-triage` retires.** Bot PRs route through `pr-autopilot` like
   any other PR — reviewed, not no-review. The shared engine `pr-merge.mjs`
   keeps its single `main`/`applyDecisions` surface (so the thin
   `apply-triage.mjs` wrapper still imports cleanly), but the no-review fast
   path is dead: a merge now *requires* `reviewers[]` consensus, which a
   no-review fire cannot supply. The `dependabot-triage` skill folder is slated
   for deletion in a follow-up.

The fail-closed engine (`pr-merge.mjs`) re-verifies the full predicate
server-side: open + mergeable + clean, no L0/L1 file in the diff (set read from
the target governance doc), all required checks green, no `CHANGES_REQUESTED`,
and each `reviewers[]` nominee has a posted lens review. A mis-judged
"🟢 + eligible" cannot cause a bad merge.

## Alternatives considered

- **Keep the Dependabot-only safe class.** Rejected: it left the `pr-autopilot`
  merge leg permanently dormant and tied the merge bar to a package-ecosystem
  proxy rather than the operator's real governance boundary.
- **Define L0/L1 as a skill-default deny-list, overridable per binding.** Ships
  immediately and is self-contained, but the workforce would be *asserting*
  what is off-limits in the target repo — the inverse of R-N10 clause 1
  (delegation lives in the maintainer's statute). Rejected in favour of reading
  the target repo's own `docs/governance.md`; the cost is that a target with no
  declared block gets review-only (fail-closed) until it opts in, which is the
  safe default.
- **Derive L0/L1 from `project.json:governance_docs`.** Indirection through
  workforce-side config rather than the target's live statute; drifts from the
  source of truth. Rejected for the same reason as the deny-list.
- **Majority-of-reviewers consensus.** Rejected by the operator in favour of
  **unanimous green** — a single dissenting lens blocks the autopilot merge and
  routes the decision to a human, matching the conservative merge posture.
- **Keep the `AUTOPILOT_PR` repo kill-switch.** Harmless but redundant once the
  L0/L1 boundary is the gate; one fewer out-of-band toggle to forget. Rejected.

## Consequences

- **Positive.** The merge leg is live for the PRs it actually routes; one
  reviewed path for all PRs (draft/non-draft/human/bot); the merge bar is the
  operator's real boundary (governance L0/L1), not a package proxy; the
  source-of-truth for "off-limits" lives in the maintainer's repo, honouring
  R-N10 clause 1; the `dependabot-triage` dead lane is retired.
- **Accepted costs / risks.**
  - **Wider autonomous-merge authority.** Any reviewed, consensus-approved,
    non-L0/L1 PR can now be merged by the workforce — a materially larger blast
    radius than "lockfile bumps only." Bounded by: unanimous-green consensus,
    all-checks-green, mergeable-clean, the L0/L1 escalation, the per-binding
    kill-switch, and server-side fail-closed re-verification.
  - **Consensus is partly honour-system.** Reviewer personas post COMMENT-event
    reviews under a shared token (W-5: never APPROVE), so the engine verifies
    consensus by (a) no `CHANGES_REQUESTED` and (b) each `reviewers[]` nominee
    having a posted lens review (byline match) — a proxy for, not a proof of,
    "every lens signed off green." The router's verdict synthesis remains
    load-bearing.
  - **Opt-in gap.** A target repo without the `autopilot:l0l1-paths` block gets
    review-only until it publishes one. For `PSVL/asp-cloud` this block must be
    added to its `docs/governance.md` (a target-repo change, out of this PR's
    scope) before any autopilot merge can fire there.
- **Governance.** This is a superseding R-N10 amendment (Zone A); R-N10 clause 2
  (predicate) and clause 3 (kill-switch) are amended in `governance.md`, and the
  §5 authority row updated. W-5 (agents never merge) is unchanged in spirit —
  the bounded R-N10 exception simply covers a wider, governance-bounded class.

## Related

- [governance.md R-N10](../governance.md) — the rule this amends (clauses 2–3).
- `workforce/skills/pr-autopilot/{SKILL.md,pr-autopilot-scan.mjs,pr-merge.mjs,pr-autopilot-post.mjs}`
  — the authoritative skill contract (SKILL.md) + scan + fail-closed merge
  engine + comment/label poster implementing this. The redundant per-skill
  routine doc `routines/pr-autopilot.md` was removed in this change (the
  binding runs under the generic `routines/agent-runner.md`, ADR-0005, and the
  judgment lives in SKILL.md, ADR-0008).
- [ADR-0005](adr-0005-single-execution-model-ccr.md) — the CCR substrate
  `pr-autopilot` runs on.
- [epic-010](../epics/epic-010-project-trust-boundary.md) — the project-scoped
  credential resolution the cross-project merge depends on.
