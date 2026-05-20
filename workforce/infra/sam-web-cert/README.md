# workforce console — ACM certificate stack (us-east-1)

ACM certificate for `workforce.kohuehara.xyz`, deployed to us-east-1
because CloudFront only accepts custom-domain certs from that region.
The main web stack (`wf-web-prod`, ap-northeast-1) reads the ARN as a
parameter.

See [../sam-web/README.md](../sam-web/README.md) for the end-to-end
operator runbook. This stack is **step 2** of that flow.

```bash
sam build
sam deploy --guided    # first time
```

After deploy:

1. ACM console (us-east-1) → pending cert → copy the DNS-01 CNAME.
2. Add it to Cloudflare as **DNS-only (gray cloud)**.
3. Wait 5–15 min for validation. Cert ARN appears in the stack
   `Outputs` tab once issued.

Subsequent runs of `sam deploy` are no-ops unless `DomainName` changes.
The certificate auto-renews via DNS so long as the validation CNAME
remains in Cloudflare.
