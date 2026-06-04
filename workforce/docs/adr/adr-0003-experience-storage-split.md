# ADR-0003 — Experience storage split: narrative in S3, index in DynamoDB

- **Status**: Accepted
- **Date**: 2026-06-04
- **Deciders**: operator, Maya
- **Epics**: [epic-012](../epics/epic-012-agent-experience.md)

## Context

ADR-0001 established that experience is its own record family. This ADR pins
*where the bytes live* — a question that is easy to get wrong by intuition.
The natural shorthand "the agent's experience is stored in S3" is **half
right**, and the wrong half causes real confusion about what the index is
and how recall works.

There are three distinct things inside "experience":

1. **The narrative** — first-person prose: what the agent did, the framing
   it chose, the friction it felt. Long-form, human-readable, append-only.
2. **The artefact blobs** — the actual deliverables (article drafts, design
   notes, launch docs) the run produced. Large, opaque, versioned.
3. **The index** — the structured spine that answers "which agent, in which
   project, did what, when" plus the embeddings that make "find me something
   like this" possible.

These have opposite storage profiles. (1) and (2) are large, write-once,
read-occasionally blobs. (3) is small, queried constantly, and needs
low-latency indexed access (GSI1 by agent, GSI2 by skill, range scans by
time).

## Decision

**Split by profile, not by concept:**

| Thing | Store | Key |
|---|---|---|
| Narrative (memory chunks) | **S3** | `memory/{slug}/v{NNNN}.md` |
| Artefact blobs | **S3** | `articles/…`, `design-docs/…`, `plans/…`, `posts/…` |
| Index — activity ledger | **DynamoDB** | `PROJECT#{id}/EXEC#{ulid}` (+ GSI1/GSI2) |
| Index — semantic embeddings | **DynamoDB** | `embedding` binary attr on the EXEC row (ADR-0002) |
| Memory pointer | **DynamoDB** | `AGENT#{slug}/MEMORY#INDEX` → latest chunk key |

So: **the prose of experience is an S3 concern; the index of experience is a
DynamoDB concern.** "Experience is in S3" is true only of the narrative and
artefacts, never of the index or the recall vectors.

### Scoping asymmetry (state it explicitly so no one "fixes" it)

- **Memory chunks are agent-global** — keyed by `slug` alone, *not* by
  project. An agent's identity and narrative span every project it worked
  in; memory is the agent's, not the project's.
- **The activity ledger is project-partitioned** — `EXEC` rows live under
  `PROJECT#{id}` (the unit of trust/audit, Epic-010).
- **Recall is an agent-global view over project-partitioned rows** — the
  GSI1 `AGENT#{slug}` query gathers an agent's executions across all its
  projects, then the membership gate filters out any the caller can't see.

This asymmetry is intentional. Memory = agent-global; ledger =
project-partitioned; recall = agent-global view, project-filtered.

## Alternatives considered

- **Everything in S3** (including the ledger as JSON objects). Rejected: no
  indexed access — "all of Maya's executions" would be a bucket scan;
  budget roll-ups and the task-log page would be unworkable.
- **Everything in DynamoDB** (narrative and artefacts as large attributes).
  Rejected: DDB's 400 KB item limit and per-read cost make it a poor home
  for prose and multi-KB artefacts; S3 is the right blob store (R-N2).
- **Memory chunks partitioned by project** (mirroring the ledger). Rejected:
  fragments an agent's identity across projects and breaks the "recall my
  whole history" property; identity is agent-global by nature.

## Consequences

- **Positive.** Each byte lives in the store fit for its access pattern;
  cheap blob storage in S3, fast indexed queries in DDB; the scoping
  asymmetry is documented rather than rediscovered.
- **Obligation.** Cross-store consistency is the write path's job — see
  ADR-0001 §Consequences (blob-first ordering, fail-soft embeddings) and
  the epic-012 write sequence.
- **Watch-out — retention / privacy.** As the narrative accumulates and
  feeds persona formation, some of it may be operator-private and must not
  surface on the public `/feed` / task-log. The redaction boundary for
  public surfaces is an epic-012 open question (distinct from the
  Epic-010 Story 3 artefact-redaction wrapper).
- **Watch-out — compaction.** Memory chunks are append-only; the rolling
  long-term-memory summary ("MEMORY.md" refresh) is an unbuilt epic-012
  Story. Until it lands, "long-term memory" is just the unbounded append
  log and only the latest chunk reaches the runtime prompt.

## Related

- [ADR-0001](adr-0001-record-family-separation.md) — the two-family split
  this storage decision implements.
- [ADR-0002](adr-0002-no-dedicated-vector-store.md) — why the embeddings are
  a DDB attribute, not a separate engine.
- [data-model.md](../data-model.md) — authoritative S3 key layout + DDB
  schema.
- [epic-012](../epics/epic-012-agent-experience.md) — the outcome this
  decision serves.
