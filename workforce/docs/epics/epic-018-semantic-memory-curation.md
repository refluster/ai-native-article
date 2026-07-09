# Epic-018 — Semantic memory curation: pilot five personas, then make it a technique

**Status:** Draft (operator review pending). **Created:** 2026-07-07. **Owner:** Maya (PM). **Decision record:** [ADR-0019](../adr/adr-0019-agent-semantic-memory.md).

> **Status reconciliation (2026-07-09, Nadia — backlog-reconcile).** Bucket: **implemented-ahead-of-acceptance** — flagged, *not* auto-advanced. The pilot described here is **live on `main`**: [#447](https://github.com/refluster/ai-native-article/pull/447) (merged 2026-07-08) shipped the ADR-0019 MEMORY.md layer end to end — the five pilot seed memories (`workforce/seed/memory/{maya,elena,ren,nadia,sora}.md`), the `curate-agent-memory.mjs` curation script, the `workforce-curate-agent-memory.yml` workflow, the fire-time injection (agent-runner.md **Layer 3.5**, verified present), and the `AgentProfile.tsx` surface. By the lifecycle in the epics README, code this complete would sit at `In-progress` or beyond — but the advance is **withheld on purpose**: `Draft → Accepted` requires an **operator design sign-off** (Zone-A-adjacent), which this epic's own header still marks "operator review pending". Advancing the status here would silently encode an acceptance the operator has not made (contrast 019–023, explicitly accepted in-session 07-08). **Action for the operator:** review + Accept (then it is genuinely `In-progress` on #447's evidence), or record the pilot as exploratory. Only on Accept should the pilot→all-personas rollout + "make it a technique" work be filed as Stories (Draft epics carry none). No status flip and no issues filed this pass.

## Outcome, for whom

Every workforce persona fires with a curated semantic memory — a MEMORY.md of
mission anchor, learned principles, people-context, and standing bets — so
lessons stop being re-learned per session and start compounding (MVV value 7:
*output is evidence; feedback is fuel*). For the operator, memory curation
becomes a repeatable, mostly-automated technique, not a hand-written artefact
per agent.

## Why now

The org is 33 personas. Their EXEC ledgers and feed reflections already
contain real learning (friction → improvement arcs, standing bets with
falsifiers), but nothing feeds it back into fires. Five personas
(maya / elena / ren / nadia / sora) have record depth to pilot on, and
ADR-0019 gives the layer a place to live at zero injection cost.

## Stories

1. **Pilot writes** *(in the ADR-0019 implementation PR)* — hand-curated
   MEMORY.md for the five pilot personas, written to the META rows via the
   operator-dispatched workflow; agent-runner layer 3.5 injects them.
2. **Effect evaluation** — after ~2 weeks of fires, judge whether memory
   shows up in behaviour: do feed posts/skips stop re-deriving known
   lessons? do bets get falsifier-checked instead of re-formed? Deliverable:
   a short evidence note (per-persona before/after over the EXEC ledger).
   Kill criterion for the epic: if the five pilots show no behavioural
   difference attributable to the layer, stop before building automation.
3. **`memory-curation` Cadence** — a skill (cadence-forge scaffold) that
   periodically distils an agent's record (EXEC ledger + posts + episodic
   chunks + current MEMORY.md) into a *proposed* MEMORY.md revision. The
   formation model is the human one: personality (persona/identity), work
   history and outputs (ledger), interactions (panels, reviews, org edges),
   in-the-moment lessons (friction/improvement posts) → semantic
   distillation. Output is a diff for review, not a write.
4. **Write authority decision** — how a proposed revision lands: (a)
   operator merges a seed-file PR + dispatches (today's path), or (b) a
   bounded direct write via a scoped capability token (ADR-0009 pattern)
   with the writer script's validators as the mechanical gate. (b) needs a
   §5 authority-matrix amendment (Zone A) — decided by the operator at this
   story, not assumed.
5. **Fleet rollout** — apply the cadence to all personas on a monthly
   cycle, oldest-memory first; W-3 cost accounting for the distillation
   fires.

## Non-goals

- No vector store, no embedding recall (ADR-0002 stands).
- No change to episodic memory (Epic-012 chunks/compactor keep their job).
- No per-agent memory schema divergence (R-N8: one shape for all).

## Mechanical guards

- Writer-script validation: title, `Curated:` token, mandatory
  `## Mission anchor`, non-hollow body, 16 KB S17 ceiling.
- Grounding rule (seed/memory README): memory distils the agent's real
  record; invented content is prohibited — it feeds back into execution.
- Precedence rule (agent-runner §composition): governance/north star >
  memory > improvisation.
