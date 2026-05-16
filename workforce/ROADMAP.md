# Workforce build roadmap

This file is consumed by the daily `workforce-builder` Claude routine. The routine reads top to bottom, finds the first un-checked PR, and works on it.

**Sequencing rule.** Each PR depends on the previous. Don't skip ahead. If PR(n) is still open and CI is green, the routine stops and waits for human merge — that's C-3 working as designed.

**Routine prompt is in** [`docs/routine-prompt.md`](docs/routine-prompt.md) (created in PR1 alongside this file, kept stable so the routine has a fixed contract).

---

## PR1 — scaffold + AGENTS.md zones

- [x] Create `workforce/` directory tree
- [x] Empty SAM template skeleton (`workforce/infra/sam/template.yaml`)
- [x] Stub Lambda handlers (5 functions, each returns a placeholder)
- [x] Update [`AGENTS.md`](../AGENTS.md) with workforce zone classifications
- [x] Create this `ROADMAP.md`
- [x] Open PR `chore(workforce): scaffold + AGENTS.md zones`

**Status:** Hand-authored in initial session (not by routine). Awaiting human merge.

---

## PR2 — data plane

- [ ] DynamoDB tables in SAM template: `WorkforceCore`, `Chat`, `Memory` (per plan §2.1)
- [ ] S3 bucket `wf-{account}-{region}` with versioning + lifecycle
- [ ] IAM: `agents-api` read/write `WorkforceCore` + `Memory`, S3 read; `seed` write all
- [ ] `lambdas/shared/ddb.ts` — typed DDB client
- [ ] `lambdas/shared/s3.ts` — S3 client
- [ ] `lambdas/shared/memory-store.ts` — Managed-Agents-shape memory FS over DDB+S3 with `memver` conditional writes
- [ ] `lambdas/seed/handler.ts` — idempotent load of `agents/` + `skills/` directories into DDB+S3
- [ ] `lambdas/agents-api/handler.ts` — GET /agents, GET /agents/{slug}, GET /skills, GET /skills/{name}, GET /agents/{slug}/deliverables, GET /agents/{slug}/runs
- [ ] Smoke: `sam deploy` to a dev stack, invoke `seed` (no-op, empty registry), verify zero items in DDB
- [ ] Open PR `feat(workforce): data plane`

---

## PR3a — seed agents v0

- [ ] `agents/pm/{agent.json, system.md}` — Product Manager (model: `azure:gpt-5.4`)
- [ ] `agents/eng/{agent.json, system.md}` — Senior Engineer
- [ ] `agents/design/{agent.json, system.md}` — Product Designer
- [ ] `agents/devops/{agent.json, system.md}` — DevOps / SRE
- [ ] `agents/cs/{agent.json, system.md}` — Customer Success
- [ ] `agents/skillops/{agent.json, system.md}` — SkillOps Manager
- [ ] Avatars (procedurally generated initials → SVG, no third-party images)
- [ ] JSON Schema for `agent.json` + CI check (`workforce/scripts/validate-agents.mjs`)
- [ ] Smoke: invoke `seed` → 6 AGENT#META rows in `WorkforceCore`
- [ ] Open PR `feat(workforce): seed agents v0`

**Rule 11 binding.** Each `agent.json` carries a system prompt; per AGENTS.md §2 rule 11, multiple prompt-version bumps in one PR break attribution. v0 is the first version of every prompt — that's a single bulk-load event, not 6 bumps — so this can ship as one PR. Subsequent prompt changes must split.

---

## PR3b — seed skills v0

- [ ] `skills/retro-summarizer/SKILL.md`
- [ ] `skills/pr-watcher/SKILL.md`
- [ ] `skills/ticket-triage/SKILL.md`
- [ ] `skills/doc-drift-scan/SKILL.md`
- [ ] `skills/design-token-audit/SKILL.md`
- [ ] `skills/incident-postmortem/SKILL.md`
- [ ] `skills/cost-snapshot/SKILL.md`
- [ ] `skills/skill-improver/SKILL.md` (owned by `skillops`)
- [ ] Skill→agent assignment table in `seed/assignments.yaml`
- [ ] JSON Schema for SKILL.md frontmatter + CI check
- [ ] Smoke: invoke `seed` → 8 SKILL#META rows + N AGENT#SKILL# link rows
- [ ] Open PR `feat(workforce): seed skills v0`

---

## PR4 — chat-api with streaming

- [ ] `lambdas/shared/llm-router.ts` — `routeChat({ model, system, messages })` dispatches to Azure OpenAI or Anthropic based on the `model:` prefix in `agent.json`
- [ ] `lambdas/shared/secrets.ts` — Secrets Manager loader, cached at warm-start
- [ ] `lambdas/chat-api/handler.ts` — `POST /chat/{slug}` with Lambda response streaming (AWS_PROXY HTTP API)
- [ ] `Chat` DDB table CRUD (thread + messages)
- [ ] CORS: lock to `https://kohuehara.xyz` and `https://api.kohuehara.xyz`
- [ ] API-key header check on `/chat/*` (Secrets Manager-issued, also baked into `VITE_WORKFORCE_API_KEY`)
- [ ] Smoke: `curl https://api.kohuehara.xyz/chat/pm -d '{"msg":"hi"}'` streams back
- [ ] Open PR `feat(workforce): chat-api + streaming`

---

## PR5 — directory + profile + chat UI

- [ ] `src/pages/workforce/Directory.tsx` — 3/2/1-col swiss grid of agent cards
- [ ] `src/pages/workforce/Profile.tsx` — LinkedIn-style profile (header / JD / skills / deliverables / start-chat CTA)
- [ ] `src/pages/workforce/Chat.tsx` — streaming chat UI
- [ ] `src/components/workforce/{AgentCard,DeliverableFeed,ChatStream}.tsx`
- [ ] `src/lib/workforce-api.ts` — APIGW client with streaming reader
- [ ] Add 3 routes to [`src/App.tsx`](../src/App.tsx)
- [ ] Add `WORKFORCE` nav item to [`src/components/Header.tsx`](../src/components/Header.tsx) `publicNav`
- [ ] Token-lint clean (no raw hex, no `rounded-md|lg|xl|…`)
- [ ] Visual verification: `npm run dev`, click through all 3 routes, send a chat message, see streaming response
- [ ] Open PR `feat(workforce): directory + profile + chat UI`

---

## PR6 — task-runner + skill-ops weekly

- [ ] `lambdas/task-runner/handler.ts` — EventBridge-triggered; resolves agent's skills, invokes LLM, writes Deliverable (DDB + S3), updates memory `INDEX.md`
- [ ] Per-agent EventBridge rule generated from `agent.json` `metadata.schedule` (cron)
- [ ] Per-agent daily token budget enforcement (mirror `docs/azure-budget-rules.md`)
- [ ] `lambdas/skill-ops-reviewer/handler.ts` — weekly Monday 14:00 UTC; aggregates GSI1 runs per skill, drafts SKILL.md improvements, opens GitHub PR via `workforce/github` PAT
- [ ] CloudWatch billing alarm @ $30/mo
- [ ] DELIV row appears after manual `task-runner` invoke for `pm`
- [ ] Open PR `feat(workforce): task-runner + skill-ops weekly`

---

## Post-PR6 — operations

- [ ] Schedule `workforce-skillops-weekly` routine (Mon 14:00 UTC, see plan §6)
- [ ] First weekly SkillOps PR auto-opens and waits for human merge
- [ ] Move `workforce-builder` daily routine to "on-demand" (or delete) — initial build complete
