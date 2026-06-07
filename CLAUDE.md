# CLAUDE.md — orientation for agents

You are working in `ai-native-article`, a personal blog/insight site at `https://kohuehara.xyz`. The repo is split into two domain modules: **`newsletter/`** — this site's L1→L4 article pipeline (`newsletter/app` reader SPA + `newsletter/gas` Apps Script engine + `newsletter/pipeline` build/sync scripts + `newsletter/docs`) — and **`workforce/`** — the agent organisation (`workforce/app` console + `agents/`, `skills/`, `lambdas/`, `infra/`). The **newsletter is one of the activities the workforce performs**: agents author articles into it via the `workforce/skills/article-level2` and `article-level3` skills, alongside the GAS cron. Cross-cutting governance/QA docs stay at root `docs/`; `packages/shared` is shared by both apps.

Articles flow through a 4-stage pipeline: web sources → Notion blog drafts → Notion synthesis → published markdown. Most automation lives in **Google Apps Script** (`newsletter/gas/src/Code.gs`); the reader-facing site is a Vite/React SPA built from Notion content at deploy time.

## Read these before editing

In priority order — every agent should know all four:

1. **[docs/governance.md](docs/governance.md)** — the rules. 4-layer hierarchy (L0 invariants → L1 framework → L2 mechanical → L3 operational), action-authority matrix (what an agent does autonomously vs. escalates), and the single most important constraint for this project: **C-2, Notion is the source of truth.**
2. **[newsletter/docs/architecture-source-of-truth.md](newsletter/docs/architecture-source-of-truth.md)** — *where* article content lives and which copies are stale. Reading this once will save you the hour I lost on the L2 truncation fix.
3. **[newsletter/docs/L1-L4-PIPELINE.md](newsletter/docs/L1-L4-PIPELINE.md)** — what each stage does, the daily cron schedule, and the operator runbooks for the common "something is broken on the site" cases.
4. **[newsletter/docs/azure-budget-rules.md](newsletter/docs/azure-budget-rules.md)** — the 3-bracket sizing rule for `azureGenerateText`. The L2 truncation bug existed because this rule wasn't documented; don't reintroduce it.

If a task touches `newsletter/app/src` (the reader SPA), [DESIGN.md](newsletter/docs/DESIGN.md) is the L1 doc for the visual/IA system.

If a task touches the **governance machinery** — a CI gate, a registry, the analytics loop, the hooks — read [docs/governance-mechanisms.md](docs/governance-mechanisms.md) first. It is the map of the self-driving mechanisms (R-10…R-12, the memory→lint ratchet, the content-insights loop) and their provenance (what was imported from asp-cloud / mononaware, and what was deliberately left as ceremony). It carries the anti-reinvention reflex: extend an existing mechanism, don't build a parallel one.

## The four invariants you must not violate

From [docs/governance.md §2](docs/governance.md#2-l0--constitution):

- **C-1. Editorial integrity.** No empty articles, no mid-sentence truncations, no leaked LLM-failure artefacts on `kohuehara.xyz`.
- **C-2. Notion is the source of truth.** Don't write authoritative content anywhere else. `newsletter/app/public/posts/*.md` is a derived export — CI overwrites it from Notion every deploy.
- **C-3. Single-operator scale.** This is a hobby site. Don't propose multi-tenant primitives (auth, quotas, role-based access).
- **C-4. Fail loud, not silent.** A broken state must throw (or turn CI red), never silently publish a degraded result.

When a request would conflict with one of these, stop and report — don't ship a "creative interpretation" that violates them.

## Skills you should use, not reinvent

Three project-local skills live under `.claude/skills/`:

- **`gas-call`** — POST a JSON action to the deployed GAS web app. Use this instead of `curl -X POST` (which silently fails because of how GAS handles the auth redirect — see [gas-call/SKILL.md](.claude/skills/gas-call/SKILL.md) for the full story).
- **`gas-deploy-verify`** — push `newsletter/gas/src/Code.gs` and confirm the new version is actually serving by probing `/exec`. Use this every time you edit `newsletter/gas/src/Code.gs` instead of `npm run deploy-gas`. Same speed, catches the "did v49 actually go live?" class of bug.
- **`article-health`** — sweep the published corpus, flag truncated articles and Notion-vs-gh-pages drift. Run it after any GAS change that affects content generation, and any time the user reports a broken article.

The newsletter's article-authoring skills (`article-level2`, `article-level3`) live under `workforce/skills/` — they're workforce-owned cadences, validated by the workforce CI, not Claude-Code session skills.

## Action authority — what to do autonomously

Default to **A (auto-execute)** for L3 work and L2 tightening. Default to **B (escalate to operator)** for anything that mutates `main`, merges PRs, amends `docs/governance.md` or any doc named in [§3.1 of governance.md](docs/governance.md#31-current-statute), loosens an existing mechanical check, or spends money outside the existing pipeline cost envelope. Full matrix at [docs/governance.md §8.1](docs/governance.md#81-action-authority-matrix).

Specifically:

- ✅ Edit `newsletter/gas/src/Code.gs` to fix a bug, then deploy via `gas-deploy-verify`.
- ✅ Add a new GAS action and wire it through `doPost` + `supportedActions`.
- ✅ Run `L2_BACKFILL`, `L3_BATCH`, etc. on demand via `gas-call`.
- ✅ Open a PR (you author + draft).
- ✅ Add a runtime guard or new lint (L2 tightening).
- ✅ Edit a runbook in `newsletter/docs/L1-L4-PIPELINE.md`.
- 🚫 Merge any PR, including your own.
- 🚫 Push directly to `main` (PR-only).
- 🚫 Edit `docs/governance.md` §2 (L0 invariants).
- 🚫 Loosen or disable the `finish_reason === 'length'` throw, the manifest check, or any other R-1…R-9 in [§4](docs/governance.md#4-l2--regulations-mechanical-enforcement).
- 🚫 Change `package.json` deploy IDs, `newsletter/gas/appsscript.json` access settings, GitHub repo settings.

When in doubt: ask in chat with a one-line description; wait for an explicit "yes."

## Workflow expectations

- **Plan before non-trivial implementation.** Use `EnterPlanMode` for any change that touches `newsletter/gas/src/Code.gs` substantively or that modifies multiple files.
- **Verify after change.** A change to `newsletter/gas/src/Code.gs` is not done until `gas-deploy-verify` passes. A change to content generation is not done until `article-health` reports 0 truncated.
- **Commit messages cite the layer.** `L2: add finish_reason='length' throw` reads better than `fix: bug`. The layer tag (L1/L2/L3) helps future audit see which doc level a change touches.
- **Label new issues per [docs/issue-labeling.md](docs/issue-labeling.md).** Mandatory axes: `project:` + `layer:` + `type:`. Reconcile colours via `node scripts/sync-labels.mjs` after editing `.github/labels.json`.
- **One in_progress todo at a time** when running TodoWrite for multi-step tasks. Mark complete immediately on finish.
- **Install the local hooks once per clone:** `git config core.hooksPath .githooks`. The `pre-push` hook mirrors the cheap CI gates (R-1/R-2/R-12) so they fail at push-time, not PR-time. See [.githooks/README.md](.githooks/README.md).
- **Touching an L1 doc?** The R-11 citation gate requires the PR body to either reference the L1 doc you're changing or carry `RULE-N/A: <reason>`. (L1 docs = the five in [governance.md §3.1](docs/governance.md#31-current-statute) plus governance.md / design-policy.md themselves.)
- **Found a recurring failure mode?** Log it in [docs/memory-lint-backlog.md](docs/memory-lint-backlog.md); a second occurrence within 90 days promotes it to an `R-NN` gate (the §6.1 ratchet). A real-but-not-worth-a-check gap goes to [docs/risk-acceptance-ledger.md](docs/risk-acceptance-ledger.md) instead.

## Things that cost more than they look

- **GAS deployment lag.** ~60–90s between `clasp deploy` and `/exec` actually serving the new code. `gas-deploy-verify` polls for this. Don't `gas-call` against a fresh deploy without verifying first.
- **gh-pages cron.** Up to 6 hours between editing Notion and seeing it live (`06:17 / 12:17 / 18:17 UTC`, plus push-to-`main` triggers). For "make it live now," run `gh workflow run deploy-article-site.yml`.
- **Reasoning-token consumption.** `gpt-5.4` shares `max_completion_tokens` between hidden reasoning and visible output. The 2000-token default produced empty articles; 8000 is the floor for any prose-length output. See [newsletter/docs/azure-budget-rules.md](newsletter/docs/azure-budget-rules.md).
- **`curl -X POST` to GAS.** Returns HTTP 405. Use the `gas-call` skill or Node's `fetch` with `redirect: 'follow'`.

## When something breaks

1. Run `article-health` to localise: is the breakage on `gh-pages`, in Notion, or both?
2. Check the GAS execution log (Apps Script editor → Executions) for thrown errors — `finish_reason='length'`, manifest violations, etc.
3. If it's a content issue: `L2_BACKFILL` (for truncated explanations) or open the Notion row directly.
4. If it's a deploy issue: `gh workflow run deploy-article-site.yml`.
5. If neither: read [newsletter/docs/L1-L4-PIPELINE.md §Operator runbooks](newsletter/docs/L1-L4-PIPELINE.md#operator-runbooks) for the closest matching scenario.

If the symptom is novel, after fixing it, ask whether the rule that should have caught it lives at L1 (a doc), L2 (a mechanical check), or L3 (a runbook), and update the corresponding layer. That's the §6 "governance retrospective" loop.
