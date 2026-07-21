# ADR-0020 — Delegated memory curation: a bounded token write for the memory profile block

- **Status**: Superseded by ADR-0021 (2026-07-21) — the authentication mechanism only (§Decision-3); the route design, content contract, shrink guard, curator assignment, and §5 authority grant below remain in force.
- **Date**: 2026-07-19
- **Deciders**: operator (refluster) — this is the Epic-018 Story-4 write-authority decision, made by the operator's in-message direction (「この長期記憶をworkforceの誰かが更新し続けるよう仕組み化したい…頻度は各エージェントの記憶が1週間に一度は更新されるように」); drafted by a Claude Code session
- **Related**: [ADR-0019](adr-0019-agent-semantic-memory.md) (the layer + content contract this write path serves), [ADR-0009](adr-0009-scoped-capability-tokens.md) (the capability-token direction this instantiates), [ADR-0007](adr-0007-agent-config-single-source.md) (single-writer discipline; this route is inside agents-api), [ADR-0021](adr-0021-dynamic-memory-write-token.md) (supersedes §Decision-3's static-secret mechanism with a dynamic minted token), [Epic-018](../epics/epic-018-semantic-memory-curation.md)

## Context

ADR-0019 shipped semantic memory as an operator-gated write: curated MEMORY.md
files land via a PR + a dispatch workflow. That was the right posture for the
five-persona pilot, but it cannot deliver the operator's standing requirement —
**every active agent's memory re-curated at least weekly** — at roster scale
(35+ personas and growing): weekly × N operator clicks is exactly the
human-era handoff the MVV says to redesign, and Epic-018 Story 4 explicitly
deferred the delegation decision to the operator.

The operator has now made it (2026-07-19): institutionalise curation — a
workforce persona updates memories on a cadence, sourced from **all** of each
agent's activity (cross-project record, not just agent-workforce rows), with
weekly coverage per agent.

Constraints the design must respect: W-5 (persona identity/config mutations
are operator-gated — memory must not become a side door into `system_prompt`
or bindings), the CCR trust boundary (sessions hold capability tokens, never
AWS creds — ADR-0005/R-N1), and ADR-0019's own consequence note ("a bad
memory poisons every subsequent fire" — the write path needs mechanical
guards, not just judgment).

## Decision

1. **A dedicated bounded write route**: `POST /agents/{slug}/memory` on
   agents-api, bearer-authed at the handler (same posture as `POST /feed` /
   engagements), authorising exactly one mutation class — the ADR-0019
   `memory` profile block `{last_updated, body}`. Every other persona-row
   field stays on the IAM-authed PATCH path; W-5 is narrowed by one named
   field, not loosened.
2. **Server-side gates, fail-closed** (`lambdas/shared/memory-contract.ts`):
   the ADR-0019 content contract (title, `Curated: YYYY-MM-DD` →
   `last_updated`, mandatory `## Mission anchor`, ≥200-char floor, 16 KB S17
   ceiling) plus a **shrink guard** — a revision below 50% of the existing
   body length is 422-refused unless the caller declares `allow_shrink` — so
   a degenerate LLM output cannot silently wipe a persona's memory. Every
   accepted write lands an `AUDIT#` row (actor `memory-writer (bearer)`),
   reviewed by the weekly config digest like any config mutation.
3. **The capability token** lives at
   `wf/projects/agent-workforce/workforce.memory_write_token` (dual-principal
   like the feed token: orchestrator injects it into fires via the skill's
   `requires[]`; agents-api validates the presented bearer against the same
   secret). Registered as a credential type across the five injector mirror
   points.
4. **The curator is a Cadence, and the curator is freya.** The
   `memory-curation` skill (owner freya — Agent Experience Designer, whose JD
   is the fire-time composition and recall packet, i.e. exactly this
   material; improvement agent sana) fires daily and curates the
   oldest-memory cohort, sized `max(5, ceil(active_agents / 7))` — weekly
   coverage per agent by construction, scaling with the roster
   (`pick-cohort.mjs`). Curation sources are the agent's **full
   cross-project record** (`GET /agents/{slug}/executions` + posts + current
   memory) — the binding's `project_id=agent-workforce` scopes the
   *credential*, not the *sources*.
5. **§5 authority**: a new row records this as bounded A-authority — "write
   an agent's `memory` profile block via the memory-write token" — with
   everything else on the persona row unchanged at B. The row is proposed in
   the same PR (Zone A: agent proposes, operator ratifies by merging).

## Alternatives rejected

- **Keep the operator-dispatch path and just run it weekly**: N-agent × weekly
  operator toil; contradicts the operator's direction to institutionalise; the
  dispatch workflow remains as the manual/repair path, not the cadence.
- **Widen the existing IAM PATCH to a bearer**: would expose every
  identity/config field to a capability token — a W-5 breach. The dedicated
  route inverts it: one field, heavily gated.
- **Propose-only cadence (PRs of seed files, operator merges)**: preserves the
  pilot posture but re-creates the same weekly click backlog with extra git
  churn; rejected by the operator's Story-4 decision. The seed files stay as
  the pilot's one-shot inputs; the live loop writes directly.
- **One weekly mega-fire curating everyone**: a single session distilling 35+
  records is context-starved and one failure loses the week. Daily × cohort
  keeps each fire bounded and rotation self-healing (a missed fire just
  reorders the next cohort).

## Consequences

- Memory curation becomes standing workforce work with a persona accountable
  for its quality (freya), an audit trail per write, and weekly coverage that
  scales with headcount — the Epic-018 Story-5 rollout collapses into the
  cadence's normal operation.
- A compromised memory-write token can rewrite memories (within the contract
  gates) but can never touch persona identity, bindings, or budget — blast
  radius is one profile block, always audited, always shrink-guarded.
- W-3: one daily CCR fire (~5–6 distillations each) joins the existing cadence
  envelope; cost class `medium`, inside the current USD 500/mo cap.
- The pilot's operator-dispatch workflow (`workforce-curate-agent-memory.yml`)
  survives as the manual override/repair path — same endpoint semantics, IAM
  side.
