# Workforce — Lambdas

TypeScript Lambda sources for the workforce data plane. Built with esbuild via `sam build`; deployed via `sam deploy` from [`../infra/sam`](../infra/sam).

All Lambdas:
- Runtime: **`nodejs24.x`** (see PR #28 operator direction).
- Architecture: **arm64**.
- Module format: **ESM** (Node 24 native).
- AWS SDK: **`@aws-sdk/*` v3, externalised** at bundle time — the Lambda runtime ships v3 client modules.

## Layout

```
lambdas/
├── README.md                   (this file)
├── package.json                shared dev deps (esbuild, typescript, @aws-sdk/*)
├── tsconfig.json               shared TypeScript config
├── shared/
│   ├── agent.ts                AgentIdentity / Operational / Computed / MetaRow types
│   ├── ddb.ts                  DynamoDBDocumentClient wrapper (get/put/update/scan/delete)
│   └── identity-hash.ts        sha256 over identity fields + system.md (seed idempotency)
├── agents-api/                 wf-agents-api Lambda — CRUD over AGENT#{slug}/META rows
│   └── handler.ts
└── seed-agents/                wf-seed-agents Lambda — file -> DDB upsert (SAM wiring in a follow-up PR)
    └── handler.ts
```

## Endpoints (after PR5 deploys)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/agents` | public | List agents (paginated, `?stream=`, `?archived=`, `?page_size=`, `?cursor=`). |
| `GET` | `/agents/{slug}` | public | Single agent's full record (identity + operational + computed). |
| `PATCH` | `/agents/{slug}` | AWS_IAM | Update operational fields only (`paused`, `archived`, `schedule_cron_override`, `budget_monthly_usd_override`). Rejects identity fields with `400 non_operational_fields`. |
| `DELETE` | `/agents/{slug}` | AWS_IAM | Soft delete — sets `archived: true`. Hard delete requires the `agents/{slug}/` directory to be removed in a PR first. |
| `GET` | `/skills` | public | List skills (paginated, `?status=`, `?owner=`, `?page_size=`, `?cursor=`). RFC-008 PR-D. |
| `GET` | `/skills/{name}` | public | Single skill's full record (identity + body + operational + computed). RFC-008 PR-D. |

`POST /agents` is **not** exposed. New personas come from PRs that add `workforce/agents/{slug}/{agent.json, system.md}` files (Rule 11 / W-5 preserved). Skills follow the same discipline — no `POST /skills`.

## Local dev

```bash
cd workforce/lambdas
npm ci
npm run typecheck   # tsc --noEmit
```

`npm test` does not exist yet; per-Lambda smoke tests land in a follow-up.

## Build + deploy

Both Lambdas use SAM's **Makefile builder** (per-function `Makefile`). The Makefiles call `../node_modules/.bin/esbuild`, so the **dependencies must be installed once** in the shared `workforce/lambdas/node_modules/` before `sam build`:

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

## Seeding DDB

**Seed runs automatically on every `sam deploy`.** The SAM template wires an EventBridge rule `wf-seed-agents-postdeploy-{stage}` that fires on `CREATE_COMPLETE` / `UPDATE_COMPLETE` of the `wf-data-plane-{stage}` stack and invokes the seed Lambda. The Lambda is **idempotent** via `identity_hash` — an unchanged file set is a no-op, and operational fields set via the API (`paused`, `archived`, `*_override`) are preserved on re-seed.

To verify after a deploy:

```bash
aws logs tail "/aws/lambda/wf-seed-agents-dev" --since 5m
# expect: {"event":"seed-complete","result":{"upserts":[...],"errors":[],"scanned":5}}
```

To force a re-seed without redeploying (e.g., recovering after a manual DDB mutation), run the CLI:

```bash
node workforce/scripts/seed-agents.mjs dev    # default stage
node workforce/scripts/seed-agents.mjs prod
```

The CLI is a thin wrapper that invokes `wf-seed-agents-{stage}` directly and pretty-prints the result.

## Invocation (after seeding)

```bash
# Public read
curl "$(aws cloudformation describe-stacks --stack-name wf-data-plane-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`AgentsApiUrl`].OutputValue' --output text)/agents"

# IAM-auth write (AWS SigV4 — use awscurl or aws-vault)
awscurl --service execute-api --region ap-northeast-1 -X PATCH \
  "https://$API/agents/sora" -d '{"paused": true}'
```
