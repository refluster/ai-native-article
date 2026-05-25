# Workforce — ROADMAP

Checklist of implementation milestones. The daily `wf-builder` routine reads this file and implements the next unchecked item, one PR at a time.

**Rules:**
- One `[ ]` item per PR. Mark `[x]` only after the PR merges to `main`.
- Each item briefly states what to build, the acceptance criterion, and the Zone classification of the affected files.
- The `wf-builder` routine NEVER merges PRs; it only opens them.

---

## Phase 0 — Foundation (complete)

- [x] **PR1** — Governance scaffold: `workforce/docs/governance.md`, `architecture.md`, `data-model.md`, `naming.md`; AGENTS.md zone table extended. *(Zone A docs)*
- [x] **PR2** — Persona definitions: `workforce/agents/{sora,maya,ren,aoi,yuki}/{agent.json,system.md}`. First version (Rule-11 exception). *(Zone A/B)*
- [x] **PR3** — Skill repository: `workforce/skills/*/SKILL.md` + `meta.json` for 7 pilot skills. First version (Rule-11 exception). *(Zone A)*
- [x] **PR4** — Data plane SAM: `workforce/infra/sam/template.yaml` — DDB single-table, S3 bucket, SNS alarm topic, AWS Budget. *(Zone B)*
- [x] **PR5** — agents-api + seed Lambdas: `workforce/lambdas/agents-api/`, `seed-agents/`, `seed-skills/`; SAM wired. *(Zone B)*
- [x] **PR6** — Orchestrator + agent-runner: `workforce/lambdas/orchestrator/`, `agent-runner/`, shared libs. *(Zone B)*
- [x] **PR12** — Ren's Claude Code routine path (R-N1 exception): `dispatchPrPath()`, `workforce-engineer-routine.yml` workflow. *(Zone A/B)*

## Phase 1 — Live surface (complete)

- [x] **RFC-002 v1** — Front-end AuthorChip + agent directory + profile on workforce SPA. *(Zone B)*
- [x] **RFC-006** — Orchestrator tick + post-deploy seed via EventBridge. *(Zone B)*
- [x] **RFC-007** — Agent management API (GET/PATCH/DELETE); DDB seed on stack deploy. *(Zone B)*
- [x] **RFC-008** — Skill repository: skill-runner integration, seed Lambda, `/skills` API routes. *(Zone A/B)*
- [x] **PR-A (monorepo split)** — `apps/article` + `apps/workforce` + `packages/shared`. *(Zone B)*
- [x] **PR-B (hosting)** — `workforce/infra/sam-web/` CloudFront + Cognito + Google sign-in. *(Zone B)*
- [x] **PR-C (cutover)** — Article SPA links to `workforce.kohuehara.xyz`; `WORKFORCE ↗` header link. *(Zone B)*
- [x] **Data plane deployed to prod** — `wf-data-plane-prod` in ap-northeast-1; DDB seeded with 5 agents + 7 skills. *(operator action, no PR)*
- [x] **Workforce SPA live** — `workforce.kohuehara.xyz` serving via CloudFront + Cognito. *(operator action, no PR)*
- [x] **Live API wired** — SPA reads `VITE_WORKFORCE_AGENTS_API_BASE` from repo secret. *(Zone B)*

## Phase 2 — Routine + automation bootstrap

- [x] **discord-ping skill end-to-end (PR #75 → #77)** — Webhook trigger_class, executor=deterministic, Yuki bound to it on `cron(0 0/6 * * ? *)`. *(Zone B)*
- [x] **Skill encapsulation refactor (PR #80)** — Each skill is now a self-contained folder (`workforce/skills/{name}/{SKILL.md, meta.json, handler.ts}`); deterministic handlers auto-registered via `workforce/scripts/build-skill-registry.mjs`. No `lambdas/` edits to add a skill. *(Zone B)*
- [x] **VP tier + 7 new personas (RFC-009, PR #79)** — `workforce/agents/{dario,elena,kai,mira,noor,priya,theo}/`; W-3 cap raised to USD 100/mo. *(Zone B + Zone A for governance amend)*
- [x] **SAM data-plane auto-deploy (PR #81)** — `.github/workflows/deploy-workforce-data-plane.yml` rolls out `wf-data-plane-prod` on push to `main` touching `workforce/{infra/sam,lambdas,skills,agents}/**`. Gated by `vars.WORKFORCE_SAM_DEPLOY_ENABLED`. *(Zone A)*
- [ ] **wf-builder bootstrap** — Add `workforce/README.md`, `workforce/ROADMAP.md`, `workforce/docs/routine-prompt.md`, `.github/workflows/workforce-builder-routine.yml`. Acceptance: `workforce-builder-routine.yml` is mergeable with CI green and the routine-prompt.md captures the full state-machine contract. *(Zone B + Zone A for the workflow)*

## Phase 3 — Discord-ping live + first content cycle

- [ ] **Operator pre-flight + flip `WORKFORCE_SAM_DEPLOY_ENABLED`** — Confirm `wf/discord-pulse-prod`, `wf/anthropic`, `wf/notion`, `wf/github` exist in Secrets Manager. Confirm repo secret `AWS_ROLE_ARN` is populated and the GitHub OIDC trust policy on that role accepts this repo. Flip `vars.WORKFORCE_SAM_DEPLOY_ENABLED = true`. *(operator action, no PR)*
- [ ] **Enable orchestrator tick** — Flip `Enabled: false → true` for `wf-orchestrator-tick-prod` in `workforce/infra/sam/template.yaml`. Merge triggers `deploy-workforce-data-plane.yml`, which rolls the change-set out. Acceptance: orchestrator tick fires every 30 minutes in CloudWatch without errors; first `[wf-pulse] yuki alive at ...` appears in Discord within 7h (≤ 6h until the next `0/6` UTC boundary + ≤ 30min until the next tick after that). *(Zone B — SAM template, operator approval required per §5)*
- [ ] **Ren end-to-end smoke-test** — Manually trigger `wf-agent-runner` for Ren with `task_kind=pr` (dry or real). Verify: brief appears in S3 at `pr-briefs/ren/{deliv_id}.md`, `workforce-engineer-routine.yml` is dispatched, draft PR appears, orchestrator poll promotes `DELIV#{id}` to `ok`. Fix any gap. *(Zone B, runbook addition only)*
- [ ] **First live Sora article** — Sora's tick fires (or manual invocation), produces a synthesis, inserts into Notion, GAS L4 picks it up, article appears on `kohuehara.xyz` with `Author=sora` byline and non-empty eval sidecar. Acceptance: `article-health` reports 0 truncated for the new article. *(Zone B)*
- [ ] **wf-builder routine verified** — Confirm at least two consecutive daily `workforce-builder-routine.yml` runs complete without error (either opens a PR or posts "waiting on human merge"). *(Zone B, ROADMAP update only)*

## Phase 4 — Content cadence

- [ ] **Maya hypothesis cadence** — Maya's weekly `hypothesis` task fires, hypothesis article published on `kohuehara.xyz` under Maya byline. *(Zone B)*
- [ ] **Aoi design note** — Aoi's bi-weekly `design` task fires, design note published. *(Zone B)*
- [ ] **Yuki positioning write** — Yuki's bi-weekly `launch` task fires, launch artefact stored in S3 + Notion. *(Zone B)*
- [ ] **Memory compaction** — Implement memory chunk compaction (`memory/{slug}/v{NNNN}.md` → rolling summary). Acceptance: compaction runs without losing agent identity; `memver` monotonic. *(Zone B)*

## Phase 5 — PdM + VP-eng routine bootstrap (RFC-010 driver chain)

Three-PR series that builds the autonomous flow from RFC → epic tracker → child issues → draft PRs → role-scoped reviews. Backs the RFC-010 epics ([#89](https://github.com/refluster/ai-native-article/issues/89) tracker).

- [ ] **PR A — Unified binding shape (R-N4 amendment)** — Migrate `agent.json:bindings[]` from `{cron, skill}` to `{skill, executor, trigger}`; amend R-N4 in `workforce/docs/governance.md`; add `workforce/docs/runbooks/bindings.md`; update orchestrator + agent-runner + validate-agent-json. *(Zone A: governance + R-N4; Zone B: validator + Lambda + agent.json)*
- [ ] **PR B — Maya `pdm-decompose` Lambda + `pdm-charter` stub** — New skills under `workforce/skills/`; Maya binding `cron(0 22 * * ? *)` (15:00 PDT daily); `PROJECT#workforce-meta` DDB bootstrap runbook; `workforce/docs/runbooks/pdm-decompose.md` state machine doc. *(Zone A: new skills, Rule-11 first version; Zone B: maya/agent.json edit + runbooks)*
- [ ] **PR C — CCR routine specs + Dario / Aoi bindings** — `workforce/docs/routines/{dario-implement,dario-review,aoi-review}.md`; add CCR bindings to Dario + Aoi `agent.json`; operator bootstrap runbook for instantiating routines at claude.ai/code/routines. *(Zone A: new routine specs + bindings, Rule-11 first version; Zone B: runbook)*
