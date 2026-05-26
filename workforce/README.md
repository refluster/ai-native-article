# Workforce

AI personas (12 as of RFC-009 — Maya the Founder, the VP tier, and IC contributors) operating as a small product-development organisation. They publish articles to `kohuehara.xyz`, write code via GitHub Actions, and generate strategy documents.

## Quick orientation

| Want to… | Read |
|---|---|
| Understand the rules | [docs/governance.md](docs/governance.md) |
| Understand the system shape | [docs/architecture.md](docs/architecture.md) |
| Understand the data schema | [docs/data-model.md](docs/data-model.md) |
| Know the naming convention | [docs/naming.md](docs/naming.md) |
| See what's next / what's done | [ROADMAP.md](ROADMAP.md) |
| Recover from a stuck Ren PR | [docs/runbooks/engineer-pr-timeout.md](docs/runbooks/engineer-pr-timeout.md) |
| Move the data plane to a new AWS region | [docs/runbooks/region-migration.md](docs/runbooks/region-migration.md) |

## Infrastructure

| Stack | Region | Purpose |
|---|---|---|
| `wf-data-plane-prod` | us-west-2 | DDB, S3, seed Lambdas, orchestrator, agent-runner, agents-api |
| `wf-web-prod` | us-west-2 | CloudFront + S3 hosting for workforce.kohuehara.xyz |
| `wf-web-cert-prod` | us-east-1 | ACM certificate (CloudFront requires us-east-1) |

## Adding a skill

Each skill is a self-contained folder under `workforce/skills/{name}/`:

```
workforce/skills/{name}/
  SKILL.md      ← Anthropic Agent Skills compatible (frontmatter: name + description)
  meta.json     ← workforce-internal sidecar (executor, version, owners, deliverable)
  handler.ts    ← deterministic executor only — auto-registered, no lambdas/ edits
```

`workforce/scripts/build-skill-registry.mjs` scans the folder tree at build time and emits `workforce/lambdas/shared/skill-registry-generated.ts`. CI's `workforce:skill-registry:check` asserts the committed generated file is in sync. See [docs/architecture.md §Skill bundle convention](docs/architecture.md#skill-bundle-convention) for the full contract.

## Daily automation

Two recurring Claude Code routines keep the workforce running:

- **`wf-builder`** (`.github/workflows/workforce-builder-routine.yml`, daily) — implements the next unchecked item from `ROADMAP.md` and opens a draft PR. See [docs/routine-prompt.md](docs/routine-prompt.md) for the full contract.
- **`wf-engineer`** (`.github/workflows/workforce-engineer-routine.yml`, on-demand) — Ren's R-N1 exception path. Triggered by the orchestrator Lambda when Ren's cron fires; writes code and opens a draft PR.

## Deploying

Both stacks deploy via GitHub Actions on push to `main`:

| Stack | Workflow | Triggered by changes to |
|---|---|---|
| `wf-data-plane-prod` | `.github/workflows/deploy-workforce-data-plane.yml` | `workforce/{infra/sam,lambdas,skills,agents}/**` |
| `wf-web-prod` | `.github/workflows/deploy-workforce-console.yml` | `apps/workforce/**`, `packages/shared/**`, `workforce/agents/**` (manifest) |

The SPA workflow is gated by `vars.WORKFORCE_DEPLOY_ENABLED = true` (legacy; the SPA bootstrap requires manual one-time Cognito/Cloudflare setup before CI can take over — see `infra/sam-web/README.md`). The data-plane workflow is **un-gated** — auth uses GitHub OIDC → IAM role assumption (`secrets.AWS_ROLE_ARN`), so a `main` merge under the trigger paths deploys directly.

Manual fallback (only if the workflow is unavailable):

```bash
cd workforce/infra/sam
sam build && sam deploy --config-env prod
```

The orchestrator tick rule defaults to `Enabled: false`. Flip it explicitly in `workforce/infra/sam/template.yaml` once the pre-flight checklist in [docs/runbooks/engineer-pr-timeout.md §Prevention](docs/runbooks/engineer-pr-timeout.md#prevention-checklist) is complete; the SAM deploy workflow will roll it out automatically.
