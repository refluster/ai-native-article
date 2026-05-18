---
name: notion-publish
description: Insert a finished article body into the existing Notion article DB with the correct Author/Kind/Status properties so the GAS L4 batch picks it up and publishes to kohuehara.xyz. Use as the terminal step of any editorial pipeline that produces an article-markdown — the side-effect that crosses the workforce↔Notion boundary (W-2).
---

# notion-publish

The deterministic terminal step that hands an article over to the existing GAS L4 publication path.

## Instructions

The runner calls `lambdas/shared/notion.ts:insertArticle()` with:

- `title` — extracted from the first `# {title}` line of the article body.
- `bodyMarkdown` — the article body verbatim.
- `author` — the agent's slug (e.g. `sora`).
- `kind` — the agent's `primary_deliverable_kind` (e.g. `l1-insight`).
- `provenance` — `"{slug}-{task_kind}"` so the cut-over analytics (RFC-005) can distinguish agent-authored rows from legacy GAS-L1 rows.

This skill does **not** produce prose. It is the contract that an `article-markdown` output reaches Notion in a shape the L4 batch understands. Composed into the system prompt only when the agent's deliverable type is `article`.

## Inputs

- `article-markdown` — a Markdown body with a single `# {title}` first line.

## Outputs

- `notion-page-id` — the inserted page's Notion id (also stored on the DELIV row).
- `notion-page-url` — surfaced back to the operator for one-click verification.

## When NOT to use

- The deliverable type is not `article` (use the type-specific terminal step instead — `pr` → engineer-routine dispatch; `plan` / `design-doc` / `launch-plan` → DDB write).
- Notion is rate-limiting; the shared lib already retries with backoff but pre-emptively skipping is acceptable.
