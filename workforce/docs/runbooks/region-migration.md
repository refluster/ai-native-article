# Runbook — AWS region migration

**When this runbook is invoked.** The workforce data plane (`wf-data-plane-{stage}`) needs to move from one AWS region to another — e.g. consolidating to a single primary region, recovering from a region outage, or moving to a region with better cost / latency for the agent personas.

This runbook covers the **data plane** stack only (`wf-data-plane-prod`). The SPA stack (`wf-web-prod`, us-west-2) has its own bootstrap sequence — see [`workforce/infra/sam-web/README.md`](../../infra/sam-web/README.md). The us-east-1 cert stack stays where it is regardless (CloudFront requires us-east-1 ACM).

## Why this is non-trivial

CloudFormation stacks are **per-region**. Changing `region` in `workforce/infra/sam/samconfig.toml` does not move resources — it just makes the next `sam deploy` target a different region. After the next deploy:

- The **new region** has a fresh `wf-data-plane-{stage}` stack with all resources at first-deploy state (empty DDB, empty S3 bucket).
- The **old region** still has the original stack alive, including:
  - DDB table `wf-table-{stage}` (with PITR — so deletion has a recovery window)
  - S3 bucket `wf-bucket-{acct}-{stage}` (with Versioning + retain-on-delete)
  - Lambdas: `wf-agent-runner-{stage}`, `wf-orchestrator-{stage}`, `wf-agents-api-{stage}`, `wf-seed-agents-{stage}`, `wf-seed-skills-{stage}`, `wf-pre-signup-{stage}`
  - EventBridge rule `wf-orchestrator-tick-{stage}` — may still be `Enabled: true` and firing
  - SNS alarm topic, AWS Budget
  - CloudWatch log groups under `/aws/lambda/wf-*`

If the operator does nothing else, **both stacks run concurrently**. The visible symptom: double Discord heartbeats (or duplicate Notion article inserts, duplicate Ren PR dispatches, etc.) depending on which skills are bound.

## Pre-flight checklist

Before merging the region-change PR (the one that flips `region = "..."` in `samconfig.toml`):

- [ ] **Secrets Manager** values exist in the **new** region. Either create from scratch or copy from the old region. The list as of 2026-05-25:
  - `wf/discord-pulse-prod` (shape: `{ "webhookUrl": "https://discord.com/api/webhooks/<id>/<token>" }`)
  - `wf/anthropic`
  - `wf/notion`
  - `wf/github`
  Copy example for one secret:
  ```bash
  OLD=ap-northeast-1
  NEW=us-west-2
  VALUE=$(aws secretsmanager get-secret-value --secret-id wf/discord-pulse-prod \
    --region $OLD --query SecretString --output text)
  aws secretsmanager create-secret --name wf/discord-pulse-prod \
    --secret-string "$VALUE" --region $NEW
  ```
- [ ] **`secrets.AWS_ROLE_ARN`** trust policy is unchanged (IAM is account-global) but the role's **resource-scoped policies** include ARNs in the new region. Inline policies enumerating `arn:aws:dynamodb:OLD_REGION:...`, `arn:aws:lambda:OLD_REGION:...`, `arn:aws:secretsmanager:OLD_REGION:secret:wf/*` etc. must be extended to cover `NEW_REGION` (or wildcarded over region). Test with a `sam deploy --dry-run` first.
- [ ] The new region is supported by every AWS service the template uses: DynamoDB, S3, Lambda (arm64), EventBridge, SNS, AWS Budgets, IAM, Secrets Manager, API Gateway HTTP API. As of 2026-05-25 all of these are available in every commercial region; flag if a future template addition (e.g. OpenSearch Serverless from RFC-010) lands a region-limited service.

## Migration steps

1. **Open a PR** that touches the four region references and merges them as a single atomic change:
   - `workforce/infra/sam/samconfig.toml` — `region = "..."` (3 stanzas: default, dev, prod)
   - `.github/workflows/deploy-workforce-data-plane.yml` — `aws-region:` field
   - `workforce/README.md` §Infrastructure — table row for `wf-data-plane-prod`
   - `workforce/ROADMAP.md` — Phase 1 "Data plane deployed to prod" historical note (only if it names a region)
   - Optional: `workforce/lambdas/README.md`, `workforce/docs/runbooks/engineer-pr-timeout.md` — `awscurl --region` examples.

2. **Pre-flight** (see checklist above). If not satisfied, do not merge — the `sam deploy` will fail at credential / secret resolution and you'll have a half-created stack to clean up.

3. **Merge.** This triggers `deploy-workforce-data-plane.yml` because `samconfig.toml` is in the path-trigger list. The workflow runs `sam deploy --config-env prod` against the new region — CloudFormation creates a fresh stack with all resources empty / at defaults.

4. **Wait for `sam deploy` to complete** (5–10 min typically). Watch the workflow run on GitHub Actions; on success it ends with `CREATE_COMPLETE` for the new stack.

5. **Verify in the new region.** Walk through [`#Verification`](#verification) below before doing any teardown.

6. **Tear down the old region.** See [`#Teardown`](#teardown) below.

## Verification

Each item should pass before declaring the migration done.

- **Stack health.**
  ```bash
  aws cloudformation describe-stacks \
    --stack-name wf-data-plane-prod \
    --region $NEW \
    --query 'Stacks[0].StackStatus'
  # Expected: "CREATE_COMPLETE" or "UPDATE_COMPLETE"
  ```
- **Seed Lambdas ran.** Post-deploy EventBridge rules fire `wf-seed-agents-{stage}` and `wf-seed-skills-{stage}`. Confirm `AGENT#*/META` and `SKILL#*/META` rows exist:
  ```bash
  aws dynamodb scan --table-name wf-table-prod --region $NEW \
    --query 'Items[?sk.S==`META`].pk.S' --output text
  # Expected: AGENT#sora, AGENT#maya, ..., SKILL#discord-ping, ...
  ```
- **Orchestrator tick.** If `template.yaml` has `Enabled: true`, CloudWatch metric `Invocations` for `wf-orchestrator-{stage}` should tick up at the rate (30 min as of 2026-05-25):
  ```bash
  aws cloudwatch get-metric-statistics --region $NEW \
    --namespace AWS/Lambda --metric-name Invocations \
    --dimensions Name=FunctionName,Value=wf-orchestrator-prod \
    --start-time $(date -u -d '2 hours ago' +%Y-%m-%dT%H:%M:%SZ) \
    --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
    --period 1800 --statistics Sum
  ```
- **Runner Errors = 0.** If `wf-agent-runner-{stage}` Errors metric is nonzero, the runner is throwing — usually a missing secret or a permission gap on the role. Check the function's CloudWatch logs.
- **First externally-visible side effect.** For Yuki / discord-ping: a `[wf-pulse] yuki alive at <iso>` line in the Discord channel within 7h (≤ 6h until the next `0/6` UTC + ≤ 30 min until the next tick after that). For Sora / article-draft: a new Notion page with `Author=sora`.

If any item fails, **do not tear down the old region** — it's the recovery path. Fix the new region first.

## Teardown

Run only after every verification item passes.

```bash
OLD=ap-northeast-1   # adjust
STAGE=prod
ACCT=$(aws sts get-caller-identity --query Account --output text)

# 1. Delete the CFN stack. Removes Lambdas, EventBridge rule, SNS topic,
#    AWS Budget. The rule stops firing immediately on stack delete.
aws cloudformation delete-stack \
  --stack-name wf-data-plane-${STAGE} \
  --region ${OLD}

aws cloudformation wait stack-delete-complete \
  --stack-name wf-data-plane-${STAGE} \
  --region ${OLD}

# 2. Retained resources (PITR + Versioning carry retain-on-delete).
#    DDB:
aws dynamodb delete-table --table-name wf-table-${STAGE} --region ${OLD}

#    S3: empty (including versions) then delete the bucket.
BUCKET=wf-bucket-${ACCT}-${STAGE}
aws s3 rm s3://${BUCKET} --recursive --region ${OLD}
aws s3api list-object-versions --bucket ${BUCKET} --region ${OLD} \
  --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' --output json | \
  aws s3api delete-objects --bucket ${BUCKET} --region ${OLD} \
    --delete file:///dev/stdin
aws s3api delete-bucket --bucket ${BUCKET} --region ${OLD}

# 3. Secrets Manager secrets in the old region (if any).
#    --force-delete-without-recovery skips the default 30-day recovery window.
for s in wf/discord-pulse-${STAGE} wf/anthropic wf/notion wf/github; do
  aws secretsmanager delete-secret --secret-id $s \
    --force-delete-without-recovery --region ${OLD} 2>/dev/null || true
done

# 4. CloudWatch log groups left behind by the deleted Lambdas.
aws logs describe-log-groups \
  --log-group-name-prefix /aws/lambda/wf- \
  --region ${OLD} \
  --query 'logGroups[].logGroupName' --output text | \
  xargs -n1 -I{} aws logs delete-log-group --log-group-name {} --region ${OLD}
```

## Known sharp edges

- **Stack name collision is not a thing.** `wf-data-plane-prod` can exist concurrently in `ap-northeast-1` and `us-west-2`; CFN namespaces stack names per region. This is what makes the "leave the old stack alive while you bring up the new one" recovery path safe.
- **S3 bucket names are global.** `wf-bucket-{acct}-{stage}` uses the AWS account ID in the name, so the same template produces distinct bucket names per `{stage}` but the same name across regions. Conflict if you try to bring the bucket up in a second region while the first still exists. Mitigation: the bucket name pattern already includes `{acct}` not `{region}`, so the **first** region wins — `sam deploy` in the second region will fail at `BucketAlreadyOwnedByYou`. This is a real risk: do not run a migration deploy until you've planned a teardown window.

  **Workaround if this fires:** delete the old bucket first (steps 2 in Teardown), then re-run `sam deploy`. Or change the template to include `{region}` in the bucket name, which is a Zone A change.

- **Secrets Manager 30-day default.** `aws secretsmanager delete-secret` schedules a 30-day recovery window unless you pass `--force-delete-without-recovery`. During that window the secret name is reserved — you cannot recreate it under the same id. For migrations, the force-delete flag is appropriate.

- **AWS Budgets are account-scoped.** The `wf-budget-{stage}` resource in the template is filtered by tag (`workforce={stage}`) — both regions' resources tag the same key/value, so during the transition the budget counts spend from both regions. This is correct (you want the global cap to hold). After teardown, the budget reflects the new region only.

- **Engineer poll has region-scoped state.** `AGENT#ren/DELIV#{ulid}` rows with `status=pending` live in DDB; on a teardown of the old region, those rows go away. Any in-flight Ren PR that hadn't been detected yet is lost. Best practice: pause Ren (`paused: true` via the agents API) for the migration window.

## Past migrations

| Date | From | To | PRs | Notes |
|---|---|---|---|---|
| 2026-05-25 | ap-northeast-1 | us-west-2 | [#105](https://github.com/refluster/ai-native-article/pull/105) | Consolidation to us-west-2 to match `wf-web-prod`. `#103` (tick `Enabled: true`) had already merged before `#105`, so the ap-northeast-1 stack briefly had the tick active before teardown. |
