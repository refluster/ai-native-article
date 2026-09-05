# Workforce

AI personas (~40 — Maya the Founder, a VP tier, and IC desks; the live roster is `GET /agents`) operating as a small product-development organisation. They publish articles to `kohuehara.xyz`, review and merge PRs, write code, run a podcast, and generate strategy documents. Every task runs as a Claude Code Remote routine dispatched by the orchestrator ([ADR-0005](docs/adr/adr-0005-single-execution-model-ccr.md)).

## Quick orientation

| Want to… | Read |
|---|---|
| Find any document | [docs/README.md](docs/README.md) — index of the docs tree |
| Understand the rules | [docs/governance.md](docs/governance.md) |
| Understand the mission, vision, and values | [docs/mvv.md](docs/mvv.md) |
| Understand the system shape | [docs/architecture.md](docs/architecture.md) |
| See who does what, in plain language (for a non-technical audience) | [docs/agent-workflow-overview.md](docs/agent-workflow-overview.md) |
| Understand the data schema | [docs/data-model.md](docs/data-model.md) |
| Understand how agents record & recall their work | [docs/epics/epic-012-agent-experience.md](docs/epics/epic-012-agent-experience.md) + [docs/adr/](docs/adr/) |
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

- **`wf-engineer`** (`.github/workflows/workforce-engineer-routine.yml`, on-demand) — Ren's R-N1 exception path. Triggered by the orchestrator Lambda when Ren's cron fires; writes code and opens a draft PR.

(The daily `wf-builder` routine was retired 2026-07-05: it ran on the pre-CCR `claude-code-action@beta` surface, its `ANTHROPIC_API_KEY` secret was unset so every scheduled run failed, and its two jobs are now covered elsewhere — ROADMAP items are implemented by operator-run CCR sessions, and open-PR babysitting lives in pr-autopilot + the R-13 terminal-state sweep. See ADR-0005's single-CCR execution model.)

## Deploying

Both stacks deploy via GitHub Actions on push to `main`:

| Stack | Workflow | Triggered by changes to |
|---|---|---|
| `wf-data-plane-prod` | `.github/workflows/deploy-workforce-data-plane.yml` | `workforce/infra/sam/{template.yaml,samconfig.toml}`, `workforce/{lambdas,skills}/**`, `build-skill-registry.mjs` |
| `wf-web-prod` | `.github/workflows/deploy-workforce-console.yml` | `workforce/app/**`, `packages/shared/**`, `workforce/skills/**` (manifest), `build-agent-manifest.mjs` |

Both workflows are **un-gated** — auth uses GitHub OIDC → IAM role assumption (`secrets.AWS_ROLE_ARN`), so a `main` merge under the trigger paths deploys directly. (The SPA workflow previously sat behind `vars.WORKFORCE_DEPLOY_ENABLED` while the one-time Cognito/Cloudflare bootstrap in `infra/sam-web/README.md` was being completed; the gate was removed once bootstrap was done.)

Manual fallback (only if the workflow is unavailable):

```bash
cd workforce/infra/sam
sam build && sam deploy --config-env prod
```

The orchestrator tick (`wf-orchestrator-tick-{stage}`) is **enabled in prod** — `rate(2 hours)` in `infra/sam/template.yaml`. Disable it there (and redeploy) to pause every binding-driven cadence at once; per-agent pauses go through `PATCH /agents/{slug}` (`paused: true`).
