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

- [x] **Epic-002 v1** — Front-end AuthorChip + agent directory + profile on workforce SPA. *(Zone B)*
- [x] **Epic-006** — Orchestrator tick + post-deploy seed via EventBridge. *(Zone B)*
- [x] **Epic-007** — Agent management API (GET/PATCH/DELETE); DDB seed on stack deploy. *(Zone B)*
- [x] **Epic-008** — Skill repository: skill-runner integration, seed Lambda, `/skills` API routes. *(Zone A/B)*
- [x] **PR-A (monorepo split)** — `apps/article` + `apps/workforce` + `packages/shared`. *(Zone B)*
- [x] **PR-B (hosting)** — `workforce/infra/sam-web/` CloudFront + Cognito + Google sign-in. *(Zone B)*
- [x] **PR-C (cutover)** — Article SPA links to `workforce.kohuehara.xyz`; `WORKFORCE ↗` header link. *(Zone B)*
- [x] **Data plane deployed to prod** — `wf-data-plane-prod` in us-west-2; DDB seeded with 5 agents + 7 skills. *(operator action, no PR)*
- [x] **Workforce SPA live** — `workforce.kohuehara.xyz` serving via CloudFront + Cognito. *(operator action, no PR)*
- [x] **Live API wired** — SPA reads `VITE_WORKFORCE_AGENTS_API_BASE` from repo secret. *(Zone B)*

## Phase 2 — Routine + automation bootstrap

- [x] **discord-ping skill end-to-end (PR #75 → #77)** — Webhook trigger_class, executor=deterministic, Yuki bound to it on `cron(0 0/6 * * ? *)`. *(Zone B)*
- [x] **Skill encapsulation refactor (PR #80)** — Each skill is now a self-contained folder (`workforce/skills/{name}/{SKILL.md, meta.json, handler.ts}`); deterministic handlers auto-registered via `workforce/scripts/build-skill-registry.mjs`. No `lambdas/` edits to add a skill. *(Zone B)*
- [x] **VP tier + 7 new personas (Epic-009, PR #79)** — `workforce/agents/{dario,elena,kai,mira,noor,priya,theo}/`; W-3 cap raised to USD 100/mo. *(Zone B + Zone A for governance amend)*
- [x] **SAM data-plane auto-deploy (PR #81)** — `.github/workflows/deploy-workforce-data-plane.yml` rolls out `wf-data-plane-prod` on push to `main` touching `workforce/{infra/sam,lambdas,skills,agents}/**`. Auth via GitHub OIDC → IAM role assumption (`secrets.AWS_ROLE_ARN`). *(Zone A)*
- [ ] **wf-builder bootstrap** — Add `workforce/README.md`, `workforce/ROADMAP.md`, `workforce/docs/routine-prompt.md`, `.github/workflows/workforce-builder-routine.yml`. Acceptance: `workforce-builder-routine.yml` is mergeable with CI green and the routine-prompt.md captures the full state-machine contract. *(Zone B + Zone A for the workflow)*

## Phase 3 — Discord-ping live + first content cycle

- [ ] **Operator pre-flight** — Confirm `wf/discord-pulse-prod`, `wf/anthropic`, `wf/notion`, `wf/github` exist in Secrets Manager. Confirm repo secret `AWS_ROLE_ARN` is populated and the GitHub OIDC trust policy on that role accepts this repo. *(operator action, no PR)*
- [ ] **Enable orchestrator tick** — Flip `Enabled: false → true` for `wf-orchestrator-tick-prod` in `workforce/infra/sam/template.yaml`. Merge triggers `deploy-workforce-data-plane.yml`, which rolls the change-set out. Acceptance: orchestrator tick fires every 30 minutes in CloudWatch without errors; first `[wf-pulse] yuki alive at ...` appears in Discord within 7h (≤ 6h until the next `0/6` UTC boundary + ≤ 30min until the next tick after that). *(Zone B — SAM template, operator approval required per §5)*
- [ ] **Ren end-to-end smoke-test** — Manually trigger `wf-agent-runner` for Ren with `task_kind=pr` (dry or real). Verify: brief appears in S3 at `pr-briefs/ren/{deliv_id}.md`, `workforce-engineer-routine.yml` is dispatched, draft PR appears, orchestrator poll promotes `DELIV#{id}` to `ok`. Fix any gap. *(Zone B, runbook addition only)*
- [ ] **First live Sora article** — Sora's tick fires (or manual invocation), produces a synthesis, inserts into Notion, GAS L4 picks it up, article appears on `kohuehara.xyz` with `Author=sora` byline and non-empty eval sidecar. Acceptance: `article-health` reports 0 truncated for the new article. *(Zone B)*
- [ ] **wf-builder routine verified** — Confirm at least two consecutive daily `workforce-builder-routine.yml` runs complete without error (either opens a PR or posts "waiting on human merge"). *(Zone B, ROADMAP update only)*

## Phase 4 — Content cadence

- [ ] **Maya hypothesis cadence** — Maya's weekly `hypothesis` task fires, hypothesis article published on `kohuehara.xyz` under Maya byline. *(Zone B)*
- [ ] **Aoi design note** — Aoi's bi-weekly `design` task fires, design note published. *(Zone B)*
- [ ] **Yuki positioning write** — Yuki's bi-weekly `launch` task fires, launch artefact stored in S3 + Notion. *(Zone B)*
- [ ] **Memory compaction** — Implement memory chunk compaction (`memory/{slug}/v{NNNN}.md` → rolling summary). Acceptance: compaction runs without losing agent identity; `memver` monotonic. *(Zone B)*

## Phase 5 — PdM + VP-eng routine bootstrap (Epic-010 driver chain)

Three-PR series that builds the autonomous flow from Epic → epic tracker → child issues → draft PRs → role-scoped reviews. Backs the Epic-010 epics ([#89](https://github.com/refluster/ai-native-article/issues/89) tracker).

- [x] **PR A — Unified binding shape (R-N4 amendment, [#100](https://github.com/refluster/ai-native-article/pull/100))** — Migrate `agent.json:bindings[]` from `{cron, skill}` to `{skill, executor, trigger}`; amend R-N4 in `workforce/docs/governance.md`; add `workforce/docs/runbooks/bindings.md`; update orchestrator + agent-runner + validate-agent-json. *(Zone A: governance + R-N4; Zone B: validator + Lambda + agent.json)*
- [ ] **PR B — Maya `pdm-decompose` Lambda + `pdm-charter` stub** — New skills under `workforce/skills/`; Maya binding `cron(0 22 * * ? *)` (15:00 PDT daily); `PROJECT#workforce-meta` DDB bootstrap runbook; `workforce/docs/runbooks/pdm-decompose.md` state machine doc. *(Zone A: new skills, Rule-11 first version; Zone B: maya/agent.json edit + runbooks)*
- [ ] **PR C — CCR routine specs + Dario / Aoi bindings** — `workforce/docs/routines/{dario-implement,dario-review,aoi-review}.md`; add CCR bindings to Dario + Aoi `agent.json`; operator bootstrap runbook for instantiating routines at claude.ai/code/routines. *(Zone A: new routine specs + bindings, Rule-11 first version; Zone B: runbook)*

## Phase 6 — Dev process codification (post Epic-010 Story 1 retrospective)

- [x] **Codify dev process + persona-agnostic reviewer skills** (PR #112) — Authored `workforce/docs/runbooks/dev-process.md` (canonical seven-phase loop). Added 3 generic, persona-agnostic routine specs (`pr-review.md`, `pr-route.md`, `pr-implement.md`) — persona overlay lives in each agent's `agent.json:bindings[*].config`. Bound Dario / Ren / Aoi / Maya to the generic skills. Marked `pdm-decompose.md` + `ccr-bootstrap.md` label-state-machine sections as superseded. Added `workforce/docs/follow-ups.md` index. *(Zone B docs + bindings)*
- [ ] **Follow-up items from retrospective** — Tracked in [follow-ups.md](docs/follow-ups.md): cycle counter lint, scope-creep enforcement, cross-PR audit, `aws-sdk-client-mock` standardisation, etc.

## RFC-010 rollout

The Project-as-trust-boundary rollout runs as a 6-Story program tracked by [Epic-010 (#89)](https://github.com/refluster/ai-native-article/issues/89). The Epic body in [workforce/docs/epics/epic-010-project-trust-boundary.md](docs/epics/epic-010-project-trust-boundary.md) is the canonical spec; the tracker carries the **decision deltas** that adjust the spec post-confirmation (notably the §9 DDB-brute-force-kNN choice that replaces OpenSearch Serverless and the related drop of the W-3 ceiling raise).

| Story | Issue | Scope | Status |
|---|---|---|---|
| Tracker | [#89](https://github.com/refluster/ai-native-article/issues/89) | Epic-010 rollout tracker, decision deltas, definition of done | open |
| Story 1 | [#90](https://github.com/refluster/ai-native-article/issues/90) | Project as first-class entity, membership, ledger schema (DDB row families + GSI1/GSI2 + dual-write) | closed (merged) |
| Story 2 | [#91](https://github.com/refluster/ai-native-article/issues/91) | Type-keyed credentials + Secrets Manager namespace migration (Story 2-A foundation merged in #119; Story 2-B injector + migration Lambda + fallback metric merged in #125) | open |
| Story 3 | [#92](https://github.com/refluster/ai-native-article/issues/92) | Project-prefixed S3 artefacts + IAM trust boundary (redaction wrapper, cross-project denial at AWS layer) | open |
| Story 4 | [#93](https://github.com/refluster/ai-native-article/issues/93) | Semantic recall via DDB-stored embeddings (brute-force kNN, recall console UI) | open |
| Story 5 | [#94](https://github.com/refluster/ai-native-article/issues/94) | Governance + data-model amendments (this PR series: RFC-010 §9 + Cost impact + ROADMAP) | open |
| Story 6 | [#95](https://github.com/refluster/ai-native-article/issues/95) | Operator project console (UI for project lifecycle, credentials, membership, execution history) | open |

### Status-transition criteria

Epic-010's `Status` flips from `Draft` to `Implemented` only when **all four** of the following hold (per [Epic-010 §Acceptance criteria](docs/epics/epic-010-project-trust-boundary.md#acceptance-criteria) and the tracker's Definition of Done):

1. **Legacy `wf/{type}` keys removed.** Bare Secrets Manager keys (`wf/anthropic`, `wf/github`, `wf/notion`, …) are deleted after the `WfLegacyCredentialReads` CloudWatch metric, filtered to `Reason=fallback_bare`, has stayed at zero for ≥ 1 week. (Story 2-B ships the metric with two dimensions, `Reason=fallback_default` and `Reason=fallback_bare`; only the latter signals a remaining bare-key reader. The `fallback_default` dimension is expected to be non-zero in steady state — every project that hasn't shadowed a credential reads from `_default` and ticks the metric.) Tracked as a Story 2 follow-up PR; gated on Story 6 readiness so the credential vault UI is the only write surface.
2. **Dual-write window closed.** Legacy `AGENT#{slug}/RUN#{ulid}` and `AGENT#{slug}/DELIV#{ulid}` writes from Story 1 are removed in a single cutover PR. Gated on the front-end having migrated (criterion 3) so the agent-profile view does not break.
3. **Front-end agent profile migrated to the `EXEC` row family.** The `/workforce/agents/:slug` page reads exclusively from `PROJECT#{id}/EXEC#{ulid}` (via the GSI1 `AGENT#{slug}` query), not from the legacy `RUN`/`DELIV` rows. Lands in Story 6's PR series.
4. **`article-health`-equivalent audit is clean.** A workforce-side audit (0 truncated executions, 0 orphaned `EXEC` rows, 0 cross-project leakage detections) runs green for ≥ 1 week post-cutover. The audit skill itself is tracked as [FU-021](docs/follow-ups.md) and must land before this criterion can flip.

The criteria are intentionally ordered: 2 blocks on 3, and 1 blocks on Story 6's vault UI. The Epic stays in `Draft` until the slowest of the three closes.

## Phase 7 — Multi-project PR review (Epic-010 application)

Apply the Epic-010 trust boundary — Story 1 helpers, Story 2 type-keyed credentials, Story 3 IAM prefix — to enable workforce review against **external repositories**. Each external repo is a `PROJECT#{id}` with its own GitHub PAT, membership list, and execution ledger. The workforce stays centralised (single Lambda runner); target repos remain untouched. Complementary to the RFC-010 Story program above: Stories 1–6 build the trust boundary; Phase 7 puts the first non-`self` consumer (Nadia + reviewer chain on external PRs) on top of it.

- [x] **PR1 — Project plane** ([#141](https://github.com/refluster/ai-native-article/pull/141)) — `workforce/projects/{id}/project.json` file convention + `workforce:projects` validator + `workforce:projects:seed` operator script + `workforce/docs/runbooks/external-project-onboarding.md` + first project `asp-cloud` (`PSVL/asp-cloud`). *(Zone A: schema + runbook; Zone B: validator + seed script + first project file)*
- [x] **PR2 — Nadia PdM lens** ([#141](https://github.com/refluster/ai-native-article/pull/141)) — `pr-review` (lens=product) and `pr-route` (PdM nomination_rules) bindings on Nadia; cross-project-mode section added to both routine specs; `prompt_version` 0.2.0. (Skill packages + handlers split off to PR3a / PR3b per the actual implementation sequence.) *(Zone A: routine spec edits; Zone B: Nadia agent.json + system.md)*
- [ ] **PR3a — Lambda routing path + pr-route handler** — R-N4 amendment to allow `executor=lambda` with `scheduler=external|manual`; agent-runner extension to forward `project_id` + `args` + `binding_config` to deterministic handlers + track LLM cost (Phase 7 PR3a RunnerContext widening); `workforce/skills/pr-route/{SKILL.md,meta.json,handler.ts}` — Lambda-resident cycle-1 routing handler (Anthropic SDK → GitHub REST → routing-comment POST). Switch Nadia's `pr-route` binding to `executor=lambda`. SAM IAM grant on `wf/projects/*` already in place via Story 2-B. *(Zone A: R-N4 amendment + first SKILL.md per Rule-11; Zone B: validator update + runner extension + handler + Nadia binding)*
- [ ] **PR3b — pr-review handler + verdict mode** — `workforce/skills/pr-review/{SKILL.md,meta.json,handler.ts}` — Lambda-resident reviewer handler (persona-agnostic; lens overlay from binding_config). Verdict mode extension to pr-route handler — read each reviewer's review against cycle-1 findings, post 🟢/🟡/🔴 verdict comment. Switch Nadia's `pr-review` binding to `executor=lambda`. Add `pr-review` bindings to Dario / Ren / Aoi pointing at the same generic skill with their lens configs. Integration test mocking GitHub REST + Anthropic + `getProject` + bundled `agents/{slug}/system.md` for the full `dispatchPrRoute` and `dispatchPrReview` flows. *(Zone A: first SKILL.md per Rule-11; Zone B: handlers + tests + Dario/Ren/Aoi binding additions)*
- [ ] **PR4 — First end-to-end run** — Trigger `pr-route` against a `PSVL/asp-cloud` PR; verify routing comment + reviewer-persona reviews + verdict comment all land on the target PR; ledger audit (FU-021) reports 0 truncated, 0 cross-project leakage. *(operator action, no PR)*
- [ ] **PR5 — Webhook trigger surface (external → workforce)** — API GW HTTP endpoint at `wf-webhook-{stage}` receiving GitHub webhooks (`pull_request.opened`, `pull_request.synchronize`, `issue_comment.created`) from external projects' Claude GitHub App installations. Webhook Lambda: signature validation (HMAC-SHA256 with per-project secret stored at `wf/projects/{id}/github.webhook_secret`), reverse-map `(owner, repo) → project_id` against `PROJECT#*/META.github`, enqueue TASK row, async-invoke agent-runner. Defaults: PR-opened on a `PROJECT#{id}` member-of `nadia` auto-fires Nadia's `pr-route` (consistent with the existing dispatch). *(Zone A: new API GW + webhook spec; Zone B: webhook Lambda + IAM + project schema extension for webhook_secret)*
- [ ] **PR6 — `external-pr` deliverable type + R-N9 enforcement** — Skill `meta.json:deliverable.type` schema gains `external-pr` (and only `external-pr` — `external-commit` does not exist by design, per R-N9). New `workforce/lambdas/shared/external-pr.ts` helper opens a PR against the project's target repo using `Pull requests:write` PAT scope; PR body cites `(agent, skill, run_id)`. Branch namespace: `workforce/{agent}/{run_id}` so the external maintainer can install branch-protection rules that exclude this namespace from CI gates without affecting their own branches. *(Zone A: deliverable type schema + governance R-N9 [if not already merged]; Zone B: helper + runner side-effect dispatch)*
- [ ] **PR7 — `@kohuehara/workforce-client` external-repo package** — Drop-in package for external repos that immediately gives them access to the workforce. Ship as either an npm package (`npm i -D @kohuehara/workforce-client`) or a Claude Code plugin marketplace entry, providing: (a) `.claude/skills/wf-{persona}-{skill}/` skill descriptors that surface as Claude Code skills in the external repo's session (operator-conversational trigger), (b) `wf-cli` binary for shell-script / CI triggering, (c) protocol translation between common external event shapes (GitHub PR webhooks, GitLab MR, etc.) and the workforce's `{persona, skill, project_id, args}` envelope, (d) a `.workforce/project.json` mirror that pairs with the workforce-side seed file. Auth: per-project bearer token issued out-of-band by the workforce operator. *(Distribution decision Zone A; package contents Zone B)*
