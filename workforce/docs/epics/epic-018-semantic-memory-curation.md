# Epic-018 — Semantic memory curation: pilot five personas, then make it a technique

**Status:** In-progress (2026-07-12). **Created:** 2026-07-07. **Owner:** Maya (PM). **Implemented by:** [#447](https://github.com/refluster/ai-native-article/pull/447) (ADR-0019 + agent-runner layer 3.5 fire-time injection). **Decision record:** [ADR-0019](../adr/adr-0019-agent-semantic-memory.md).

> **Status reconciliation (2026-07-12, Nadia — backlog-reconcile).** Flipped `Draft (operator review pending)` → `In-progress`. Evidence: ADR-0019's own ratification rule is "operator ratifies by merging the implementation PR," and **#447 (`e91fbdd`) has merged** — so the design is no longer review-pending, and its **fire-time injection layer is live** (agent-runner.md composition contract §3.5 reads `.memory.body` from the same `GET /agents/{slug}` on every fire, unconditionally). This is a forward, monotonic-legal flip that encodes the operator's acceptance — surfaced here for operator sign-off via the merging PR, not applied to the tracker. **Open gate keeping it below `Implemented`:** the Story-1 *pilot content* is not observable on the live records — `memory.body` is **empty** on the pilot personas checked this pass (nadia, elena) as read from `GET /agents/{slug}`, so the injection mechanism shipped but the five hand-curated MEMORY.md writes are not yet in effect; Stories 2–4 (effect evaluation, the `memory-curation` Cadence, the write-authority decision) are unbuilt. Issue diff: 0 (no Epic-018 tracking issue is now closeable).

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
3. **`memory-curation` Cadence** — *(built 2026-07-19, [ADR-0020](../adr/adr-0020-delegated-memory-curation.md) implementation PR)* a skill that
   periodically distils an agent's record (EXEC ledger + posts + current
   MEMORY.md) into a revised MEMORY.md. The formation model is the human
   one: personality (persona/identity), work history and outputs (ledger),
   interactions (panels, reviews, org edges), in-the-moment lessons
   (friction/improvement posts) → semantic distillation. Curator persona:
   **freya** (Agent Experience Designer — the fire-time composition and
   recall packet are her JD; improvement agent sana). Sources are the
   agent's **full cross-project record**, not the binding's project. Story 4's
   decision upgraded the output from "a diff for review" to a bounded direct
   write.
4. **Write authority decision** — *(decided by the operator 2026-07-19,
   recorded as [ADR-0020](../adr/adr-0020-delegated-memory-curation.md))*:
   option (b) — a bounded direct write via the scoped
   `workforce.memory_write_token` to `POST /agents/{slug}/memory`, with the
   ADR-0019 content contract + a shrink guard enforced server-side and an
   `AUDIT#` row per write. The §5 authority-matrix row lands in the same PR
   (Zone A: proposed, operator ratifies by merging). The pilot's
   operator-dispatch workflow survives as the manual override path.
5. **Fleet rollout** — *(subsumed into Story 3's cadence design)* the daily
   fire curates the oldest-memory cohort sized `max(5, ceil(active/7))`
   (`pick-cohort.mjs` reads the live roster), so **every active agent is
   re-curated at least weekly** — the operator's stated frequency floor —
   and coverage scales with headcount with no per-agent wiring. W-3: one
   daily CCR fire, cost class `medium`, inside the USD 500/mo cap.

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
