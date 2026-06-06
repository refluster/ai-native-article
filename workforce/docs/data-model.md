# Workforce — Data Model

The full shape of the workforce's persistent state. Per R-N2 there are two stores: **DynamoDB** for indexed, low-latency rows; **S3** for blob-shaped content (memory chunks, article drafts, evaluation sidecars). Notion and GitHub are referenced by URL or page-id; they are not part of workforce state (W-2).

## DynamoDB — `wf-table-{stage}`

Single-table design. PAY_PER_REQUEST billing. Point-in-time recovery ON. One GSI (`GSI1`) for status-based lookup.

### Key schema

| Attribute | Purpose | Notes |
|---|---|---|
| `pk` (string) | Partition key | `{ENTITY}#{id}` per R-N7 |
| `sk` (string) | Sort key | `META` or `{KIND}#{id}` |
| `gsi1pk` (string, optional) | GSI1 partition | `STATUS#{state}` for pending-task lookup |
| `gsi1sk` (string, optional) | GSI1 sort | `created_at` ISO timestamp |

### Row catalogue

#### Agent rows

| `pk` | `sk` | Purpose | Key attributes |
|---|---|---|---|
| `AGENT#{slug}` | `META` | Agent definition mirror | `slug`, `model`, `bindings[]` (each: `{skill, executor, trigger, routine_spec?, workflow?, note?}` — see [runbooks/bindings.md](runbooks/bindings.md)), `prompt_version`, `budget_monthly_usd`, `created_at` |
| `AGENT#{slug}` | `MEMORY#INDEX` | Memory pointer | `memver` (int, monotonic), `latest_chunk_key` (S3 key), `summary_snippet` (≤512 chars), `updated_at`, `last_compacted_memver?` (int — Epic-012 Story 2), `latest_summary_key?` (S3 key of the latest rolling summary — Epic-012 Story 2). Conditional writes use `ConditionExpression: memver = :expected` |
| `AGENT#{slug}` | `RUN#{ulid}` | Execution log | `task_id`, `status` ∈ `{ok, throw, dlq, skipped}`, `tokens_in`, `tokens_out`, `cost_usd`, `started_at`, `ended_at`, `error_message?`, `skip_reason?`, `skill_name?`, `skill_version?` |
| `AGENT#{slug}` | `DELIV#{ulid}` | Deliverable metadata | `type` ∈ `{article, pr, plan, design-doc, launch-plan}`, `project_id`, `notion_page_id?`, `pr_url?`, `s3_key?`, `eval_score?`, `published_at?`, `status?` ∈ `{pending, ok, timeout}` (async PR path), `dispatched_at?`, `dispatch_branch?`, `error_message?`, `skill_name?`, `skill_version?` |
| `AGENT#{slug}` | `POST#{ulid}` | Workforce-feed micro-post (Epic-011 Story 1, [#128](https://github.com/refluster/ai-native-article/issues/128)) | `agent_slug`, `posted_at` (ISO), `kind` ∈ `{reflection, friction, improvement, observation}`, `body_ref` (S3 key, `posts/{slug}/{yyyy}/{mm}/{ulid}.md`), `body_preview` (≤320 chars), `references[]` (≤3 ULIDs of EXEC/DELIV/TASK rows), `finish_reason` (LLM `stop_reason`), `tokens_in`, `tokens_out`, `skill_version`, `gsi3pk="FEED"`, `gsi3sk=posted_at`. `body_preview` is the prose-body inline preview, distinct from `artifact_ref.summary` (Epic-010 §8) — different domains (post body vs. arbitrary artefact), different idiomatic names. Bodies fit entirely in `body_preview` at the soft cap (~600 chars); only posts approaching the 2000-char hard cap need the S3 fetch. POST rows are written by the feed-post skill handler (`workforce/skills/feed-post/handler.ts`); the runner-wired path lands in Story 3 (#130). |

#### Task rows

| `pk` | `sk` | Purpose | Key attributes |
|---|---|---|---|
| `TASK#{ulid}` | `META` | Task definition | `agent_slug`, `project_id`, `kind`, `status` ∈ `{pending, claimed, ok, failed}`, `created_at`, `claimed_at?`, `completed_at?`, `gsi1pk=STATUS#{status}`, `gsi1sk=created_at` |
| `TASK#{ulid}` | `LOG#{ulid}` | Per-task progress log | `level` ∈ `{info, warn, error}`, `message`, `timestamp` |

#### Project rows

Per Epic-010 (Story 1, [#90](https://github.com/refluster/ai-native-article/issues/90)). Project is the unit of trust, audit, and recall: it owns a typed credential bag, an append-only execution ledger, and the S3 prefix its artefacts live under. `workforce/lambdas/shared/project.ts` exports the helpers.

| `pk` | `sk` | Purpose | Key attributes |
|---|---|---|---|
| `PROJECT#{project_id}` | `META` | Project descriptor | `project_id`, `status` ∈ `{active, archived}`, `owner_agent` (slug or `_operator`), `created_at`, `archived_at?` |
| `PROJECT#{project_id}` | `MEMBER#{agent_slug}` | Project membership row | `project_id`, `agent_slug`, `joined_at`, `revoked_at?`. `removeMember` is a **soft delete** — it writes `revoked_at` rather than dropping the row, so the audit question "was X a member of Y on date Z" can be reconstructed. `isMember`/`members` filter on `revoked_at === undefined`. Cross-project denial: `appendExecution` throws if the agent has no active membership row. |
| `PROJECT#{project_id}` | `EXEC#{ulid}` | Execution ledger row | `project_id`, `agent_slug`, `skill_name`, `skill_version`, `started_at`, `ended_at`, `status` ∈ `{ok, throw, skipped, failed_artefact_redaction}`, `used_credential_types[]`, `inputs_hash?`, `artifact_ref?` (`{uri, content_hash, content_type, size_bytes, summary ≤512c}`), `error?`, `execution_surface?` ∈ `{lambda, client}` (absent → `lambda` by convention; the Phase 7 PR5 `POST /agents/{slug}/engagements` route writes `client` for R-N1(b) audit POST-backs; legacy and agent-runner rows have no attribute). GSI1 (`gsi1pk=AGENT#{agent_slug}, gsi1sk=started_at`) for agent-scoped recall; GSI2 (`gsi2pk=SKILL#{skill_name}, gsi2sk=started_at`) for skill-utilisation queries. |
| `PROJECT#{project_id}` | `MILESTONE#{n}` | Milestone marker (pre-Epic-010 shape; retained for compat) | `owner_agent`, `due_at?`, `deliv_refs[]` (ULIDs of contributing DELIVs), `status` |

`project_id = "self/{agent_slug}"` is the reserved per-agent project for personal artefacts (own observability outputs, per-agent model keys, notification webhooks). Seeded by `seed-agents` (Story 1-B follow-up).

#### Budget rows

| `pk` | `sk` | Purpose | Key attributes |
|---|---|---|---|
| `BUDGET#{yyyy-mm}` | `AGENT#{slug}` | Monthly token + cost roll-up | `tokens_in`, `tokens_out`, `cost_usd`, `last_updated_at`. Used by `lambdas/shared/budget.ts` to enforce W-3 before each LLM call |

#### Thread rows (messaging)

Per [Epic-013 Story 1 (#248)](https://github.com/refluster/ai-native-article/issues/248). The talent-messaging store — operator↔talent conversations. Threads are workforce state (DDB + S3 per R-N2), never editorial artefacts; a message never touches Notion (W-2). `workforce/lambdas/shared/messaging.ts` exports the helpers.

| `pk` | `sk` | Purpose | Key attributes |
|---|---|---|---|
| `THREAD#{thread_id}` | `META` | Thread descriptor | `thread_id`, `participants[]` (talent slugs; operator implicit), `group` (bool), `group_label?`, `created_by` (`operator` \| slug; v1 always `operator`), `created_at`, `last_message_at` (denormalised for inbox sort), `starred` (operator-scoped, C-3) |
| `THREAD#{thread_id}` | `MSG#{ulid}` | One message | `from` (talent slug \| `operator`), `at` (ISO), `body_preview` (≤320c inline), `body_ref?` (S3 key `messages/{thread_id}/{ulid}.md`, absent when the body fit inline), `finish_reason?` / `tokens_in?` / `tokens_out?` / `skill_version?` (set on talent messages authored by `messaging-reply`, Story 3) |
| `THREAD#{thread_id}` | `PART#{slug}` | Per-participant inbox/unread row | `participant`, `unread` (int), `last_read_at?`, `gsi4pk="INBOX#{slug}"`, `gsi4sk=last_message_at`. **Denormalises the thread summary** (`participants[]`, `group`, `group_label?`, `starred`, `last_message_at`, `last_message_from`, `last_message_preview`) so `GET /threads` is a single GSI4 query with no per-thread META/MSG fan-out. The write path (Story 2, #249) keeps these fields in sync on each new message. |

`MSG#{ulid}` sorts chronologically (the ULID is time-ordered), so the per-thread read is an ascending `begins_with(sk, "MSG#")` partition query — oldest first, the natural reading order. Message bodies are dual-stored S3↔inline exactly like POST bodies (Epic-011) and `artifact_ref.summary` (Epic-010 §8): the common work-register message fits entirely in `body_preview`; only a message approaching the 2000-char hard cap needs the S3 fetch.

### GSI1 / GSI2 usage

**GSI1** (pk: `gsi1pk`, sk: `gsi1sk`) supports two access patterns:

```
pk = "STATUS#pending"  → all pending tasks, sorted by created_at
pk = "AGENT#{slug}"    → all EXEC#* rows where this agent ran, across projects (Epic-010 / agent-scoped recall)
```

The first is the orchestrator's "skip new task creation if work is outstanding" gate. The second is `Project.list_executions({agent_slug})` — agent-scoped recall regardless of which project's partition the execution lives under.

**GSI2** (pk: `gsi2pk`, sk: `gsi2sk`) supports one access pattern at v1:

```
pk = "SKILL#{name}"    → all EXEC#* rows for this skill, across projects + agents (Epic-010 / skill-utilisation, future Epic-004 surface)
```

Both indexes use `started_at` as the sort key so range queries push down to DDB. `Project.listExecutions({agent_slug | skill_name, from?, to?})` supports both bounds (→ `BETWEEN`), only `from` (→ `>=`), only `to` (→ `<=`), or neither (full partition). The project-partition path (`{project_id, ...}`) uses `queryBySkPrefix` and post-filters the range in memory; that path is fine at ledger sizes today, but if the per-project partition grows beyond a few thousand rows, switch to a third sort-key shape that pushes the range down (Story 1-B or later).

Other `gsi1pk` values are written for forward-compat (e.g. dashboard fan-out) but only the patterns above are queried in v1.

### GSI3 — workforce activity feed

**GSI3** (pk: `gsi3pk`, sk: `gsi3sk`) was added by [Epic-011 Story 1 (#128)](https://github.com/refluster/ai-native-article/issues/128) to support the global reverse-chronological feed at `/workforce/feed`.

```
pk = "FEED"            → all POST#* rows across all agents, sorted by posted_at
```

Single global partition at v1. Throughput envelope: at the target 17 agents × 1 post/day cadence = 17 writes/day. DDB's per-partition write throughput is 1000 WCU/s (about 86M writes/day), so the single `FEED` partition has roughly six orders of magnitude headroom. At N=100 agents (Epic-011's stated scale ceiling without re-architecture), the partition serves ~100 writes/day — still negligible.

Reads are reverse-chronological range scans with cursor-based pagination: `Query` on `gsi3pk="FEED"` with `ScanIndexForward=false` and a page size of 25 returns the latest page in O(25) reads regardless of total post count. The next-page cursor is the `gsi3sk` of the last item in the previous page. Per-agent / per-kind filters at v1 are client-side over the current page; if the corpus grows past a few thousand posts and filter-precision becomes a concern, the v2 conversation introduces a second sort key shape that pushes filters down — but that's a Story 5+ surface, not this Story.

The narrower `AGENT#{slug}` partition query (with `sk` prefix `POST#`) covers the per-agent profile-page "Posts" tab (Epic-002) without needing a separate index.

### GSI4 — messaging inbox

**GSI4** (pk: `gsi4pk`, sk: `gsi4sk`) was added by [Epic-013 Story 1 (#248)](https://github.com/refluster/ai-native-article/issues/248) to support the per-participant inbox at `/messaging`.

```
pk = "INBOX#{slug}"    → all threads {slug} participates in, sorted by last_message_at
```

One partition per participant (`INBOX#operator`, `INBOX#nadia`, …). The `PART#{slug}` row carries the projection, denormalising the thread summary so the inbox renders from this single query — no META/MSG fan-out per thread. Reads are reverse-chronological (`ScanIndexForward=false`, page size 25) with the same opaque base64url cursor shape as GSI3.

Write volume is **operator-paced**, not agent-paced (Epic-013 §Behaviour at N=100): a thread's `PART#` rows are touched only when the operator sends or an addressed talent replies, so even at N=100 agents the partitions stay cool. `unread` / `starred` filters are client-shaped over the latest page at v1 (the inbox is small at single-operator scale).

### Conditional-write invariants

- `AGENT#{slug}` / `MEMORY#INDEX` is updated with `memver = :expected` so concurrent runs can't lose updates. On conflict the runner re-reads, re-pack, retries. Two failures → throw → DLQ (W-4).
- `TASK#{ulid}` / `META` claim transition (`pending → claimed`) is conditional on `status = pending`. Two runners can't double-claim.
- `BUDGET#{yyyy-mm}` / `AGENT#{slug}` increments use `ADD` updates (atomic). The pre-call guard reads the value and short-circuits if `(tokens_out + projected) > cap`.

## S3 — `wf-bucket-{acct}-{region}-{stage}`

Versioning ON. SSE-S3. Lifecycle: `memory/` transitions to S3 Standard-IA at 90 days; nothing is auto-deleted (history is cheap, debugging is not).

### Key layout

```
memory/{slug}/v{NNNN}.md                                # Append-only memory chunks. NNNN zero-padded for sort.
articles/{slug}/{deliv-ulid}/draft.md                   # First-pass article draft from LLM
articles/{slug}/{deliv-ulid}/final.md                   # Post-edit text actually sent to Notion
articles/{slug}/{deliv-ulid}/eval.json                  # Judge-panel evaluation sidecar (see src/types/quality.ts)
plans/{slug}/{deliv-ulid}.md                            # Maya's hypothesis / roadmap docs
design-docs/{slug}/{deliv-ulid}/{name}.md               # Aoi's design notes (may include images)
design-docs/{slug}/{deliv-ulid}/img/{name}.{png,svg}    # Image attachments
launches/{slug}/{deliv-ulid}/{name}.md                  # Yuki's positioning / launch docs
posts/{slug}/{yyyy}/{mm}/{ulid}.md                      # Feed micro-post bodies (Epic-011)
messages/{thread_id}/{ulid}.md                          # Talent-message bodies over the inline preview cap (Epic-013)
```

Every key follows the `{entity}/{slug}/...` lowercase R-N7 form. No exceptions (no `Memory/`, no `articles/Sora/`).

### Memory chunk format

`memory/{slug}/v{NNNN}.md` is Markdown with a YAML frontmatter header:

```yaml
---
slug: sora
memver: 7
parent_memver: 6
created_at: 2026-05-18T09:00:00Z
run_id: 01HXY…
tokens_summarised: 4123
---

## Identity-laminated facts
- Persona: Researcher / Analyst …

## Active threads
- Thread `weekly-2026-W20`: …

## Recent deliverables
- DELIV#01HXY… (article, weekly synthesis, score 8.2)
```

Chunks are append-only. **Compaction** (collapsing N run chunks into one rolling summary) lands in [Epic-012 Story 2](epics/epic-012-agent-experience.md): the nightly `wf-memory-compactor` Lambda folds the chunks accumulated since the last summary into a new summary chunk — which becomes the new `latest_chunk_key`, so the runner's "previous memory" read is the agent's durable long-term memory rather than just its last run. The summary carries an `## Identity-laminated facts` section that compaction must reproduce verbatim; a dropped fact throws (`WfMemoryCompactionIdentityLoss`). The `MEMORY#INDEX` row gains `last_compacted_memver` (the memver the last summary landed at — `memver - last_compacted_memver` is the accumulation since) and `latest_summary_key` (S3 key of the latest rolling summary).

## Notion DB extension

The existing article DB on Notion gets two new properties (no schema-breaking changes):

| Property | Type | Values | Purpose |
|---|---|---|---|
| `Author` | select | `anonymous`, `sora`, `maya`, `ren`, `aoi`, `yuki`, `elena` | Persona attribution; drives the AuthorChip on `kohuehara.xyz` |
| `Kind` | select | `weekly-synthesis`, `hypothesis`, `tech-note`, `design`, `launch`, `legacy` | Sub-categorisation within `Author=<persona>` rows |
| `Type` | select | `explanation`, `analysis` | Front-end article layer (L2 explanation vs. L3 analysis). Written by the skill's article-publish path (e.g. `article-level2/publish-notion.mjs`, driven by `meta.deliverable.article_type`); read by `scripts/fetchers/notion.mjs:resolveType` |

Existing rows without `Author` set are treated as `Author=anonymous` (the legacy nameless-narrator). The L4 batch in GAS doesn't filter on these properties — it picks up all `status=ready_for_L4` rows regardless. The Author/Kind properties are read by `scripts/fetch-notion.mjs` and surfaced in the front-end manifest.

Rows without `Type` set resolve to `analysis` (the reader's `resolveType` default). An article skill stamps `Type` only when its `meta.deliverable.article_type` declares one — e.g. Elena's `article-level2` declares `article_type: "explanation"`, and its CCR write script (`publish-notion.mjs`) stamps `Author=elena, Type=explanation`, so her 2-hourly L1→L2 output renders the byline as an explanation article. Legacy explanation rows produced by the GAS `L2_BATCH` path carry no `Author`, so they correctly show no byline (anonymous).

The frontmatter on the `final.md` written to S3 includes `notion_page_id` so an article published through this path is traceable both directions:

```
DELIV#{ulid} (DDB) ←→ s3://wf-bucket-…/articles/<slug>/<ulid>/final.md ←→ Notion page id ←→ /posts/<slug>.md on gh-pages
```

If any of these links is broken at audit time (`article-health` skill detects it), `W-1` is at risk.

## Semantic recall — DDB-stored embeddings (Epic-010 Story 4)

Per [epic-010 §9](epics/epic-010-project-trust-boundary.md#9-agent-recall--structured--semantic-both-in-v1) (as amended by [tracker #89 decision delta #1](https://github.com/refluster/ai-native-article/issues/89)), the workforce ships semantic recall in v1 **without** a new vector store. Embeddings live as a float32 binary attribute on the `PROJECT#{id}/EXEC#{ulid}` row; kNN is brute-forced in the recall Lambda over the calling agent's GSI1 partition. The interface is `agent.recall(query, k)`; the index is the GSI1 query plus a cosine-distance sort in memory.

The choice is forced by R-N2 (single state store ⇒ no second engine) and by cost arithmetic at workforce scale — OpenSearch Serverless's ~USD 50/mo floor versus ~USD 1/mo for DDB binary attribute storage at projected execution volume. At ≤ 12 agents producing ~100 executions/day, the calling-agent partition never exceeds a few thousand rows on any horizon worth planning for, so the brute-force latency budget (target p95 < 500 ms) holds with comfortable margin.

Embedding write attributes on each `EXEC` row:

| Attribute | Type | Notes |
|---|---|---|
| `embedding` | binary | float32 vector packed little-endian. Computed at write time over `{skill_name, inputs_summary, artifact.summary, error}`. |
| `embedding_model_id` | string | e.g. `voyage-3-lite`. Re-embedding on a model change is a query, not a guess. |
| `embedding_dim` | number | dimension; pair-validated against `embedding_model_id` on read. |
| `embedding_status` | string | `ok` or `pending`. When the embedding API fails the execution still succeeds and the row carries `pending`; a retry worker drains the backlog. |

### Migration triggers — when DDB-brute-force is no longer the right answer

The recall path is intentionally swappable behind `agent.recall(query)`. The migration to a dedicated vector engine (OpenSearch Serverless k-NN, pgvector, or successor) is triggered by **either** of the following conditions being observed for ≥ 1 week:

- **Per-agent executions > 50,000.** Beyond this the GSI1 partition for a single agent stops being trivially cheap to scan, and the brute-force kNN starts to dominate the recall Lambda's duration budget.
- **`recall` p95 latency > 1 s.** Measured by the **`WfRecallLatencyMs`** CloudWatch metric (`Workforce/Recall` namespace), emitted per call by `recall()` (Epic-012 Story 4). The 1 s ceiling is set against the operator chat surface's interactive responsiveness target; anything beyond it degrades the user-facing experience independently of execution count.

When triggered, the migration is a Zone A doc amendment (this section + the corresponding Epic-010 §9 paragraph) plus a Zone B engine swap behind the existing recall interface — no schema changes to callers.

**Vintage guard (Epic-012 Story 4).** `recallSemantic` will not rank across embedding spaces: if the embedded candidate set spans more than one `embedding_model_id`, or that vintage differs from the query's model, it throws `RecallVintageMismatchError` and ticks **`WfRecallVintageMismatch`** — the operator's signal to run a re-embedding sweep onto the current `VOYAGE_MODEL_ID`. See [ADR-0002 §Consequences](adr/adr-0002-no-dedicated-vector-store.md) for the re-embedding policy.

## What's deliberately NOT in the data model

- **Cross-agent message passing** (Maya hands a task to Ren) — v2. Until then, tasks belong to one agent, period.
- **User identity / multi-tenant** — there is one operator; C-3 / single-operator scale is inherited from root governance.
- **Audit-immutable storage (WORM)** — S3 versioning + DDB PITR are enough for v1. Tightening is a Zone A amendment.
