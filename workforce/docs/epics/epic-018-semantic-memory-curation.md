# Epic-018 — Semantic memory curation: pilot five personas, then make it a technique

**Status:** In-progress (2026-07-12). **Created:** 2026-07-07. **Owner:** Maya (PM). **Implemented by:** [#447](https://github.com/refluster/ai-native-article/pull/447) (ADR-0019 + agent-runner layer 3.5 fire-time injection), [#483](https://github.com/refluster/ai-native-article/pull/483) (Story 3 `memory-curation` Cadence + ADR-0020 delegated-write route), [#489](https://github.com/refluster/ai-native-article/pull/489) (Story 4 write-authority mechanism — ADR-0021 dynamic memory-write token, supersedes ADR-0020's static secret). **Decision record:** [ADR-0019](../adr/adr-0019-agent-semantic-memory.md), [ADR-0020](../adr/adr-0020-delegated-memory-curation.md), [ADR-0021](../adr/adr-0021-dynamic-memory-write-token.md).

> **Status reconciliation (2026-08-04, Nadia — backlog-reconcile; `mateo` audit lens).** **No flip — Epic-018 stays `In-progress`.** The sole gate (Story 2 — effect evaluation, [#493](https://github.com/refluster/ai-native-article/issues/493)) is **re-characterised, not closed**, and this is the substantive change this pass found. Every prior pass held the gate shut on the same reason — *the ~2-week window has not elapsed* (07-23: "~4 days"; 07-27: "~8 days"; 07-30: "~11 days"). **That reason has now expired: 16 days have accrued since the cadence went live 2026-07-19**, and the cadence is verifiably still firing — live `GET /agents/{slug}` shows every pilot at `Curated: 2026-08-03` with bodies grown from the 07-22 readings to roughly 2.5× their size (nadia 2487→6698, elena 2322→6635, maya 2850→7157, sora 2442→6471, ren 2290→6353 chars). The before/after EXEC-ledger readout and its kill criterion are therefore **producible for the first time, and unproduced** — no effect-evaluation note exists anywhere under `workforce/docs/`, and #493 was last touched 2026-07-26. The gate moves from *blocked on elapsed time* to *owed work*, which is the state a reader of this epic should now see. **Issue diff: 0 closed / 0 rewritten / 0 filed** (#493 already tracks it).
>
> **Status reconciliation (2026-07-23, Nadia — backlog-reconcile).** Daily audit of the plan vs. the shipped default branch (`HEAD` = `d95c772`; standing-core lenses mateo/dario/nadia/aoi, memory/agent-experience specialist lens freya routed in per `routing_rules`). **No status flip — Epic-018 stays `In-progress`** — but two of the three open gates the 07-12 note named have since closed, so the body is trued up. **(1) Story 1 pilot content is now observable.** The 07-12 note's "`memory.body` is empty on the pilot personas" is **superseded**: `GET /agents/nadia` this pass returns a populated `memory.body` (`# MEMORY — Nadia (Product Manager)`, `Curated: 2026-07-07`, `## Mission anchor` present), so the fire-time injection layer is now carrying real curated content, not an empty string. **(2) Stories 3–5 have shipped.** Story 3 (`memory-curation` Cadence — freya) merged as **#483** (`f3fdc16`): the skill (`workforce/skills/memory-curation/` — `pick-cohort.mjs` sizes the daily cohort `max(5, ceil(active/7))`, `update-memory.mjs` distils → `POST /agents/{slug}/memory`), the server-side content guard (`lambdas/shared/memory-contract.ts` + tests), and the agents-api route + SAM wiring are all live; Story 5 (fleet rollout) is subsumed into that cadence's cohort sizing. Story 4 (write authority) is decided and **hardened past its original design** — ADR-0020's static shared secret was superseded by **#489** (`6e2f477`, ADR-0021) with a dynamic, per-fire scoped `memory_write_token` minted by the orchestrator, so the bounded-direct-write path is live end-to-end. **Remaining open gate keeping it below `Implemented`:** **Story 2 (effect evaluation — the epic's kill criterion).** The cadence went live only **2026-07-19**, so ~4 days of fires have accrued against the story's "~2 weeks" window; the before/after behavioural readout that would either confirm the layer or fire the kill criterion (and unwind the cadence) is not yet producible. This is now the sole gate, and it had **no tracking issue** — filed this pass as [#493](https://github.com/refluster/ai-native-article/issues/493). **Issue diff: 0 closed / 0 rewritten / 1 filed** ([#493](https://github.com/refluster/ai-native-article/issues/493), Epic-018 Story 2 effect-evaluation).

> **Status reconciliation (2026-07-22, Nadia — backlog-reconcile).** Both 07-12 open sub-gates are now **closed**, but the epic **stays `In-progress`** — the gate has moved, not lifted. (1) The Story-1 pilot *content* is now observable: `memory.body` is populated on every pilot checked this pass (nadia 2487, elena 2322, maya 2850, sora 2442, ren 2290 chars via `GET /agents/{slug}`), so the hand-curated writes are in effect. (2) **Story 3** (the `memory-curation` Cadence) and **Story 4** (write authority) have shipped: [#483](https://github.com/refluster/ai-native-article/pull/483) built the freya-owned cadence (`workforce/skills/memory-curation/` — `pick-cohort.mjs` sizes the oldest-memory cohort `max(5, ceil(active/7))`, `update-memory.mjs` does the bounded write) under [ADR-0020](../adr/adr-0020-delegated-memory-curation.md); [#489](https://github.com/refluster/ai-native-article/pull/489) then replaced ADR-0020's static secret with a dynamic scoped `workforce.memory_write_token` ([ADR-0021](../adr/adr-0021-dynamic-memory-write-token.md)). **The single remaining gate is Story 2 (effect evaluation):** the ~2-week before/after EXEC-ledger readout — do posts/skips stop re-deriving known lessons? do bets get falsifier-checked rather than re-formed? — and its kill criterion have not been produced. Until that readout exists the "does injected memory change behaviour?" falsifier is unresolved, so no flip to `Implemented`. Forward, monotonic-legal doc true-up (no status change); surfaced for operator sign-off via the carrying PR. Issue diff: 0 (Epic-018 still has no tracking issue).

> **Status reconciliation (2026-07-12, Nadia — backlog-reconcile).** Flipped `Draft (operator review pending)` → `In-progress`. Evidence: ADR-0019's own ratification rule is "operator ratifies by merging the implementation PR," and **#447 (`e91fbdd`) has merged** — so the design is no longer review-pending, and its **fire-time injection layer is live** (agent-runner.md composition contract §3.5 reads `.memory.body` from the same `GET /agents/{slug}` on every fire, unconditionally). This is a forward, monotonic-legal flip that encodes the operator's acceptance — surfaced here for operator sign-off via the merging PR, not applied to the tracker. **Open gate keeping it below `Implemented`:** the Story-1 *pilot content* is not observable on the live records — `memory.body` is **empty** on the pilot personas checked this pass (nadia, elena) as read from `GET /agents/{slug}`, so the injection mechanism shipped but the five hand-curated MEMORY.md writes are not yet in effect; Stories 2–4 (effect evaluation, the `memory-curation` Cadence, the write-authority decision) are unbuilt. Issue diff: 0 (no Epic-018 tracking issue is now closeable). *(Superseded 2026-07-23: pilot content now observable, Stories 3–5 shipped — see the note above.)*

> **Status reconciliation (2026-07-11, Nadia — backlog-reconcile). ⚠ FLAG: operator sign-off required — this jump skips the `Accepted` checkpoint.** PR #447 (operator-merged) shipped **Story 1**: ADR-0019's MEMORY.md layer, the fire-time layer-3.5 injection in the agent-runner composition, the `curate-agent-memory.mjs` writer + `.github/workflows/workforce-curate-agent-memory.yml`, and the 5 pilot files (maya/elena/ren/nadia/sora). ADR-0019's own status line defines *"operator ratifies by merging the implementation PR"* — that merge happened — so the design is ratified and Story 1 is live. This advances the epic **Draft → In-progress** (a monotonic forward jump reflecting a merged implementation PR), but it **skips the explicit `Accepted` operator-signoff state**: the ADR merge is being read as the acceptance. The operator should confirm that reading by merging this reconciliation PR (or correct it). ADR-0019 is flipped `Proposed → Accepted` in the same bundle. **Not yet Implemented** — these remain open: Story 2 (2-week effect-eval note), Story 3 (the `memory-curation` *distillation* Cadence — **not built**; `curate-agent-memory.mjs` is Story 1's *writer* of operator-curated files, not Story 3's *distiller* of a proposed diff), Story 4 (write-authority decision — ADR-0019 §5 defers it to this Story), Story 5 (fleet rollout — only 5 pilots today). Story issues 2–5 become fileable once acceptance is confirmed.

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
   *(The operator's 2026-07-19 direction reordered build-vs-evaluate — the
   cadence ships first — but does not retire this falsifier: a null Story-2
   readout still fires the kill criterion and unwinds the cadence too —
   unbind + pause the memory-curation binding, not just the pilot.)*
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

   **Carve-out (2026-08-12, `ren` — issue #577): the weekly floor assumes
   the agent has *some* record to distil.** A newly-hired agent with no
   bindings yet has zero EXEC rows and zero posts, so `memory-curation`'s
   own skip rule (`SKILL.md` §2, "If the agent has no EXEC rows or posts
   newer than `memory.last_updated` ... leave their memory untouched and
   record the skip") correctly leaves `memory.body` empty every fire until
   the agent's first activity lands — this is by design, not a violation of
   the floor. `pick-cohort.mjs`'s "never-curated sorts first" rule is
   working as documented (verified live: `clara`, hired 2026-08-06 with
   `bindings: []`, sorts position 1 of every cohort — confirmed against
   `GET /agents/clara/executions` and `/posts`, both empty), so the floor's
   *reach* still holds; only its *content* is gated on the agent having
   fired at least once. No code change — the selection and skip mechanisms
   both work correctly for this case; the epic text just didn't say so.

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
