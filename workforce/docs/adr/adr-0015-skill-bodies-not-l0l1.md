# ADR-0015 — Skill bodies (`SKILL.md`) are removed from the L0/L1 autopilot off-limits set

- **Status**: Proposed
- **Date**: 2026-06-27
- **Deciders**: operator (refluster), nadia
- **Epics**: [010](../epics/epic-010-project-trust-boundary.md) (autopilot-merge lineage: adr-0010 / adr-0011 / adr-0014)

## Context

The §4.4 L0/L1 off-limits block in root [`docs/governance.md`](../../../docs/governance.md) is
the single boundary `pr-autopilot` uses to decide *"agent merges vs human merges"* (per
[adr-0011](adr-0011-own-repo-autopilot-merge.md) — the L0/L1 set is the only line). That block
listed `workforce/skills/**/SKILL.md`, so **every** skill-body change escalated to the operator
and could never be autopilot-merged.

Skill bodies are the reusable instructions that drive agent behaviour; workforce
[governance §3](../governance.md) classifies them **Zone A** (authorship / Rule-11 discipline).

The operator's standing direction (2026-06-27): **building the machinery for agents to operate
autonomously is the priority initiative** — autonomous operation is how every agent accrues
experience. Routing every `SKILL.md` change through a human merge is the largest remaining brake
on the workforce iterating its own instructions.

## Decision

Remove `workforce/skills/**/SKILL.md` from the §4.4 L0/L1 off-limits block. Skill bodies become
**autopilot-mergeable**: a 🟢 unanimous-green, consensus PR that touches only skill bodies (and
other non-L0/L1 paths) may be merged by `pr-autopilot` without operator sign-off, under the
unchanged standard predicate (mergeable/clean-or-ready, checks green, no `autopilot:off`).

Skill bodies **remain Zone A for authorship** — Rule 11 (one skill body per PR; co-version
`meta.json`) and the documented first-version exception are unchanged. This ADR **decouples**
"Zone A authorship discipline" from "autopilot off-limits": the L0/L1 set is now the Zone A
surface **minus skill bodies**.

## Alternatives considered

- **Keep the line (status quo).** Safest; the operator judges the autonomy/experience cost too
  high.
- **Narrow the glob — protect high-risk skills** (e.g. `pr-autopilot`, the
  legal-amendment-review-committee). Considered and **declined by the operator (2026-06-27)** in
  favour of full removal; the standard predicate (unanimous reviewer consensus + green checks +
  `autopilot:off` escape + every other L0/L1 path still escalating) is judged sufficient. A future
  ADR may re-introduce a narrow carve-out if a self-modification incident warrants it.

## Consequences

- **Upside (the goal):** the workforce can iterate its own skill instructions end-to-end without a
  human merge — the experience-building loop the initiative targets.
- **Self-modification surface widens:** `pr-autopilot`'s own routing `SKILL.md` and
  governance-adjacent skill bodies become autopilot-mergeable. Guards that **still hold**: the
  merge *engine* (`workforce/skills/pr-autopilot/pr-merge.mjs`) and any PR touching a still-listed
  L0/L1 path (governance, ADRs, architecture, naming, data-model, workflows, samconfig) continue
  to escalate; unanimous reviewer consensus + green checks are still required; `autopilot:off` is a
  per-PR escape; and `docs/governance.md` (this block) stays L0/L1, so the boundary still cannot
  widen itself.
- **Risk accepted, recorded here so it fails loud, not silent** (C-4 / W-4 spirit). Revisit if a
  bad skill-body merge lands autonomously.

## Related

- [adr-0010](adr-0010-autopilot-merge-consensus-widening.md) (consensus widening),
  [adr-0011](adr-0011-own-repo-autopilot-merge.md) (own-repo; the L0/L1 boundary is the single
  line), [adr-0014](adr-0014-drafts-are-merge-eligible.md) (drafts mergeable). This ADR adjusts the
  *path set* those predicates read.
- `docs/governance.md` §4.4.
