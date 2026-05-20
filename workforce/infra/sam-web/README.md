# workforce console — hosting + auth runbook

This stack puts the workforce console behind Cognito-mediated Google
sign-in at **https://workforce.kohuehara.xyz**.

It exists alongside the data plane stack (`wf-data-plane-prod`) but is
intentionally **not co-deployed** — bootstrap requires Google OAuth
setup and Cloudflare DNS changes that only the operator can do.

## Architecture

```
[ browser ]
    │  HTTPS https://workforce.kohuehara.xyz
    ▼
[ Cloudflare DNS (CNAME, gray cloud) ]
    │
    ▼
[ CloudFront distribution ]──(OAC, sigv4)──▶[ S3 wf-web-{acct}-prod ]
    │
    │  401 / 403 → SPA boot → check ID token in localStorage
    │  no token → redirect to Hosted UI
    ▼
[ Cognito Hosted UI ]──federates──▶[ Google OAuth ]
   wf-auth-{acct}.auth.us-west-2.amazoncognito.com
                                          │
                                          ▼
                                  [ pre-signup Lambda ]
                                  reject if email != OperatorEmail
```

## One-time bootstrap

These steps run **once** before the first CI deploy. Re-run only on
parameter changes (rotating Google client secret, new operator email,
domain change, etc.).

### 1. Google OAuth client (~5 min)

1. Open https://console.cloud.google.com/apis/credentials. If you don't
   have a project yet, create one named `kohuehara-workforce`.
2. **OAuth consent screen** → External → app name `Workforce Console`,
   user support email = operator email, developer contact = operator
   email. Add scopes: `openid`, `email`, `profile`. Save.
3. **Credentials → Create credentials → OAuth client ID** → Web
   application → name `wf-console`. Leave authorised origins / redirects
   blank for now — we fill them in step 4 once Cognito hands us the
   Hosted UI URL.
4. Save and copy the **client ID** + **client secret** somewhere safe.

### 2. Deploy the us-east-1 cert stack (~5 min + DNS validation wait)

```bash
cd workforce/infra/sam-web-cert
sam build
sam deploy --guided    # first time; subsequent runs: sam deploy
```

After deploy:

1. Open the ACM console in **us-east-1** → click the pending cert.
2. Copy the DNS-01 CNAME record (`_acme-challenge.workforce.kohuehara.xyz` →
   `_xxx.acm-validations.aws`).
3. In Cloudflare, add a **DNS-only (gray cloud)** CNAME with that name
   and value. Cloudflare strips the `kohuehara.xyz.` suffix automatically;
   enter just the leftmost label.
4. Wait. ACM polls every minute or so; validation typically completes
   in 5–15 min.

Once issued, capture the cert ARN — it's both an output of the stack
(`CertificateArn`) and visible in the ACM console.

### 3. Deploy the us-west-2 web stack (~10 min)

```bash
cd workforce/infra/sam-web
sam build
sam deploy --guided \
  --parameter-overrides \
    CertificateArn=arn:aws:acm:us-east-1:<ACCT>:certificate/<UUID> \
    GoogleClientId=<id>.apps.googleusercontent.com \
    GoogleClientSecret=GOCSPX-<secret> \
    OperatorEmail=refluster@gmail.com
```

Stack outputs you'll need next:

| Output | Used in |
|---|---|
| `WebBucketName`        | `deploy-workforce.yml` (`AWS_S3_BUCKET` secret) |
| `DistributionId`       | `deploy-workforce.yml` (`AWS_CLOUDFRONT_DISTRIBUTION_ID` secret) |
| `DistributionDomain`   | Cloudflare CNAME target (step 4) |
| `UserPoolId`           | `VITE_COGNITO_USER_POOL_ID` build env |
| `UserPoolClientId`     | `VITE_COGNITO_CLIENT_ID` build env |
| `UserPoolDomain`       | `VITE_COGNITO_DOMAIN` build env |
| `HostedUiUrl`          | Google OAuth → authorised redirect URIs |

### 4. Cloudflare CNAME for workforce.kohuehara.xyz (~2 min)

Cloudflare → DNS → Add record:

```
Type:    CNAME
Name:    workforce
Target:  d{xxx}.cloudfront.net   ← from DistributionDomain output
Proxy:   DNS only (gray cloud)
TTL:     Auto
```

**Do not enable the orange-cloud proxy.** CloudFront handles TLS
termination using the ACM cert; Cloudflare proxying would either show
a 525/526 (cert mismatch) or double-CDN every request.

### 5. Wire Google → Cognito callback (~2 min)

Back in Google Cloud Console → Credentials → wf-console client → edit:

- **Authorised JavaScript origins**:
  - `https://workforce.kohuehara.xyz`
- **Authorised redirect URIs**:
  - `{HostedUiUrl}/oauth2/idpresponse`
    e.g. `https://wf-auth-123456789012.auth.us-west-2.amazoncognito.com/oauth2/idpresponse`

Save.

### 6. GitHub repo secrets (~3 min)

In **Settings → Secrets and variables → Actions**, add:

| Secret | Source |
|---|---|
| `AWS_ACCESS_KEY_ID`              | IAM user with `s3:PutObject` on the bucket + `cloudfront:CreateInvalidation` on the distribution |
| `AWS_SECRET_ACCESS_KEY`          | (pair) |
| `AWS_REGION`                     | `us-west-2` |
| `AWS_S3_BUCKET`                  | stack output `WebBucketName` |
| `AWS_CLOUDFRONT_DISTRIBUTION_ID` | stack output `DistributionId` |
| `VITE_COGNITO_USER_POOL_ID`      | stack output `UserPoolId` |
| `VITE_COGNITO_CLIENT_ID`         | stack output `UserPoolClientId` |
| `VITE_COGNITO_DOMAIN`            | stack output `UserPoolDomain` |

A minimal IAM policy for the deploy user lives below — adjust the
account ID + distribution ID:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::wf-web-<ACCT>-prod",
        "arn:aws:s3:::wf-web-<ACCT>-prod/*"
      ] },
    { "Effect": "Allow",
      "Action": "cloudfront:CreateInvalidation",
      "Resource": "arn:aws:cloudfront::<ACCT>:distribution/<DIST_ID>" }
  ]
}
```

### 7. First deploy

Push to `main` (any change under `apps/workforce/**` triggers the
workflow; also runnable via `workflow_dispatch`).
`deploy-workforce.yml` builds the SPA with the `VITE_COGNITO_*`
secrets injected, syncs `apps/workforce/dist/` to S3, then invalidates
the CloudFront distribution.

Visit https://workforce.kohuehara.xyz — you should be redirected to the
Hosted UI, then Google, then back to the dashboard.

## Ongoing operation

- **Day-to-day deploys**: handled by `deploy-workforce.yml` on every
  push that touches `apps/workforce/` or `packages/shared/`. No manual
  steps.
- **Rotating Google client secret**: re-run `sam deploy` with the new
  secret in `--parameter-overrides`. CloudFront / S3 are untouched; no
  invalidation needed.
- **Adding a second operator** (don't, but if you must): edit
  `OperatorEmail` to a comma-separated list and rewrite the pre-sign-up
  Lambda. This is a C-3 (`single-operator scale`) violation and should
  trigger a governance update first.
- **Tearing down**: `sam delete --stack-name wf-web-prod` (us-west-2)
  then `sam delete --stack-name wf-web-cert-prod` (us-east-1). The S3
  bucket has `Retain` policy; delete it manually after confirming you
  don't need the SPA bundle history.

## Known sharp edges

- **First-deploy cert validation can take 30+ min** if Cloudflare's
  propagation is slow. ACM's "Pending validation" view will sit on the
  same status for a while; don't refresh-spam, it doesn't help.
- **SPA fallback caches 200 for the SPA index**. If a build introduces
  a fatal bundle error, that error caches at the edge for 10 s before
  a new invalidation can land. The CI workflow always emits an
  invalidation; rollback = revert the commit + let CI redeploy.
- **Lambda@Edge is intentionally NOT in this stack**. We use SPA-handled
  auth: the bundle is reachable by anyone, but it shows no real
  content without a valid ID token. If the threat model ever requires
  edge-gated downloads (sensitive PII in the bundle, etc.) we'd add a
  Lambda@Edge gate — but it adds us-east-1 management overhead the
  current mock-data-only console doesn't justify.
