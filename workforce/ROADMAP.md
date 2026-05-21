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
- [x] **PR12** — Ren's Claude Code routine path (R-N1 exception): `dispatchPrPath()`, `wf-engineer.yml` workflow. *(Zone A/B)*

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

## Phase 2 — Routine bootstrap (current)

- [ ] **wf-builder bootstrap** — Add `workforce/README.md`, `workforce/ROADMAP.md`, `workforce/docs/routine-prompt.md`, `.github/workflows/wf-builder.yml`. Acceptance: `wf-builder.yml` is mergeable with CI green and the routine-prompt.md captures the full state-machine contract. *(Zone B + Zone A for the workflow)*

## Phase 3 — First live agents

- [ ] **Enable orchestrator tick** — Flip `Enabled: false → true` for `wf-orchestrator-tick-prod` in `workforce/infra/sam/template.yaml`. Pre-flight: Secrets Manager has `wf/anthropic`, `wf/notion`, `wf/github`; Ren pre-flight checklist in `runbooks/engineer-pr-timeout.md` is complete. Acceptance: orchestrator tick fires every 5 min in CloudWatch without errors. *(Zone B — SAM template, operator approval required per §5)*
- [ ] **Ren end-to-end smoke-test** — Manually trigger `wf-agent-runner` for Ren with `task_kind=pr` (dry or real). Verify: brief appears in S3 at `pr-briefs/ren/{deliv_id}.md`, `wf-engineer.yml` is dispatched, draft PR appears, orchestrator poll promotes `DELIV#{id}` to `ok`. Fix any gap. *(Zone B, runbook addition only)*
- [ ] **First live Sora article** — Sora's tick fires (or manual invocation), produces a weekly synthesis, inserts into Notion, GAS L4 picks it up, article appears on `kohuehara.xyz` with `Author=sora` byline and non-empty eval sidecar. Acceptance: `article-health` reports 0 truncated for the new article. *(Zone B)*
- [ ] **wf-builder routine verified** — Confirm at least two consecutive daily `wf-builder.yml` runs complete without error (either opens a PR or posts "waiting on human merge"). *(Zone B, ROADMAP update only)*

## Phase 4 — Content cadence

- [ ] **Maya hypothesis cadence** — Maya's weekly `hypothesis` task fires, hypothesis article published on `kohuehara.xyz` under Maya byline. *(Zone B)*
- [ ] **Aoi design note** — Aoi's bi-weekly `design` task fires, design note published. *(Zone B)*
- [ ] **Yuki positioning write** — Yuki's bi-weekly `launch` task fires, launch artefact stored in S3 + Notion. *(Zone B)*
- [ ] **Memory compaction** — Implement memory chunk compaction (`memory/{slug}/v{NNNN}.md` → rolling summary). Acceptance: compaction runs without losing agent identity; `memver` monotonic. *(Zone B)*
