# Deploy-role IAM policy

The `workforce-deploy` IAM role (assumed by the GitHub Actions workflow via OIDC) needs a permissions policy that lets CloudFormation create/update every resource type the SAM template declares. This directory holds the canonical policy.

## What's here

- **[`deploy-role-policy.json`](deploy-role-policy.json)** — least-privilege IAM policy. Scoped by ARN pattern to `workforce-*` resources and the SAM-managed artifact bucket. Grants exactly the actions a SAM deploy of this stack needs, nothing more.

## How to apply (one-time, by the operator)

The deploy role lives in your AWS account — outside this repo, outside CI. Apply the policy as an inline or managed policy on the role:

```bash
# Inline policy (simplest; tied to the role's lifecycle)
aws iam put-role-policy \
  --role-name workforce-deploy \
  --policy-name workforce-deploy-permissions \
  --policy-document file://workforce/infra/iam/deploy-role-policy.json
```

Or as a managed policy (reusable across roles):

```bash
aws iam create-policy \
  --policy-name workforce-deploy-permissions \
  --policy-document file://workforce/infra/iam/deploy-role-policy.json

aws iam attach-role-policy \
  --role-name workforce-deploy \
  --policy-arn arn:aws:iam::<ACCOUNT_ID>:policy/workforce-deploy-permissions
```

After applying, re-run the failed `Workforce SAM Deploy` workflow run on `main` (Actions tab → failed run → **Re-run failed jobs**), or push any change touching `workforce/**`.

## What it grants

| Sid | Purpose | Resource pattern |
|---|---|---|
| `CloudFormation` | Create/update the `workforce-{stage}` stacks and the SAM bootstrap stack | `stack/workforce-*/*`, `stack/aws-sam-cli-managed-default/*`, `changeSet/*` |
| `S3BucketLevel` | Create + configure the workforce data bucket and the SAM artifact bucket | `wf-*`, `aws-sam-cli-managed-default-*` |
| `S3ObjectLevel` | Upload/download artifacts | objects inside the above buckets |
| `DynamoDB` | Create/update the 3 tables + GSI | `table/{WorkforceCore,Chat,Memory}-*` and their indexes |
| `Lambda` | Create/update the 5 functions | `function:workforce-*` |
| `IAMForLambdaExecutionRoles` | Create the per-function execution roles SAM generates | `role/workforce-*` |
| `APIGateway` | Create/update the HTTP API | `apis/*` |
| `CloudWatchLogs` | Lambda log groups | `log-group:/aws/lambda/workforce-*` |

## What it does NOT grant

Intentionally absent:

- `iam:CreateUser`, `iam:CreatePolicy` outside `workforce-*` ARNs — no escalation surface.
- `s3:*` on any other bucket — can't touch buckets outside the `wf-*` and SAM-managed prefixes.
- Full `apigateway:*` on tags outside this namespace.
- Cross-account anything.

## When to update

If a future PR adds a new resource type to the SAM template (e.g. Secrets Manager in PR4, EventBridge in PR6, CloudFront in PR5), this policy needs the corresponding `*:Create/Describe/Update/Delete/Tag` actions appended. The cycle is:

1. PR fails with `AccessDenied` on `<service>:<action>` for `<resource>`.
2. Add the action to the appropriate Sid (or a new Sid).
3. Operator re-applies the policy via `aws iam put-role-policy`.
4. Re-run the workflow.

The routine prompt [`workforce/docs/routine-prompt.md`](../../docs/routine-prompt.md) classifies this as the "CFN AccessDenied" failure family — the fix is always "extend `deploy-role-policy.json` and re-apply."
