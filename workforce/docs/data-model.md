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
| `AGENT#{slug}` | `META` | Agent definition mirror | `slug`, `model`, `schedule_cron`, `prompt_version`, `budget_monthly_usd`, `created_at` |
| `AGENT#{slug}` | `MEMORY#INDEX` | Memory pointer | `memver` (int, monotonic), `latest_chunk_key` (S3 key), `summary_snippet` (≤512 chars), `updated_at`. Conditional writes use `ConditionExpression: memver = :expected` |
| `AGENT#{slug}` | `RUN#{ulid}` | Execution log | `task_id`, `status` ∈ `{ok, throw, dlq, skipped}`, `tokens_in`, `tokens_out`, `cost_usd`, `started_at`, `ended_at`, `error_message?`, `skip_reason?`, `skill_name?`, `skill_version?` |
| `AGENT#{slug}` | `DELIV#{ulid}` | Deliverable metadata | `type` ∈ `{article, pr, plan, design-doc, launch-plan}`, `project_id`, `notion_page_id?`, `pr_url?`, `s3_key?`, `eval_score?`, `published_at?`, `status?` ∈ `{pending, ok, timeout}` (async PR path), `dispatched_at?`, `dispatch_branch?`, `error_message?`, `skill_name?`, `skill_version?` |

#### Task rows

| `pk` | `sk` | Purpose | Key attributes |
|---|---|---|---|
| `TASK#{ulid}` | `META` | Task definition | `agent_slug`, `project_id`, `kind`, `status` ∈ `{pending, claimed, ok, failed}`, `created_at`, `claimed_at?`, `completed_at?`, `gsi1pk=STATUS#{status}`, `gsi1sk=created_at` |
| `TASK#{ulid}` | `LOG#{ulid}` | Per-task progress log | `level` ∈ `{info, warn, error}`, `message`, `timestamp` |

#### Project rows

| `pk` | `sk` | Purpose | Key attributes |
|---|---|---|---|
| `PROJECT#{slug}` | `META` | Project descriptor | `stream` ∈ `{internal, client, editorial}`, `owner_agent`, `status` ∈ `{active, paused, done}`, `notion_db_id?`, `repo?`, `created_at` |
| `PROJECT#{slug}` | `MILESTONE#{n}` | Milestone marker | `owner_agent`, `due_at?`, `deliv_refs[]` (ULIDs of contributing DELIVs), `status` |

#### Budget rows

| `pk` | `sk` | Purpose | Key attributes |
|---|---|---|---|
| `BUDGET#{yyyy-mm}` | `AGENT#{slug}` | Monthly token + cost roll-up | `tokens_in`, `tokens_out`, `cost_usd`, `last_updated_at`. Used by `lambdas/shared/budget.ts` to enforce W-3 before each LLM call |

### GSI1 usage

`GSI1` (pk: `gsi1pk`, sk: `gsi1sk`) supports a single query at v1:

```
pk = "STATUS#pending"  → all pending tasks, sorted by created_at
```

This is how the orchestrator decides whether an agent already has work outstanding (skip new task creation if so).

Other status values write `gsi1pk` so a future operator dashboard can fan out — but v1 only queries `pending`.

### Conditional-write invariants

- `AGENT#{slug}` / `MEMORY#INDEX` is updated with `memver = :expected` so concurrent runs can't lose updates. On conflict the runner re-reads, re-pack, retries. Two failures → throw → DLQ (W-4).
- `TASK#{ulid}` / `META` claim transition (`pending → claimed`) is conditional on `status = pending`. Two runners can't double-claim.
- `BUDGET#{yyyy-mm}` / `AGENT#{slug}` increments use `ADD` updates (atomic). The pre-call guard reads the value and short-circuits if `(tokens_out + projected) > cap`.

## S3 — `wf-bucket-{stage}`

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

Chunks are append-only. Compaction (collapsing N chunks into one summary) is a v2 concern.

## Notion DB extension

The existing article DB on Notion gets two new properties (no schema-breaking changes):

| Property | Type | Values | Purpose |
|---|---|---|---|
| `Author` | select | `anonymous`, `sora`, `maya`, `ren`, `aoi`, `yuki` | Persona attribution; drives the AuthorChip on `kohuehara.xyz` |
| `Kind` | select | `weekly-synthesis`, `hypothesis`, `tech-note`, `design`, `launch`, `legacy` | Sub-categorisation within `Author=<persona>` rows |

Existing rows without `Author` set are treated as `Author=anonymous` (the legacy nameless-narrator). The L4 batch in GAS doesn't filter on these properties — it picks up all `status=ready_for_L4` rows regardless. The Author/Kind properties are read by `scripts/fetch-notion.mjs` and surfaced in the front-end manifest.

The frontmatter on the `final.md` written to S3 includes `notion_page_id` so an article published through this path is traceable both directions:

```
DELIV#{ulid} (DDB) ←→ s3://wf-bucket-…/articles/<slug>/<ulid>/final.md ←→ Notion page id ←→ /posts/<slug>.md on gh-pages
```

If any of these links is broken at audit time (`article-health` skill detects it), `W-1` is at risk.

## What's deliberately NOT in the data model

- **Cross-agent message passing** (Maya hands a task to Ren) — v2. Until then, tasks belong to one agent, period.
- **Vector embeddings / RAG store** — v2 or v3. Sora's first iteration relies on `system.md`-laminated knowledge + the last K memory chunks.
- **User identity / multi-tenant** — there is one operator; C-3 / single-operator scale is inherited from root governance.
- **Audit-immutable storage (WORM)** — S3 versioning + DDB PITR are enough for v1. Tightening is a Zone A amendment.
