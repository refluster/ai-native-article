# ADR-0019 — Agent semantic memory: a curated MEMORY.md on the META row, injected at every fire

- **Status**: Accepted (ratified by merging implementation PR #447; status reconciled 2026-07-11 by backlog-reconcile — pending operator confirmation)
- **Date**: 2026-07-07
- **Deciders**: operator (refluster), drafted by a Claude Code session on the operator's direction (「MEMORY.mdで平文で管理」「MVVを継続的に追い求める前提」「意味レベルで記憶」「他のエージェントにも同様に適用」)
- **Related**: [ADR-0007](adr-0007-agent-config-single-source.md) (the single write path this rides), [ADR-0002](adr-0002-no-dedicated-vector-store.md) (recall stays lexical/structural), [Epic-012](../epics/epic-012-agent-experience.md) (the episodic chunk layer), [Epic-018](../epics/epic-018-semantic-memory-curation.md) (the rollout this decision enables)

## Context

Personas accumulate experience (EXEC rows, feed reflections, episodic S3
chunks) but nothing durable feeds it back: every fire starts from persona +
skill + a shallow recall packet, so the same lessons get re-learned and the
same frictions re-posted. The console's MEMORY panel — designed as a
structured `entries[]` deck of fact/decision/preference/person items — never
carried data.

The operator set four requirements for the durable layer:

1. **Function, not display**: memory must act as long-term memory — read by
   the agent at every fire, not just rendered on a profile page.
2. **Plain text**: a `MEMORY.md`, optimised for ease of update and use, not a
   JSON schema.
3. **Semantic level**: distilled meaning (principles, people-context,
   standing bets), not work-level records — those already live in the EXEC
   ledger. Memory is premised on continuously pursuing the MVV.
4. **Generalisable**: pilot on a few personas, then turn curation into a
   repeatable technique for every agent.

Two facts shape the design space. First, the CCR agent-runner already fetches
`GET /agents/{slug}` on every fire (the persona layer, ADR-0007) — anything on
that record is injectable at zero extra cost. Second, the CCR session holds no
AWS credentials (R-N1/ADR-0005 trust boundary), so S3-resident memory would
need a new public read route before an agent could see it.

## Decision

1. **Memory is two layers, named.** *Episodic* memory stays the S3 rolling
   chunks + compactor (Epic-012) — what happened, run by run, written by the
   machinery. *Semantic* memory is new: one curated plain-markdown MEMORY.md
   per agent — what it means, distilled at the meaning level.
2. **Semantic memory lives on the META row** as the `memory` profile block,
   shape `{ last_updated, body }` where `body` is the MEMORY.md document.
   DDB stays authoritative (W-2, R-N2, ADR-0007); writes go through the
   agents-api single write path (S17 16 KB ceiling + AUDIT# trail). The
   git files under `workforce/seed/memory/` are one-shot curation input,
   not a mirror.
3. **Injection is composition layer 3.5** in the agent-runner contract:
   read from the same `GET /agents/{slug}` response as the persona, held for
   every task of that agent in the batch. Precedence on conflict: governance
   and the north star outrank memory; memory outranks improvisation. Absent
   memory is a valid state, not an error.
4. **Content contract** (enforced by the writer script + curation review):
   MVV-anchored (`## Mission anchor` mandatory — how *this role's* learning
   serves the mission, never a duplicate of `mvv.md`, which layer 2 already
   injects); semantic level (principles generalised across episodes; no
   activity records); grounded in the agent's real record (invented memory
   prohibited — it feeds straight back into execution); first person and
   self-contained; a machine-readable `Curated: YYYY-MM-DD` token.
5. **Curation is operator-gated for now.** Writes ride the existing
   authority row (§5: persona-row mutation escalates; the operator approves
   by merging the seed-file PR and dispatching the write workflow).
   Delegating bounded curation to a cadence is Epic-018's question, decided
   there — not silently here.

## Alternatives rejected

- **S3 chunk as the semantic store** (write MEMORY.md as a
  `memory/{slug}/vNNNN.md` chunk): conflates the layers — the compactor
  folds chunks into rolling summaries, so a curated document would be
  digested back into episode soup; and the CCR session cannot read S3, so it
  needs a new public route + a second fetch. Rejected: wrong lifecycle,
  higher cost, no benefit over the record already fetched.
- **Git-authoritative MEMORY.md** (like the north-star corpus): memory is
  per-persona *state*, not collective statute — git-authoritative agent
  state is exactly what ADR-0007 retired. Rejected on W-2/R-N2.
- **Keep the structured `entries[]` deck**: machine-enumerable but hostile
  to both curation (id/kind bookkeeping per thought) and use (an LLM reads
  prose better than a taxonomy). It never carried data, so superseding it
  costs nothing. Rejected for update/use ergonomics.
- **Vector-store recall over history instead of curation**: already rejected
  as ADR-0002; semantic memory is a *judgment* artefact (what mattered), not
  a retrieval problem (what matched).

## Consequences

- Every fire composes: north star (collective why) → persona (voice) →
  semantic memory (individual learning) → skill (task) — the same fire now
  carries what the org believes *and* what this agent has learned.
- The 16 KB ceiling forces curation discipline: memory is a lens, not a
  corpus. Growth pressure routes to better distillation, not bigger blocks.
- The console MEMORY panel renders markdown instead of the kind-tagged list;
  `AgentMemory` in the SPA becomes `{ last_updated, body }`. Rows still
  carrying the empty legacy `{ entries: [] }` shape render as the empty
  state until first curation.
- Curation quality is now a first-class editorial surface: a bad memory
  poisons every subsequent fire of that persona. Hence the grounding rule
  and the operator gate; Epic-018 owns loosening it safely.
