# ADR-0002 — Semantic recall without a dedicated vector store

- **Status**: Accepted
- **Date**: 2026-06-04 (decision originated in Epic-010 §9 / [#89](https://github.com/refluster/ai-native-article/issues/89) decision delta #1; extracted to an ADR by Epic-012)
- **Deciders**: operator, Maya
- **Epics**: [epic-010](../epics/epic-010-project-trust-boundary.md), [epic-012](../epics/epic-012-agent-experience.md)

## Context

Experience recall (ADR-0001's second family) needs a *semantic* retrieval
shape — "find past executions like this one" — not just structured filters.
The textbook answer is a dedicated vector store (OpenSearch Serverless k-NN,
pgvector, Pinecone, …) holding the embeddings.

Two forces push against that at workforce scale:

- **R-N2 — single state store.** The workforce's governance constrains
  persistent state to DynamoDB (indexed rows) + S3 (blobs). A second query
  engine is a new operational surface, a new failure mode, a new thing to
  back up and secure.
- **Cost arithmetic.** OpenSearch Serverless has a ~USD 50/mo floor
  regardless of usage. The projected execution volume (≤ 12 agents × ~100
  executions/day) implies a per-agent partition of a few thousand rows on
  any horizon worth planning for — storing those embeddings as a DynamoDB
  binary attribute costs ~USD 1/mo.

A 50× cost multiple for an engine whose latency advantage doesn't matter at
this corpus size is not justified.

## Decision

**Ship semantic recall with no new engine. Store the embedding as a
`float32` binary attribute on the `PROJECT#{id}/EXEC#{ulid}` row; brute-force
cosine kNN in the recall Lambda over the calling agent's GSI1 partition.**

- The interface is `agent.recall(query, k)`.
- The "index" is the GSI1 query (`gsi1pk = AGENT#{slug}`) plus an in-memory
  cosine-distance sort.
- Embeddings are computed at write time over `{skill_name, inputs_summary,
  artifact.summary, error}`. The row also carries `embedding_model_id`,
  `embedding_dim`, and `embedding_status`.
- **Fail-soft.** If the embedding API fails, the execution still succeeds and
  the row carries `embedding_status='pending'`; a retry worker drains the
  backlog. The activity record is never blocked on the recall index
  (consistent with ADR-0001).

The recall path is intentionally swappable **behind the `agent.recall()`
interface** — callers never see the storage choice.

## Alternatives considered

- **OpenSearch Serverless k-NN.** Rejected at v1: ~USD 50/mo floor, second
  state engine (violates R-N2's spirit), latency advantage irrelevant at a
  few-thousand-row corpus.
- **pgvector on RDS.** Rejected: introduces a relational engine the
  workforce otherwise has no use for; same R-N2 objection, worse ops
  surface than DDB.
- **Embeddings in S3 alongside the memory chunks.** Rejected: kNN would
  require fetching every blob per query — far slower than a single
  GSI1 partition scan, and it scatters the index away from the row it
  describes (hurts the ADR-0001 auditability property).

## Consequences

- **Positive.** No new engine; ~USD 1/mo; recall results trace directly to
  the authoritative EXEC row; the storage choice is hidden behind one
  interface.
- **Bounded latency.** Brute-force kNN over the calling-agent partition holds
  a p95 < 500 ms target with comfortable margin at ≤ 12 agents.
- **Migration triggers (when DDB-brute-force stops being right).** Swap to a
  dedicated vector engine — behind the same `recall()` interface — when
  **either** holds for ≥ 1 week:
  - per-agent executions > 50,000 (partition scan stops being trivially
    cheap), or
  - `recall` p95 latency > 1 s (measured via a CloudWatch metric from the
    recall Lambda).
  When triggered, the migration is a Zone A doc amendment (this ADR + a
  superseding ADR) plus a Zone B engine swap — no caller changes.
- **Watch-out — model drift.** Cosine across two embedding spaces is
  meaningless. A change of `embedding_model_id` requires a re-embedding
  pass or a query-time filter to a single vintage. Tracked as an
  epic-012 open question.

## Related

- [ADR-0001](adr-0001-record-family-separation.md) — why the embedding lives
  on the activity-ledger row in the first place.
- [ADR-0003](adr-0003-experience-storage-split.md) — the broader S3-vs-DDB
  split this decision is one instance of.
- [data-model.md](../data-model.md) §Semantic recall — the authoritative
  attribute schema and migration-trigger text.
- [epic-010 §9](../epics/epic-010-project-trust-boundary.md) — where this
  decision originated.
