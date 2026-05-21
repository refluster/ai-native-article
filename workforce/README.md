# Workforce

Five AI personas — **Sora** (Researcher/Analyst), **Maya** (PM/Founder), **Ren** (Engineer), **Aoi** (Designer), **Yuki** (GTM/Customer) — operating as a small product-development organisation. They publish articles to `kohuehara.xyz`, write code via GitHub Actions, and generate strategy documents.

## Quick orientation

| Want to… | Read |
|---|---|
| Understand the rules | [docs/governance.md](docs/governance.md) |
| Understand the system shape | [docs/architecture.md](docs/architecture.md) |
| Understand the data schema | [docs/data-model.md](docs/data-model.md) |
| Know the naming convention | [docs/naming.md](docs/naming.md) |
| See what's next / what's done | [ROADMAP.md](ROADMAP.md) |
| Recover from a stuck Ren PR | [docs/runbooks/engineer-pr-timeout.md](docs/runbooks/engineer-pr-timeout.md) |

## Infrastructure

| Stack | Region | Purpose |
|---|---|---|
| `wf-data-plane-prod` | ap-northeast-1 | DDB, S3, seed Lambdas, orchestrator, agent-runner, agents-api |
| `wf-web-prod` | us-west-2 | CloudFront + S3 hosting for workforce.kohuehara.xyz |
| `wf-web-cert-prod` | us-east-1 | ACM certificate (CloudFront requires us-east-1) |

## Daily automation

Two recurring Claude Code routines keep the workforce running:

- **`wf-builder`** (`.github/workflows/wf-builder.yml`, daily) — implements the next unchecked item from `ROADMAP.md` and opens a draft PR. See [docs/routine-prompt.md](docs/routine-prompt.md) for the full contract.
- **`wf-engineer`** (`.github/workflows/wf-engineer.yml`, on-demand) — Ren's R-N1 exception path. Triggered by the orchestrator Lambda when Ren's cron fires; writes code and opens a draft PR.

## Deploying

```bash
# Data plane (Lambdas, DDB, S3, orchestrator tick)
cd workforce/infra/sam
sam build && sam deploy --config-env prod

# Workforce SPA
cd workforce/infra/sam-web
sam build && sam deploy --config-env prod
# or: gh workflow run deploy-workforce.yml
```

The orchestrator tick rule defaults to `Enabled: false`. Flip it explicitly once the pre-flight checklist in [docs/runbooks/engineer-pr-timeout.md §Prevention](docs/runbooks/engineer-pr-timeout.md#prevention-checklist) is complete.
