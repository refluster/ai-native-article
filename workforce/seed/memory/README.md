# seed/memory — per-agent MEMORY.md, the semantic long-term memory layer

One `MEMORY.md` per agent (`{slug}.md`): the curated **semantic** memory the
persona re-reads at every fire. Decision record: [ADR-0019](../../docs/adr/adr-0019-agent-semantic-memory.md);
generalisation plan: [Epic-018](../../docs/epics/epic-018-semantic-memory-curation.md).

Plain markdown, chosen deliberately over a structured schema: memory is prose
the persona thinks with and the operator edits directly — ease of update and
ease of use beat machine-enumerable entries (the earlier `entries[]` deck shape
was superseded by ADR-0019 before ever carrying data).

**W-2 posture: these files are NOT a mirror.** DDB is the authoritative store
(the `memory` block on `AGENT#{slug}/META`, ADR-0007). Each file here is
curation *input* for `workforce/scripts/curate-agent-memory.mjs`, which
whole-document-replaces the block through the agents-api single write path
(S17 validation + `AUDIT#` row). After a write lands, the row may be curated
further without these files changing — never read them back as current state.

## The two memory layers (human analogy)

| layer | store | written by | holds |
|---|---|---|---|
| **episodic** | S3 `memory/{slug}/vNNNN.md` chunks + compactor (Epic-012) | the runtime, automatically | what happened, run by run |
| **semantic** (this) | `META.memory` `{last_updated, body}` | curation (operator-gated) | what it *means* — distilled principles |

Semantic memory is formed the way a person forms it — from personality, work
history, outputs, interactions, and in-the-moment lessons — but stored at the
**meaning level**, not the work level: a lesson generalised across episodes,
not the episodes themselves. Work-level records stay in the EXEC ledger.

## Content rules

1. **MVV-anchored.** The persona pursues the workforce MVV continuously
   (`workforce/docs/mvv.md` is injected as layer 2 of every fire); the
   `## Mission anchor` section states how *this role's* learned knowledge
   serves that mission — it must not duplicate the MVV text.
2. **Semantic level.** Distil the principle; drop the episode. PR numbers and
   dates appear only when the fact itself is durable (a regulatory deadline),
   never as activity records.
3. **Grounded.** Every line must be distilled from the agent's real record
   (EXEC ledger, feed posts, org edges). Invented memory is prohibited — the
   body feeds back into the persona's execution as system context.
4. **Self-contained, first person.** The document must read correctly at
   session open with no surrounding context.
5. **Bounded.** ≤ 16 KB serialized (the S17 profile-block ceiling); in
   practice aim for 1.5–3 KB — memory is a lens, not a corpus.

## Structure

```md
# MEMORY — {Name} ({Role})
> Curated: YYYY-MM-DD · <provenance one-liner>
## Mission anchor
## Learned principles
## People & organisation
## Standing bets & falsifiers   (optional)
```

The `Curated: YYYY-MM-DD` token is machine-read by the writer script as
`last_updated`.
