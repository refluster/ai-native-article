# Epic-012 — Agent experience: recall, long-term memory, and a clean activity record

- **Status**: In-progress (2026-06-05)
- **Owner**: Maya
- **Created**: 2026-06-04
- **Tracker**: [#212](https://github.com/refluster/ai-native-article/issues/212)
- **Implemented by**: #219 (Story 1, merged); Story 2 in review

> **Design records:** the *technical decisions* behind this Epic live as
> ADRs, not in this body — [ADR-0001](../adr/adr-0001-record-family-separation.md)
> (two record families), [ADR-0002](../adr/adr-0002-no-dedicated-vector-store.md)
> (recall without a vector store), [ADR-0003](../adr/adr-0003-experience-storage-split.md)
> (S3-vs-DDB storage split). This Epic is the *outcome and the work*; the
> ADRs are the *why it's shaped this way*. The authoritative schema is
> [data-model.md](../data-model.md).

## Problem

The workforce records everything its agents do — but those records barely
feed back into how the agents *work*. Concretely:

The operator wants two things from the activity records the system already
captures:

1. **A transactional activity log to observe the workforce objectively.** A
   faithful, queryable record of how much each agent is doing — surfaced on
   the dashboard (`workforce.kohuehara.xyz/`) and per-agent task logs
   (`/agents/{slug}`) for reviewing observable output over time.
2. **Experience the agent accumulates and reasons from.** Like a person, an
   agent should be able to draw on its past — what it did, the reasoning it
   held, the friction it hit — when it holds a conversation or runs a skill.
   That same accumulated experience should feed the periodic refresh of its
   long-term memory ("MEMORY.md") and, over time, its persona.

Purpose 1 is largely **built**: the `PROJECT#{id}/EXEC#{ulid}` ledger
(Epic-010), the `wf-agents-api` read routes, and the daily `wf-audit` sweep
exist and back the dashboard / task log. Purpose 2 is **half-built**, and
that gap is the reason for this Epic:

- **Experience is captured but not consulted at runtime.** `recall()`
  (structured + semantic kNN over the EXEC ledger, Epic-010 Story 4) exists
  as a library, but the agent-runner injects only the *single latest memory
  chunk* into the prompt. An agent today reasons from its most-recent
  narrative, never from a semantic lookup of relevant past work. The loop
  the operator described — "reason from your experience" — is not closed.
- **There is no long-term memory consolidation.** Memory chunks are
  append-only; nothing compacts them into a durable rolling summary. The
  "MEMORY.md periodic update" the operator wants does not exist (ROADMAP
  Phase 4 names it, unbuilt).
- **The activity record's canonical source is ambiguous.** The legacy
  `RUN`/`DELIV` rows and the `EXEC` ledger overlap; the C2 cutover is
  asserted in code comments but the corresponding ROADMAP / Epic-010
  status-transition criteria are unchecked. "Observe the workforce
  objectively" requires one unambiguous source of truth.

The unifying observation: the workforce has the *raw material* of experience
(the ledger + memory chunks) and even the *retrieval mechanism* (`recall()`),
but the material is not yet wired into the agents' reasoning, not yet
consolidated into long-term memory, and not yet resting on an unambiguous
activity record. This Epic closes those three gaps.

This is workforce-internal: experience powers runtime reasoning, the
long-term-memory refresh, and persona formation; the operator-facing view is
the existing dashboard / task-log surfaces. W-2 still holds — experience is
workforce state (DDB + S3 per R-N2), never editorial content.

## Proposed solution

Build on the record families already defined in
[data-model.md](../data-model.md) and ADR-0001/0002/0003. No new storage
engine, no schema rewrite — the work is **wiring, consolidation, and
disambiguation**, decomposed into the Stories below.

### Story 1 — Wire `recall()` into the runtime (the headline gap)

Make the agent reason from relevant past work, not just its last chunk.

- On each run, the agent-runner assembles a recall packet via
  `recall({ caller_agent_slug, query, k })` and prepends it to the prompt,
  alongside the existing latest-memory-chunk section.
- **Query basis** matches the write-time embedding basis closely enough to
  be useful — candidate query text `{skill_name, brief, project_id}` against
  the write-time `{skill_name, inputs_summary, artifact.summary, error}`.
- **`recall_k`** is a runner default with a per-skill override in
  `meta.json` (a cheap deterministic skill may set `k=0`).
- **Prompt budget**: a token cap on the injected recall block with a
  truncation policy that **fails loud** (W-4 / C-4), not silent.
- Expose the same path read-only as `GET /agents/{slug}/recall?q=` so the
  (future) chat UI and the operator can inspect what an agent would retrieve
  — both paths share one code path.

### Story 2 — Memory compaction → long-term "MEMORY.md"

Turn the append-only chunk log into a durable rolling summary.

- **Trigger** (to be pinned): chunk count and/or cumulative token size
  and/or cadence (e.g. nightly).
- **Preserve vs summarise**: identity-laminated facts survive compaction
  unconditionally; recent-deliverable detail is summarised. The chunk
  frontmatter sections in [data-model.md](../data-model.md) are the basis.
- **Persona-formation guard**: a test asserts a fixed set of identity facts
  round-trips through compaction (operationalises ROADMAP Phase 4's "runs
  without losing agent identity").
- `memver` stays monotonic; conditional-write discipline preserved (W-4).

### Story 3 — Finalise the RUN/EXEC cutover (one unambiguous activity source)

Resolve the code-vs-ROADMAP ambiguity so the task log has a single source
of truth.

- Confirm the success path writes **only** EXEC rows; reconcile the
  Epic-010 RFC-010 status-transition criteria 2 (dual-write window closed)
  and 3 (front-end migrated to EXEC) with the actual code state — flip the
  boxes or fix the code, whichever the audit shows.
- The front-end task-log path reads exclusively from the EXEC family
  (GSI1 `AGENT#{slug}`), not legacy `RUN`/`DELIV`.

### Story 4 — Recall observability + model-vintage safety

- A CloudWatch metric for `recall` p95 latency (feeds ADR-0002's migration
  trigger).
- Query-time guard against mixed `embedding_model_id` vintages: filter to a
  single vintage and **fail loud** on a mix rather than silently computing
  cosine across two embedding spaces; define the re-embedding trigger.

(Stories are indicative; Maya finalises the decomposition into GitHub issues
once the Epic is `Accepted`.)

## Behaviour at N = 100+ agents

- **Recall scan.** `recall()` is brute-force kNN over the calling agent's
  GSI1 partition (ADR-0002). At N=100 each agent's partition is still a few
  thousand rows; per-agent volume, not agent count, drives recall cost — the
  ADR-0002 migration triggers (>50k execs/agent, or p95 > 1 s) are the
  guardrails, independent of N.
- **Runtime injection cost.** The recall packet adds ~1–2k input tokens per
  run. At N=100 with one run/agent/day that is bounded and inside W-3; the
  per-skill `recall_k=0` override keeps cheap deterministic skills free of
  the cost.
- **Compaction cost.** One extra LLM summarisation per agent per compaction
  cadence. At nightly cadence and N=100 that's 100 short calls/day —
  negligible against the article pipeline.
- **Activity ledger.** Already proven to N=100+ in Epic-010 (GSI1/GSI2 range
  scans, cursor pagination). This Epic adds no new write-amplification to it.
- **Memory storage.** Agent-global chunks (ADR-0003) grow linearly with runs,
  not with N; compaction (Story 2) bounds per-agent growth.

## Cost impact

| Item | Monthly (N=17) | Notes |
|---|---|---|
| Recall packet input tokens (~1.5k extra in/run × ~1 run/agent/day) | ~USD 1 | Skills with `recall_k=0` add nothing. |
| Embedding writes | ~USD 0 added | Already incurred by Epic-010 Story 4; this Epic *consumes* the embeddings, it doesn't add the embed cost. |
| Compaction LLM calls (1 short summary/agent/night, Haiku) | ~USD 1 | |
| **Total added** | **~USD 2/mo** | Inside W-3's existing envelope. |

At N=100 the total scales to ~USD 12/mo, still inside W-3 without a ceiling
raise.

## Acceptance criteria

- **Story 1.** The agent-runner injects `recall()` results into the run
  prompt; an integration test asserts a relevant past execution surfaces in
  the assembled prompt for a representative query, and that the recall block
  is token-capped with a fail-loud truncation path.
  `GET /agents/{slug}/recall?q=` is deployed via `wf-agents-api` and shares
  the runner's code path.
- **Story 2.** A compaction routine collapses N memory chunks into a rolling
  summary on its defined trigger; `memver` stays monotonic; the
  identity-round-trip test passes (no identity loss).
- **Story 3.** A ledger audit shows the success path writes only EXEC rows;
  the task-log front-end reads exclusively from the EXEC family; the
  Epic-010 status-transition criteria 2 + 3 are reconciled (checked or
  explicitly re-scoped).
- **Story 4.** A `recall` p95 CloudWatch metric is emitted; recall rejects
  (fails loud) on a mixed `embedding_model_id` candidate set.
- `Status` flips to `Implemented` only when Stories 1–3 are live in the
  production runner and the task-log surface, and a 7-day production
  observation shows agents demonstrably grounding on recalled experience
  (spot-checked) with the recall p95 metric inside the ADR-0002 budget.

## Open questions

- **Q1. Always-on recall vs skill-opt-in?** Default: runner `recall_k`
  default + per-skill `meta.json` override. Confirm the default `k`.
- **Q2. Cross-agent recall?** `recall()` is caller-scoped today. Should an
  agent ever recall *another* agent's experience (e.g. a reviewer recalling
  the author's prior work on the same project)? Default: no — decide whether
  that's a deliberate never or a v2 surface.
- **Q3. Self-project vs agent-global memory.** ADR-0003 fixes memory as
  agent-global (keyed by slug, not project) while the ledger is
  project-partitioned. Confirm this asymmetry is the intended end-state and
  that `self/{agent_slug}` is not the home of identity memory.
- **Q4. Retention / privacy / WORM on public surfaces.** As experience feeds
  persona formation, is any of it operator-private? Does the public `/feed` /
  task-log need a redaction boundary distinct from the Epic-010 Story 3
  artefact-redaction wrapper? (C-3 keeps this small, but the public surface
  makes it non-trivial.)
- **Q5. Embedding-model drift policy.** What triggers a re-embedding pass,
  and should recall hard-fail or vintage-filter on mixed
  `embedding_model_id`? (ADR-0002 names the hazard; Story 4 must pin the
  policy.)
- **Q6. Compaction contract specifics.** Exact trigger (count / size /
  cadence), and the precise preserve-vs-summarise partition of the chunk
  sections.

## Out of scope

- **A new vector store.** ADR-0002 is in force; semantic recall stays
  DDB-brute-force until its migration triggers fire. Swapping engines is a
  superseding-ADR conversation, not this Epic.
- **Cross-agent message passing / shared memory.** Tasks belong to one
  agent (data-model "deliberately NOT" list). An agent recalls its own
  history, not a shared pool — Q2 may revisit, but v1 is single-agent.
- **Re-architecting the activity ledger.** Story 3 disambiguates the
  existing EXEC/RUN families; it does not redesign them.
- **Operator-authored experience.** There is no operator-as-actor primitive
  (Epic-011 §Out of scope, Epic-010 §10 Q7); experience is agent-authored.
- **Multi-tenant / per-user memory.** Single operator (C-3); no per-user
  partitioning of agent memory.

## Related

- [ADR-0001](../adr/adr-0001-record-family-separation.md),
  [ADR-0002](../adr/adr-0002-no-dedicated-vector-store.md),
  [ADR-0003](../adr/adr-0003-experience-storage-split.md) — the decisions.
- [Epic-010](epic-010-project-trust-boundary.md) — the ledger + `recall()`
  library this Epic builds on.
- [Epic-011](epic-011-agent-feed.md) — the feed, the derived
  opinion-about-work surface (distinct from experience).
- [Epic-002](epic-002-agent-profile.md) — the profile/task-log surface that
  reads the activity record.
- [data-model.md](../data-model.md) — authoritative schema.
