# Workforce — Naming Convention (R-N7)

A single naming convention applied to every workforce resource, file, identifier, and key. Defined here, enforced in CI by `workforce/scripts/validate-naming.mjs`.

The point of R-N7 isn't aesthetics — it's that a single naming convention makes the system **navigable without a map**. If a reviewer sees `wf-sora-weekly-prod`, they should be able to predict from the name alone that it's an EventBridge rule for the Sora persona running on a weekly cadence in the prod stage. Likewise for `AGENT#sora` (DDB PK), `memory/sora/v0007.md` (S3 key), `wf-agent-runner-prod` (Lambda function name).

## The convention

| Layer | Pattern | Examples |
|---|---|---|
| AWS deployed-resource name | `wf-{role-or-purpose}` | `wf-table`, `wf-bucket`, `wf-alarm-topic` |
| Stage suffix on deployed-resource names | append `-{stage}` (`dev` / `prod`) | `wf-orchestrator-prod`, `wf-table-dev` |
| Agent slug | lowercase ASCII, single token, `^[a-z]+$` | `sora`, `maya`, `ren`, `aoi`, `yuki` |
| DDB partition key | `{ENTITY}#{id}` — entity uppercase | `AGENT#sora`, `TASK#01HXYZ1234567890ABCDEFGHJK`, `PROJECT#workforce-self` |
| DDB sort key (singleton) | `META` | `AGENT#sora` / `META` |
| DDB sort key (collection) | `{KIND}#{id}` — kind uppercase | `AGENT#sora` / `RUN#01HXY…`, `TASK#…` / `LOG#01HXZ…` |
| Identifier (collection items) | ULID — Crockford base32, time-sortable | `01HXYZ1234567890ABCDEFGHJK` |
| Identifier (enumerated entities) | the agent's slug, or a kebab-case project slug | `sora`, `workforce-self`, `editorial` |
| Timestamp | ISO 8601 UTC with `Z` suffix | `2026-05-18T09:00:00Z` |
| S3 key prefix | `{entity}/{slug}/...` — all lowercase, slashes only | `memory/sora/v0001.md`, `articles/sora/01HXY…/draft.md` |
| Lambda function name (deployed) | `wf-{role}-{stage}` | `wf-agent-runner-prod`, `wf-orchestrator-dev` |
| Lambda CFN Logical ID | `PascalCase` (CloudFormation requirement) — workforce names start with `Wf` for grep-ability | `WfAgentRunnerFunction`, `WfOrchestratorFunction` |
| EventBridge rule name | `wf-{agent}-{cadence}-{stage}` | `wf-sora-weekly-prod`, `wf-engineer-poll-prod` |
| EventBridge rule CFN Logical ID | `PascalCase` — `Wf{Agent}{Cadence}Rule` | `WfSoraWeeklyRule`, `WfEngineerPollRule` |
| Secrets Manager secret name | `wf/{provider}` — slash separator, lowercase | `wf/anthropic`, `wf/azure-openai`, `wf/notion`, `wf/github` |
| Lambda TS source file | `kebab-case.ts` | `agent-runner.ts`, `llm-anthropic.ts`, `notion.ts` |
| Frontend React component file | `PascalCase.tsx` | `AuthorChip.tsx`, `AgentDirectory.tsx` |
| Type / interface / class | `PascalCase` | `AgentMeta`, `TaskRow`, `DelivRow` |
| Variable / function | `camelCase` | `loadAgentMeta()`, `pendingTaskCount` |
| Directory under `workforce/` | `kebab-case` (no underscores, no caps) | `agent-runner/`, `shared/`, `runbooks/` |
| Commit message prefix | one of `feat:` / `fix:` / `chore:` / `governance:` / `content:` (per AGENTS.md §2 R-1) with optional scope `(workforce)` and layer tag `(workforce/L2)` | `feat(workforce): add agent-runner skeleton`, `governance(workforce/L0): tighten W-3 cap` |

## Why these specific choices

- **`wf-` prefix** on AWS resources keeps workforce resources visually distinct from the article-pipeline resources (which use no prefix) — a `aws lambda list-functions` line tells you which subsystem owns it.
- **ULIDs** over UUIDs because tasks, runs, and deliverables are naturally time-ordered and DDB queries on PK + SK-prefix scan work better with sort-friendly ids.
- **Uppercase entity names** in DDB keys make composite keys self-documenting. `AGENT#sora` reads unambiguously even out of context; `agent#sora` doesn't.
- **PascalCase Logical IDs** are a CloudFormation constraint, but the `Wf` prefix on workforce-specific Logical IDs makes them greppable in `template.yaml`.
- **`kebab-case` for directories** matches the existing `.claude/skills/` precedent (`gas-call`, `gas-deploy-verify`) and is consistent with most TS project conventions.

## What `validate-naming.mjs` enforces

The script runs in CI as `npm run workforce:naming` and exits non-zero on violation. Specifically:

1. **Directory names under `workforce/{agents,lambdas,skills}/`** must match `^[a-z][a-z0-9-]*$`. Caps, underscores, or trailing punctuation fail.
2. **Agent slugs (`workforce/agents/{slug}/`)** must match `^[a-z]+$` — single lowercase token, no digits, no hyphens.
3. **TS source files under `workforce/lambdas/**`** must be `kebab-case.ts` (lowercase with `-` separators) — no `PascalCase.ts`, no `camelCase.ts`.
4. **Markdown files under `workforce/docs/`** must be `kebab-case.md`.
5. **SAM template (`workforce/infra/sam/template.yaml`)** — when present, deployed resource names referenced via `FunctionName`, `TableName`, `BucketName`, `RuleName`, `TopicName`, `QueueName`, and similar `*Name` properties must start with `wf-` and end with `-{stage}` (or `-${Stage}` / `${WorkforceStage}` token references).
6. **`agents/{slug}/agent.json:slug` field** (when present) must equal the directory name.

Rules that depend on a file or directory that doesn't yet exist are no-ops — the linter degrades gracefully as the subsystem grows, and PR1 (which adds only this doc + the linter) passes without any agent or Lambda files in place.

## Tightening over time

Each subsequent PR may add a row to the table or a check to the linter, but **never remove** one without a Zone A amendment to this file (§5 of governance.md). The simplest expression of R-N7 is monotonic accretion of constraints — every constraint added here is paid for by some bug or surprise it would have caught.
