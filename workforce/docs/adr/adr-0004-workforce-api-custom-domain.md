# ADR-0004 — Workforce API served from a custom domain (`workforce-api.kohuehara.xyz`)

- **Status**: Accepted
- **Date**: 2026-06-04
- **Deciders**: operator
- **Epics**: [epic-007](../epics/epic-007-agent-management-api.md), [epic-012](../epics/epic-012-agent-experience.md)

## Context

`wf-agents-api` (the workforce read/CRUD API — agents, skills, projects,
executions, feed, and now Epic-012's `recall`) is an API Gateway **HttpApi**.
Until this decision it was served only from the raw, auto-generated
execute-api hostname:

```
https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod
```

The SPA reaches it via a build-time secret (`VITE_WORKFORCE_AGENTS_API_BASE`),
so end users never see the URL, and a CORS allow-list
(`kohuehara.xyz`, `workforce.kohuehara.xyz`, `localhost:5173`) plus an IAM
authorizer gate it. This worked, but the choice was **never written down** —
it was an implicit default. Epic-012 Story 1 adds a new route
(`GET /agents/{slug}/recall`), which surfaced the question "what is the
canonical URL/domain for the workforce API?" and the realisation that no ADR
governed it.

The raw execute-api hostname has one structural weakness: the API-id
(`sjhikazsf9`) and the region (`us-west-2`) are **baked into the URL**. A
region migration or an API replacement (see
[runbooks/region-migration.md](../runbooks/region-migration.md)) changes the
hostname, forcing a coordinated update of the SPA secret and every script
that carries the base URL as a constant (e.g. the discord-digest skill).

## Decision

**Serve `wf-agents-api` from a stable custom domain:
`workforce-api.kohuehara.xyz`.**

- An API Gateway **custom domain name** (`workforce-api.kohuehara.xyz`)
  fronts the existing `WfAgentsHttpApi`, with an **API mapping** to the
  `prod` stage.
- A **regional ACM certificate in us-west-2** backs it (HttpApi custom
  domains are regional — note this differs from the CloudFront cert in
  `sam-web-cert`, which must live in us-east-1).
- A **DNS record** for `workforce-api.kohuehara.xyz` points at the API
  Gateway regional domain target.
- The canonical base URL becomes
  `https://workforce-api.kohuehara.xyz` (no `/prod` suffix — the stage is
  absorbed by the API mapping). `VITE_WORKFORCE_AGENTS_API_BASE` and any
  script-embedded constant are repointed to it.
- CORS and the IAM authorizer are unchanged — the custom domain is a stable
  *name* in front of the same HttpApi, not a new trust surface.

This ADR records the **decision**. The rollout (cert + domain + mapping +
DNS + secret cutover) is a separate infrastructure Story — see §Consequences.

## Alternatives considered

- **Keep the raw execute-api URL (status quo), documented as deliberate.**
  Zero infra; the SPA already hides it; adequate for C-3 single-operator
  scale. Rejected because the API-id + region are baked into the URL, making
  the region-migration runbook needlessly painful, and because every
  base-URL constant in scripts is a migration-fragility point. The operator
  chose a stable name over zero-infra.
- **Path-based same-origin under the console
  (`workforce.kohuehara.xyz/api/*` via a CloudFront behavior → API GW
  origin).** Kills CORS (same-origin) and keeps a single domain. Rejected
  for now: it couples the API's availability and caching semantics to the
  console's CloudFront distribution, and the SigV4 signing path through
  CloudFront needs careful origin-request configuration. More moving parts
  than a flat custom domain for no benefit the CORS allow-list doesn't
  already provide. Re-openable if a single-origin model becomes desirable.
- **`api.workforce.kohuehara.xyz` (nested under the console subdomain).**
  Functionally equivalent to the chosen name. The operator chose the flat
  `workforce-api.kohuehara.xyz` form; recorded here so the nested variant
  isn't reintroduced by mistake.

## Consequences

- **Positive.** The API URL is stable across region/API-id changes; the
  region-migration runbook no longer has to chase the hostname into the SPA
  secret and every script constant; the public-facing name reads cleanly.
- **Cost.** Negligible — an ACM cert is free; the custom domain + mapping
  add no per-request charge.
- **Rollout — IaC prepared; operator-executed (#220).** Shipped as the
  standalone, operator-deployed stack
  [`workforce/infra/sam-api-domain/`](../../infra/sam-api-domain/README.md)
  (cert + `DomainName` + `ApiMapping`), NOT folded into the auto-deploying
  data plane — because the cert's DNS-01 validation would otherwise stall
  every prod deploy (same split + reason as `sam-web-cert`). The operator
  runbook covers: (1) regional ACM cert in **us-west-2**, (2) the Cloudflare
  validation CNAME, (3) the `workforce-api` CNAME → regional API GW target,
  (4) cutting `VITE_WORKFORCE_AGENTS_API_BASE` + the discord-digest constant
  over (dropping `/prod`). [runbooks/region-migration.md](../runbooks/region-migration.md)
  is updated to note the decoupling.
- **Watch-out — cert region.** HttpApi regional custom domains require the
  ACM cert in the **API's region (us-west-2)**, NOT us-east-1. Copying the
  `sam-web-cert` (us-east-1, for CloudFront) pattern here would fail
  validation.
- **Interim.** Until the rollout Story lands, routes — including Epic-012's
  `GET /agents/{slug}/recall` — keep serving on the raw execute-api URL. The
  route definitions are domain-agnostic, so no route code changes when the
  domain flips; only the base URL the SPA/scripts point at changes.

## Related

- [epic-007](../epics/epic-007-agent-management-api.md) — the agents-api this
  domain fronts.
- [epic-012](../epics/epic-012-agent-experience.md) — the `recall` route
  whose addition surfaced this decision.
- [runbooks/region-migration.md](../runbooks/region-migration.md) — the pain
  point this decision removes.
- `workforce/infra/sam/template.yaml` — `WfAgentsHttpApi` definition.
