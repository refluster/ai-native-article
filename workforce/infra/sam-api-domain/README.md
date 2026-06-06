# workforce API — custom-domain stack (us-west-2)

Serves `wf-agents-api` under the stable hostname **`workforce-api.kohuehara.xyz`**
instead of the raw `https://{id}.execute-api.us-west-2.amazonaws.com/prod`
URL. Implements [ADR-0004](../../docs/adr/adr-0004-workforce-api-custom-domain.md).

This is a **standalone, operator-deployed stack** — it is deliberately NOT
part of the auto-deploying `wf-data-plane` stack, because the ACM cert's
DNS-01 validation blocks CloudFormation until the validation CNAME is in
Cloudflare. Same split, same reason, as [`../sam-web-cert`](../sam-web-cert/README.md)
(the only difference: this cert is **regional / us-west-2**, because HTTP API
custom domains need the cert in the API's region — not us-east-1).

Nothing here changes the data plane. Deploy it on your own schedule; until
you do, the API keeps serving on the raw execute-api URL and every route
(including Epic-012's `/agents/{slug}/recall`) is unaffected.

## Prerequisites

- The `wf-data-plane-prod` stack is deployed (the HTTP API exists).
- You can edit the Cloudflare DNS zone for `kohuehara.xyz`.

## Runbook

### 1. Find the HTTP API id (~1 min)

```bash
# The agents + credentials HTTP APIs both carry the stack name
# (wf-data-plane-{stage}) as their Name, so filtering by Name is ambiguous.
# Identify the agents API by a route only it has (GET /agents):
for id in $(aws apigatewayv2 get-apis --region us-west-2 --query "Items[].ApiId" --output text); do
  aws apigatewayv2 get-routes --api-id "$id" --region us-west-2 \
    --query "Items[?RouteKey=='GET /agents'].RouteKey" --output text | grep -q . && echo "$id"
done
```

…or just read it from the host of the current `VITE_WORKFORCE_AGENTS_API_BASE`
secret (pre-cutover form): `https://{HttpApiId}.execute-api.us-west-2.amazonaws.com/prod`.
(As of the 2026-06 rollout the agents API id is `sjhikazsf9`.)

### 2. Deploy this stack (~2 min + DNS validation wait)

```bash
cd workforce/infra/sam-api-domain
sam build
sam deploy --guided \
  --region us-west-2 \
  --stack-name wf-api-domain-prod \
  --parameter-overrides HttpApiId=<the id from step 1>
# DomainName defaults to workforce-api.kohuehara.xyz; ApiStage defaults to prod.
```

The stack **pauses** creating `ApiCertificate` until you do step 3.

### 3. Add the ACM validation CNAME to Cloudflare (~5–15 min to validate)

1. ACM console (**us-west-2**) → the pending `workforce-api.kohuehara.xyz`
   cert → copy the DNS-01 CNAME (`_xxxx.workforce-api.kohuehara.xyz` →
   `_yyyy.acm-validations.aws.`).
2. Cloudflare → DNS → add it as a **DNS-only (gray cloud)** CNAME.
3. Wait for ACM to flip the cert to *Issued*; the stack then finishes.

### 4. Point `workforce-api.kohuehara.xyz` at the API (~2 min)

```bash
aws cloudformation describe-stacks --stack-name wf-api-domain-prod \
  --region us-west-2 --query "Stacks[0].Outputs" --output table
# → RegionalDomainTarget = d-xxxx.execute-api.us-west-2.amazonaws.com
```

Cloudflare → DNS → add record:

```
Type:    CNAME
Name:    workforce-api
Target:  <RegionalDomainTarget from the output>
Proxy:   DNS only (gray cloud)
```

Gray cloud is required: the regional API GW domain terminates TLS with the
ACM cert; Cloudflare proxying (orange cloud) would interpose its own edge
cert and break SigV4-signed requests.

Verify:

```bash
curl -s https://workforce-api.kohuehara.xyz/agents | head -c 200
```

### 5. Cut the base URL over (~5 min)

Only after step 4 resolves:

1. Update the repo secret **`VITE_WORKFORCE_AGENTS_API_BASE`** to
   `https://workforce-api.kohuehara.xyz` (note: **no `/prod` suffix** — the
   API mapping absorbs the stage). Redeploy the workforce SPA.
2. Update the `discord-digest` skill's base-URL constant
   (`workforce/skills/discord-digest/SKILL.md`) to the same value, dropping
   `/prod`.

The raw execute-api URL keeps working in parallel, so the cutover is not
time-critical — flip the SPA first, confirm, then the skill.

## Teardown / change

`sam deploy` reruns are no-ops unless a parameter changes. Deleting the
stack removes the custom domain + mapping + cert; the API stays reachable on
the raw execute-api URL (revert the base-URL secret + skill constant first).
