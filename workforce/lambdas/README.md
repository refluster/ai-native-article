# Workforce — Lambdas

TypeScript Lambda sources for the workforce data plane. Built with esbuild via `sam build`; deployed via `sam deploy` from [`../infra/sam`](../infra/sam).

All Lambdas:
- Runtime: **`nodejs24.x`** (see PR #28 operator direction).
- Architecture: **arm64**.
- Module format: **ESM** (Node 24 native).
- AWS SDK: **`@aws-sdk/*` v3, externalised** at bundle time — the Lambda runtime ships v3 client modules.

## Layout

One directory per Lambda, each with a `handler.ts` (+ `Makefile` for `sam build`); `shared/` holds the runtime libs every handler imports (`ddb.ts`, `agent.ts`, `skill-config.ts`, `llm-azure.ts`, `performance.ts`, …). Deployed from `../infra/sam/template.yaml` unless noted.

| Directory | Function | Purpose |
|---|---|---|
| `agents-api/` | `wf-agents-api` | HTTP API: agents, skills, feed, stats, projects, bindings, OpenAPI docs. The single writer for `AGENT#`/`SKILL#` rows (ADR-0007/0008). |
| `orchestrator/` | `wf-orchestrator` | 2-hourly tick: evaluates `bindings[]`, enqueues `TASK#` rows, dispatches CCR routines (ADR-0005), polls engineer PRs. |
| `tools-api/` | `wf-tools-api` | Synchronous LLM run surface for project tools (ADR-0027). |
| `credentials-api/` | `wf-credentials-api` | Operator-only per-project credentials (ADR-0009). |
| `migrate-credentials/` | `wf-migrate-credentials` | One-shot credential migration. |
| `messaging-reply/` | `wf-messaging-reply` | Real-time operator ↔ talent reply path (ADR-0006). |
| `l1-source-register/` | `wf-l1-source-register` | No-LLM L1 source capture into the Notion Articles DB (`/capture` share target). |
| `wf-podcast/` | `wf-podcast` | Polly synthesis, S3/CloudFront distribution, RSS (ADR-0016). |
| `memory-compactor/` | `wf-memory-compactor` | Nightly agent-memory folding (ADR-0019). |
| `performance-reducer/` | `wf-performance-reducer` | Daily performance-lifecycle roll-up. |
| `audit/` | `wf-audit` | Daily EXEC-row signal audit. |
| `config-digest/` | `wf-config-digest` | Weekly agent-config review issue (ADR-0007). |
| `backfill-tasks/` | `wf-backfill-tasks` | Backfill of task rows. |
| `seed-skills/` | `wf-seed-skills` | Seeds `SKILL#` rows from the generated skill registry (ADR-0018 version gate). |
| `wf-pre-signup/` | `wf-pre-signup` | Cognito pre-sign-up trigger (operator e-mail gate) — `../infra/sam-web`. |

## Endpoints (agents-api, abridged)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/agents` | public | List agents (paginated, `?stream=`, `?archived=`, `?page_size=`, `?cursor=`). |
| `GET` | `/agents/{slug}` | public | Single agent's full record (identity + operational + computed). |
| `POST` | `/agents` | AWS_IAM | Create an agent ([ADR-0007](../docs/adr/adr-0007-agent-config-single-source.md) "full CRUD"). Body = `slug` + the identity fields; `created_at` and the operational/computed slices are server-set. Validated by `shared/agent-config.ts` (`S0-required` + the PATCH rules + W-3), `409` on an existing slug, appends a `kind=create` AUDIT item. |
| `PATCH` | `/agents/{slug}` | AWS_IAM | Update operational fields (`paused`, `archived`, `budget_monthly_usd_override`) **and** identity fields (ADR-0007). Validated + audited; rejects immutable/computed fields with `400 non_patchable_fields`. |
| `DELETE` | `/agents/{slug}` | AWS_IAM | Soft delete — sets `archived: true`. |
| `GET` | `/docs/openapi` | public | OpenAPI 3.0 spec (YAML). Single source: `agents-api/openapi.ts` — update it with every route change. |
| `GET` | `/docs/api` | public | Rendered API reference (Redoc shell over `/docs/openapi`). |
| `GET` | `/skills` | public | List skills (paginated, `?status=`, `?owner=`, `?page_size=`, `?cursor=`). Epic-008 PR-D. |
| `GET` | `/skills/{name}` | public | Single skill's full record (identity + body + operational + computed). Epic-008 PR-D. |
| `PATCH` | `/skills/{name}` | AWS_IAM | Update judgment-side skill config ([ADR-0008](../docs/adr/adr-0008-skill-config-single-source.md)): `body`, `description`, `version`, `status`, `owners`, `cost_class`, `improvement_agent[_override]`. Validated by `shared/skill-config.ts`, audited to `SKILL#{name}/AUDIT#`. Code-side fields (write-scripts, `requires[]`, `archetype`, `deliverable`) are git-owned and rejected `400`. |
| `GET` | `/skills/{name}/audit` | public | Skill config-mutation audit trail, newest-first (ADR-0008). |

The table above is the original core; feed, stats, projects, bindings, credentials, tools and podcast routes are documented by `GET /docs/openapi` (kept in sync by `npm run workforce:openapi-routes`). New personas are registered via `POST /agents` (ADR-0007 retired the `workforce/agents/` git tree; the DDB row family is the single authoritative store and agents-api the single writer — see [runbooks/agent-registration.md](../docs/runbooks/agent-registration.md)). Skills split along the Software 2.0 seam ([ADR-0008](../docs/adr/adr-0008-skill-config-single-source.md)): judgment-side fields mutate via `PATCH /skills/{name}` (DDB-authoritative, write = live on the next fire); write-scripts and `requires[]` stay git-owned, so a NEW skill still enters via the `cadence-forge` scaffold + PR — no `POST /skills`.

## Local dev

```bash
cd workforce/lambdas
npm ci
npm run typecheck   # tsc --noEmit
npm test            # vitest run (configured by vitest.config.mjs)
```

### Test file naming

Test files use the suffix `*-tests.ts` (NOT vitest's default `*.test.ts`).
Reason: the workforce naming lint (R-N7 / `workforce/scripts/validate-naming.mjs`,
regex `KEBAB_TS = /^[a-z][a-z0-9-]*\.ts$/`) does not allow dotted segments,
and `*.test.ts` would fail the lint. The included `vitest.config.mjs` points
vitest's discovery glob at `**/*-tests.ts` so the convention "just works."

When adding a test, name the file like the module it tests with `-tests`
appended: `foo.ts` → `foo-tests.ts`. The next governance retrospective should
formalise this in `workforce/docs/naming.md`.

## Build + deploy

All Lambdas use SAM's **Makefile builder** (per-function `Makefile`). The Makefiles call `../node_modules/.bin/esbuild`, so the **dependencies must be installed once** in the shared `workforce/lambdas/node_modules/` before `sam build`:

```bash
# 1. Install lambda deps (one-time per checkout / on package.json change)
cd workforce/lambdas
npm ci

# 2. Build + deploy
cd ../infra/sam
sam build      # runs each function's Makefile -> ARTIFACTS_DIR/handler.mjs
sam deploy --config-env dev --parameter-overrides "Stage=dev MonthlyBudgetUsd=10 AlarmEmail=YOU"
```

R-N8 (data-shape uniformity) holds at the build layer — both functions share the same toolchain, the same `node_modules`, the same Makefile shape. The seed-agents Makefile additionally `cp -R ../../agents/. $(ARTIFACTS_DIR)/agents/` so the handler can read the persona files at runtime.

The CloudFormation output `AgentsApiUrl` gives the base URL of the HTTP API. The API has **no custom domain in v1** — the AWS-generated URL is the contract.

## Agent rows — no seeding (ADR-0007)

Agent identity/config lives in the `AGENT#{slug}/META` rows and is mutated only through `PATCH /agents/{slug}` on the agents-api (validated at the write boundary, appended to the `AUDIT#` trail, reviewed via the weekly config digest). The file-based seed (`wf-seed-agents` + `workforce/agents/**`) retired with ADR-0007 step 6b; durability is DDB PITR + the weekly `wf-config-digest` export to S3 `exports/` — environment rebuild = restore, not re-seed. Creating a brand-new agent is currently an operator action (direct row write or a future create API per the ADR); skills are still seeded from files by `wf-seed-skills` post-deploy.

## Invocation

```bash
# Public read
curl "$(aws cloudformation describe-stacks --stack-name wf-data-plane-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`AgentsApiUrl`].OutputValue' --output text)/agents"

# IAM-auth write (AWS SigV4 — use awscurl or aws-vault)
awscurl --service execute-api --region us-west-2 -X PATCH \
  "https://$API/agents/sora" -d '{"paused": true}'
```
