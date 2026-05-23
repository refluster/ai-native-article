# Workforce — Infrastructure (SAM)

The CloudFormation surface for the workforce data plane and (from PR5+) its Lambdas. Deployed via [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html).

## What this stack contains (after PR4)

| Resource | Purpose |
|---|---|
| `WfTable` (DynamoDB) | Single-table workforce state. PK/SK + GSI1. PITR + SSE on. |
| `WfBucket` (S3) | Workforce blobs (memory chunks, drafts, eval sidecars). Versioned, SSE-S3, lifecycle to IA on `memory/` after 90d. |
| `WfAlarmTopic` (SNS) | Recipient for Lambda failure alarms (added in PR5/PR6) and AWS Budgets notifications. |
| `WfBudget` (AWS Budgets) | Monthly USD cap (W-3) filtered to resources tagged `workforce={stage}`. Notifies at 80% / 100% actual + 100% forecast. |

Lambdas land in PR5 (`wf-agents-api`, `wf-seed-agents`) and PR6 (`wf-orchestrator`, `wf-agent-runner`).

## One-time setup

1. AWS CLI configured for the target account (`aws sts get-caller-identity` should return your account).
2. SAM CLI ≥ 1.100 installed (`sam --version`).
3. Pick an email address to receive alarm notifications. You will confirm an SNS subscription email from your inbox after the first deploy.
4. Replace `replace-me@example.com` in [`samconfig.toml`](samconfig.toml) under `[dev.deploy.parameters]` and `[prod.deploy.parameters]` with that email. **Do not commit your real address** — pass it via `--parameter-overrides AlarmEmail=…` on the CLI instead, or use a local `samconfig.local.toml` (gitignored).

## Deploy

From the repo root:

```bash
cd workforce/infra/sam

# Validate the template
sam validate

# Build (no Lambda code yet — fast)
sam build

# Deploy dev
sam deploy --config-env dev \
  --parameter-overrides "Stage=dev MonthlyBudgetUsd=10 AlarmEmail=YOUR_EMAIL"

# Deploy prod (only when dev is verified)
sam deploy --config-env prod \
  --parameter-overrides "Stage=prod MonthlyBudgetUsd=50 AlarmEmail=YOUR_EMAIL"
```

The first deploy will:
- Create `wf-data-plane-{stage}` CloudFormation stack.
- Email the address you provided to confirm SNS subscription. **Click the link in that email** or you will not receive alarms.
- Create the DynamoDB table, S3 bucket, SNS topic, and Budget.

## Smoke after deploy

```bash
# DDB
aws dynamodb describe-table --table-name wf-table-dev | jq '.Table.TableStatus'
# → "ACTIVE"

# S3
aws s3api head-bucket --bucket "wf-bucket-$(aws sts get-caller-identity --query Account --output text)-dev"
# → exit 0

# SNS topic
aws sns get-topic-attributes \
  --topic-arn "$(aws cloudformation describe-stacks --stack-name wf-data-plane-dev \
    --query 'Stacks[0].Outputs[?OutputKey==`AlarmTopicArn`].OutputValue' --output text)" \
  | jq '.Attributes.SubscriptionsConfirmed'
# → "1" after you confirm the email

# Budget
aws budgets describe-budget --account-id "$(aws sts get-caller-identity --query Account --output text)" \
  --budget-name wf-budget-dev | jq '.Budget.BudgetLimit'
# → { "Amount": "10", "Unit": "USD" }
```

## Update / rollback

- Subsequent deploys re-use the same stack name and let CloudFormation compute the diff.
- Rollback: `aws cloudformation delete-stack --stack-name wf-data-plane-{stage}` removes everything (DDB rows, S3 objects, alarms). The bucket is versioned, so deleted objects are recoverable until the bucket itself is removed; consider exporting before deleting prod.

## Why no GitHub Actions deploy yet

A `workforce-deploy-article-site.yml` workflow that calls `sam deploy` on `main` merge is a Zone A addition and warrants its own PR (separate review for the OIDC role, the IAM permissions of that role, and the auto-deploy trigger boundary). PR4 keeps the change footprint minimal — operator deploys manually for now.

When the GHA deploy lands, it will use OIDC + an `AWSDeployRole` with the narrowest possible policy (`cloudformation:*` + `iam:PassRole` to the SAM execution role only). Designed in [RFC-006](../../docs/rfcs/rfc-006-scalability.md) implicitly; explicit RFC may follow.

## Governance

- [`template.yaml`](template.yaml) is **Zone B** per [`workforce/docs/governance.md` §3](../../docs/governance.md) — agent-merge allowed with CI + review. Changes that alter cost or scheduling are escalated under §5.
- [`samconfig.toml`](samconfig.toml) is **Zone A** — deploy targets, region, stack names. Production surface. This file's email default `replace-me@example.com` is a placeholder; never commit a real one (use CLI override).
- Any new resource must follow [`workforce/docs/naming.md`](../../docs/naming.md) R-N7. The CI linter `workforce:naming` enforces `wf-` prefix and `-{stage}` suffix on deployed names.
