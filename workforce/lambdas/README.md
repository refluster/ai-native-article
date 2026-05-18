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

`POST /agents` is **not** exposed. New personas come from PRs that add `workforce/agents/{slug}/{agent.json, system.md}` files (Rule 11 / W-5 preserved).

## Local dev

```bash
cd workforce/lambdas
npm ci
npm run typecheck   # tsc --noEmit
```

`npm test` does not exist yet; per-Lambda smoke tests land in a follow-up.

## Build + deploy

From [`../infra/sam`](../infra/sam):

```bash
sam build           # esbuild compiles handler.ts -> handler.mjs per function
sam deploy --config-env dev --parameter-overrides "Stage=dev MonthlyBudgetUsd=10 AlarmEmail=YOU"
```

The CloudFormation output `AgentsApiUrl` gives the base URL of the HTTP API. The API has **no custom domain in v1** — the AWS-generated URL is the contract.

## Seeding DDB with the 5 agents (until PR5.1)

Until [`seed-agents/handler.ts`](seed-agents/handler.ts) is wired into SAM (Makefile build that copies `workforce/agents/**` into the bundle), the operator seeds manually after the first deploy. From the repo root:

```bash
for slug in sora maya ren aoi yuki; do
  agent=$(cat workforce/agents/$slug/agent.json)
  # Convert to the AGENT#{slug}/META row shape and put.
  # See workforce/docs/data-model.md for the full row schema.
  echo "TODO: aws dynamodb put-item for $slug — script lands in PR5.1"
done
```

A one-shot seed CLI (`workforce/scripts/seed-agents.mjs`) is in scope for **PR5.1**, along with wiring `seed-agents/handler.ts` into SAM (Makefile builder copies the agents tree into the artifact). The Lambda code is already committed in this PR so the wiring change can be small.

## Invocation (after seeding)

```bash
# Public read
curl "$(aws cloudformation describe-stacks --stack-name wf-data-plane-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`AgentsApiUrl`].OutputValue' --output text)/agents"

# IAM-auth write (AWS SigV4 — use awscurl or aws-vault)
awscurl --service execute-api --region ap-northeast-1 -X PATCH \
  "https://$API/agents/sora" -d '{"paused": true}'
```
