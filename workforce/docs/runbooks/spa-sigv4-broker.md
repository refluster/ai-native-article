# Runbook — SPA SigV4 broker (Cognito Identity Pool)

Wires the SPA at `workforce.kohuehara.xyz` to call AWS_IAM-protected API Gateway routes (`PATCH/DELETE` on `wf-agents-api`, all routes on `wf-credentials-api`) via SigV4-signed requests. Provisioned in Issue #158 PR-α.

## Architecture

```
  Operator → Cognito Hosted UI (Google) → User Pool: ID token (OIDC)
                                                 ↓
                                Identity Pool: GetId + GetCredentialsForIdentity
                                                 ↓
                          Temp AWS creds (1h) — assume WfWorkforceOperatorRole
                                                 ↓
                          SPA: aws4fetch SigV4-signs API Gateway calls
                                                 ↓
                              API Gateway AWS_IAM auth: ALLOW
```

## One-time setup (post-deploy)

The CFN resources land via `sam deploy` on `wf-data-plane-{stage}` and `wf-web-{stage}`. After both stacks have updated successfully:

```bash
STACK=wf-web-prod   # or wf-web-dev
REGION=us-west-2

# Read the new Identity Pool ID.
IDENTITY_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK" --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`WorkforceIdentityPoolId`].OutputValue' \
  --output text)
echo "$IDENTITY_POOL_ID"
```

Add the value to the SPA build environment alongside the existing `VITE_COGNITO_*` vars:

```
VITE_COGNITO_IDENTITY_POOL_ID=us-west-2:abcd1234-...
```

The CI workflow (`.github/workflows/deploy-workforce-console.yml`) needs the value as a repo secret named `VITE_COGNITO_IDENTITY_POOL_ID`. Add via:

```bash
gh secret set VITE_COGNITO_IDENTITY_POOL_ID --body "$IDENTITY_POOL_ID" --repo refluster/ai-native-article
```

Trigger a redeploy of `workforce.kohuehara.xyz` so the SPA picks up the new env var.

## Verify

After the SPA redeploys, sign in normally via the Hosted UI. From the browser console:

```javascript
// 1. Confirm the broker is configured.
import('./assets/index-*.js').then(() => {
  // (modules are dynamically named; easiest path is the smoke helper below)
});

// 2. Smoke-test: PATCH /agents/ren with empty body.
//    Expected: { status: 400, body: { error: "empty_patch" } }
//    A 400 from the handler PROVES SigV4 reached the AWS_IAM gate AND
//    the role was assumable AND the policy allowed the route. The
//    handler-layer 400 is the success signal here.
//
//    A 403 → API Gateway rejected the SigV4 (broker mis-wired).
//    A network/CORS error → SPA build env vars missing.
window.__wfSigv4Smoke = true;
// In a future PR-γ the smoke helper will be exposed on window.wfSigv4Smoke;
// for now, import it from the bundle directly or call it via React DevTools.
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `assertSigv4Configured` throws | `VITE_COGNITO_IDENTITY_POOL_ID` missing from SPA build | Add the env var via CI secret + redeploy |
| `Cognito session missing or expired` | Operator not signed in OR token expired (~1h) | Sign in via Hosted UI; check sessionStorage |
| `Cognito Identity Pool returned no IdentityId` | Token validation failed; pool not configured for this User Pool | Check the pool's `CognitoIdentityProviders` lists the User Pool's client id |
| `Cognito Identity Pool returned incomplete credentials` | IAM role not attached, or trust policy mismatch | Confirm `WfWorkforceIdentityPoolRoleAttachment` deployed + `WfWorkforceOperatorRole.AssumeRolePolicyDocument` references the Identity Pool id |
| SigV4 request → 403 | IAM role missing `execute-api:Invoke` on the target API | Check `WfWorkforceOperatorRole.PolicyDocument` includes the API id (imports from data-plane stack: `wf-agents-api-id-{stage}` / `wf-credentials-api-id-{stage}`) |

## Threat model + scope

The Identity Pool is bound to the existing User Pool which is itself bound to a single operator Google account (`AllowAdminCreateUserOnly: true` + Google federation). The trust chain is:

```
Google account `koh.uehara` → User Pool `WfUserPool` →
  Identity Pool `WfWorkforceIdentityPool` →
    IAM Role `WfWorkforceOperatorRole` →
      execute-api:Invoke on `wf-credentials-api-prod` + `wf-agents-api-prod` ONLY
```

A stolen Cognito session token cannot:
- Read or write S3
- Read or write DynamoDB
- Invoke any Lambda directly
- Assume any other IAM role
- Reach any AWS API other than `execute-api:Invoke` on the two listed APIs

The temp AWS credentials live only in the browser tab's JS heap; on tab close they evaporate. On token expiry the next `signedFetch` call re-exchanges transparently.

## Related

- [Issue #158](https://github.com/refluster/ai-native-article/issues/158) — Project CRUD UI workstream (this is PR-α).
- [PR #137](https://github.com/refluster/ai-native-article/pull/137) — credentials API backend (consumer).
- [PR #161](https://github.com/refluster/ai-native-article/pull/161) — LIST credentials + PATCH project backend (consumer).
- `apps/workforce/src/lib/sigv4.ts` — the SPA-side helper.
- `workforce/infra/sam-web/template.yaml` — `WfWorkforceIdentityPool` + `WfWorkforceOperatorRole`.
- `workforce/infra/sam/template.yaml` — `AgentsApiId` + `CredentialsApiId` exports.
