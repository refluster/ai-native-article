# ADR-0011 — Own-repo autopilot merge: retire the self-repo carve-out; the L0/L1 boundary is the single line

- **Status**: Accepted (2026-06-23 — operator-ratified; the engine + root `docs/governance.md §4.4` already implemented this, the status now matches)
- **Date**: 2026-06-18
- **Deciders**: operator, nadia
- **Supersedes**: extends [adr-0010](adr-0010-autopilot-merge-consensus-widening.md) (the non-L0/L1 + unanimous-consensus predicate) by removing its one remaining special case
- **Epics**: [epic-010](epics/epic-010-project-trust-boundary.md)

## Context

After [adr-0010](adr-0010-autopilot-merge-consensus-widening.md), `pr-autopilot`'s merge predicate is **uniform** across repos: a PR merges iff it has unanimous-green reviewer consensus, touches no L0/L1 path declared in the *target repo's own* governance, is clean with checks green, the bound project carries an R-N10 delegation, and no `autopilot:off` label is set. The engine (`pr-merge.mjs`) re-verifies all of this server-side and fails closed.

This repo (`refluster/ai-native-article`) already carries that delegation and an L0/L1 off-limits block (root `docs/governance.md §4.4`). Yet one thing made it special: a **self-repo veto** — *"agents never merge the workforce's own PRs"* — implemented as a bolt-on layered over the otherwise-uniform predicate in four places:

1. a `SELF_REPO` guard in `pr-merge.mjs` that hard-refuses when `repo === refluster/ai-native-article`;
2. a "W-5 own-repo escalation" paragraph in root `§4.4`;
3. R-N10 clause 1's self-repo carve-out + the SKILL.md "case 3" + the #338 worked example;
4. the §5 matrix's "delegated **external**-merge" framing.

Two problems with this carve-out:

- **It is redundant complexity.** It bans merging a CSS fix for the same reason it bans merging a constitutional amendment. But the real risk boundary is **governance**, and that is *already* protected for every repo by the L0/L1 set — the same mechanism adr-0010 made load-bearing. The veto is a second, coarser protection stacked on top of a finer one that already does the job.
- **It rests on a loose citation.** The veto was attributed to **W-5**, whose actual text is *persona stability* (agent identity/config is mutated only through the agents-api write path) — nothing about PR merges. So the own-repo merge ban was never a literal W-5 requirement; it was an over-broad reading of it.

The operator's goal is to let agents merge this repo's PRs **while simplifying** the governance, not adding to it.

## Decision

**Treat `refluster/ai-native-article` as a normal delegated R-N10 target. Delete the self-repo carve-out. The L0/L1 off-limits block becomes the single line between "agent merges" and "human merges."**

Concretely:

1. **Remove the `SELF_REPO` guard** from `pr-merge.mjs` (and its env override). The own repo flows through the exact predicate every other delegated repo does.
2. **The L0/L1 off-limits block is the only boundary**, and it is completed to be the faithful, machine-readable projection of this repo's **operator-only (Zone A)** surface — adding `.github/workflows/**`, the workforce `architecture.md` / `naming.md` / `data-model.md`, `infra/sam/samconfig.toml`, and `workforce/skills/**/SKILL.md` (prompt bodies) to the governance/ADR/identity paths already listed. A PR touching any of these still always escalates to the operator.
3. **Net effect on the quoted rule.** *"Agents never merge the workforce's own repo's PRs"* → *"Agents merge the workforce's own **non-L0/L1** PRs on green, identically to any delegated repo; anything on the L0/L1 (operator-only) boundary still escalates."*

## Consequences

- **Simpler, by removal.** One predicate, one engine path, one protection concept. The PR that lands this ADR **deletes** governance text and guard code; it does not add machinery. R-N10 loses its self-repo paragraph, root §4.4 loses its escalation paragraph, the SKILL.md loses "case 3" + the #338 example, and the §5 matrix drops the "external"-only framing.
- **W-5 is untouched and preserved.** Persona/identity config stays operator-only via the agents-api write path; every Zone A file (prompts, rosters, rubrics, schedules, deploy config, governance) is inside the L0/L1 set, so an agent still cannot merge a change to the workforce's own identity or constitution. What changes is only that *mechanical, reversible* own-repo PRs are no longer special-cased out of the standard predicate.
- **The boundary holds on its own enabling change.** This ADR edits `docs/governance.md` + adds an ADR under `docs/adr/**` — both L0/L1 — so **even under the new rule, this very PR escalates to the operator to merge.** Agent self-merge of the rule that grants agent self-merge is impossible by construction.
- **Kill-switches unchanged.** The repo-wide pause (empty the `autopilot:l0l1-paths` block → unknown set → fail closed) and per-PR pause (`autopilot:off` label) both still apply to the own repo.
- **Regression net.** The `pr-merge.mjs` test that asserted the own-repo refusal is replaced by two: an own-repo non-L0/L1 green PR now **passes**, and an own-repo PR touching `docs/governance.md` still **refuses** (`/L0\/L1/`) — proving the simplification enables merges without lowering the governance wall.

## Alternatives considered

- **Narrower enablement** (allow only a restricted own-repo PR class, e.g. agent-authored product code or bot PRs). Rejected: it keeps a self-repo special case — the opposite of the simplification goal — and the L0/L1 boundary already expresses "what's off-limits" with finer, declarative control (widen the block to protect more; it needs no new code).
- **Keep the veto.** Rejected by the operator: it blocks the intended capability and is redundant with the L0/L1 boundary.
