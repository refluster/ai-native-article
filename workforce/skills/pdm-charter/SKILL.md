---
name: pdm-charter
description: |
  Stub for Maya's Epic → Story decomposition step. Reads an Accepted Epic
  under workforce/docs/epics/ and proposes a Story breakdown (each Story = one
  GitHub issue) for operator approval. Not implemented in v1 — declared so
  the binding shape + routine wiring is in place when the contract is
  proven by the manual run of Epic-010.
---

# pdm-charter — Epic → Story decomposition (stub for v2)

**Owner**: maya (PM / Founder)
**Executor**: deterministic (handler currently throws — placeholder)
**Cadence**: manual (operator triggers when a new Epic flips to `Status: Accepted`)

## Position in the simplified workflow

The 2026-05-25 process simplification puts Maya in two roles:

1. **Epic → Story split** (this skill, when implemented). For an `Accepted` Epic, propose Story-sized GitHub issues that each Claude Code can pick up and ship as 1 (sometimes more) PR.
2. **Issue / PR routing** (separate Maya skill, also future). Maya watches issues + PRs and routes them to implementer / reviewer agents via PR comments; ≤ 7 router-comment cycles before escalation.

`pdm-charter` covers (1) only. Routing is its own skill.

The middle layer that the old design used (`pdm-decompose`: Epic → role-tagged sub-units) is **gone**. Claude Code consumes Stories directly and decides the role decomposition inside each PR.

## Why this skill exists today as a stub

The Epic-010 thread that opened the original RFC-010 PR series did the Epic → Story split **manually** (operator + assistant in chat). The next Epic should be repeatable from a skill, not a chat thread. `pdm-charter` is the placeholder for that.

Declaring it now (stub handler + `executor: cli` binding on Maya) means:

- The binding entry documents the intended workflow surface
- `validate-agent-json.mjs` does not fire orchestrator dispatch for `executor: cli` bindings — the stub never auto-runs
- The next PR that implements the real handler keeps the binding key (`pdm-charter`) and the operator entry-point unchanged

## v2 contract (sketch — not implemented)

**Inputs**: a path to an `Accepted` Epic file (e.g. `workforce/docs/epics/epic-011-foo.md`).

**Outputs / side effects**:
1. Create or update a tracker GitHub issue titled `Epic-N — <title>` linking back to the Epic file
2. Post a `<!-- pdm-charter:proposal -->` comment on the tracker that drafts the Story list. Each Story:
   - has a user-value framing (per [`workforce/docs/epics/README.md`](../../docs/epics/README.md) "Epic sizing guidance" — Stories are 1–5 days of work, single slice of user value)
   - has explicit acceptance criteria
   - flags architectural deltas (cost > USD 10/mo, new managed services, R-N* implications) inline — operator decides before approval
3. Wait for operator 👍 on the proposal comment → on next run, create the Story issues and link as sub-issues of the tracker

The state machine mirrors operator-gated approval (proposal → 👍 → materialise). The output unit is **GitHub issues** (not a hierarchical sub-epic tree). Epic : Story is M:N — Maya may surface that a Story already exists from a previous Epic and link to it rather than re-creating.

## Until implemented

Operator authors Story issues manually (as in the Epic-010 manual run starting on 2026-05-25). When the contract surfaces from that manual experience, the real handler ships in a follow-up PR.
