# Shared Lambda modules

Filled in across PR2 → PR6. Listed here so it's clear what belongs in this folder vs. a per-handler folder.

| File | Lands in | Purpose |
|---|---|---|
| `ddb.ts` | PR2 | Typed DynamoDB client. Read/write helpers for `WorkforceCore`, `Chat`, `Memory`. |
| `s3.ts` | PR2 | S3 client for `agents/`, `skills/`, `deliverables/`, `memory/` prefixes. |
| `memory-store.ts` | PR2 | Managed-Agents-shape memory filesystem. `read(agent, path)`, `write(agent, path, content)` with `memver` optimistic concurrency. Append-and-replace semantics, never append-only. |
| `skill-loader.ts` | PR2 | Load a SKILL.md (frontmatter + body) from S3, parsing openclaw shape. |
| `secrets.ts` | PR4 | Secrets Manager loader, cached at warm-start. |
| `llm-router.ts` | PR4 | `routeChat({ model, system, messages })` dispatches to Azure OpenAI or Anthropic based on `model:` prefix. |
| `budget.ts` | PR6 | Per-agent daily token budget enforcement. Mirrors [docs/azure-budget-rules.md](../../../docs/azure-budget-rules.md). |
