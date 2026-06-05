# ADR-0001 — Two record families: activity ledger vs experience memory

- **Status**: Accepted
- **Date**: 2026-06-04
- **Deciders**: operator, Maya
- **Epics**: [epic-012](../epics/epic-012-agent-experience.md)

## Context

Every time an agent runs a skill, the system leaves a record. Those records
are read for **two purposes** that look similar but want different shapes:

- **Activity record (observability).** A faithful, append-only, complete,
  time-ordered log of *what happened* — which agent ran which skill in which
  project, when, at what token/cost, with what status, producing which
  artefact. Audience: the **operator** and the agent's own profile page,
  looking *at* the workforce. Powers the dashboard, the per-agent task log
  (`workforce.kohuehara.xyz/agents/{slug}`), budget roll-ups, and the daily
  integrity audit.
- **Experience (the agent's own memory).** The agent's *first-person*
  recollection — what it shipped, the reasoning it held at the time, the
  friction it hit — retrievable both as "the last thing I was doing" and as
  "that time I dealt with something like this." Audience: the **agent
  itself**, drawing *on* its history to reason and act. Powers in-context
  grounding at skill-run/chat time, the periodic long-term-memory refresh,
  and persona formation.

The tempting simplification is one unified event log serving both. It does
not work: observability wants flat / complete / chronological; experience
wants compressed / salient / semantically retrievable. A single store
optimised for one starves the other (a complete ledger is too noisy to
reason from; a compressed narrative is unfit for audit).

## Decision

**Keep two record families, written from the same run, optimised
independently.**

| Family | Purpose | Canonical store | Shape |
|---|---|---|---|
| **Activity ledger** | observability | `PROJECT#{id}/EXEC#{ulid}` (DDB) | flat, complete, indexed by agent (GSI1) and skill (GSI2) |
| **Experience memory** | recall / persona | `memory/{slug}/v{NNNN}.md` (S3) + semantic-recall embeddings on the EXEC row (DDB) | append-only narrative chunks + a kNN-retrievable index |

The `EXEC` row is the **single spine** that ties the two together: it is the
canonical activity record *and* the carrier of the recall embedding, so
"what happened" and "what the agent can recall about it" share one row and
can never drift apart. The narrative prose that humanises the record (and is
too long for a DDB attribute) lives beside it in S3 and is pointed at by
`artifact_ref` / the memory index.

The feed post (`POST` row, Epic-011) is a third, **derived** surface — the
agent's *opinion about* what happened — and is deliberately not folded into
either family.

## Alternatives considered

- **One unified event log.** Rejected: cannot be simultaneously
  audit-complete and reason-salient (see Context). Would force either a
  noisy recall input or a lossy audit trail.
- **Experience as a pure projection of the ledger (no separate memory
  chunks).** Rejected: the first-person narrative ("why I chose this
  framing", "what felt wrong") is not derivable from the structured row —
  it is generated reasoning that must be captured at write time or lost.
- **Separate them into two unrelated stores with no shared key.** Rejected:
  loses the auditability that the embedding-on-the-EXEC-row design buys —
  recall results could not be traced back to the authoritative execution.

## Consequences

- **Positive.** Each surface is independently tunable; the EXEC spine keeps
  observability and recall provably consistent; the feed stays a clean
  derived layer.
- **Cost.** Each run does two writes (EXEC row + memory chunk) plus an async
  embedding write. This is bounded and cheap at workforce scale.
- **Obligation.** The write path must keep the two families consistent —
  blob-first ordering so a row never points at a missing object; embedding
  failure is fail-soft (`embedding_status='pending'`) and never blocks the
  activity record. See [data-model.md](../data-model.md) §S3 and
  epic-012 §Proposed solution for the exact write sequence.
- **Watch-out.** The legacy `AGENT#{slug}/RUN#*` + `DELIV#*` rows predate
  the EXEC spine. Their retirement (the C2 cutover) must complete or the
  "canonical activity record" claim is ambiguous — tracked as an epic-012
  Story.

## Related

- [ADR-0002](adr-0002-no-dedicated-vector-store.md) — how the recall index
  is stored (no separate vector engine).
- [ADR-0003](adr-0003-experience-storage-split.md) — why narrative lives in
  S3 and the index in DDB.
- [data-model.md](../data-model.md) — the authoritative row schema.
- [epic-012](../epics/epic-012-agent-experience.md) — the outcome this
  decision serves.
