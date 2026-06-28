# CLAUDE.md — orientation for agents

You are working in `ai-native-article`, a personal blog/insight site at `https://kohuehara.xyz`. The repo is split into two domain modules:

- **`newsletter/`** — the site's L1→L4 article pipeline: `newsletter/app` (Vite/React reader SPA), `newsletter/pipeline` (build/sync scripts run in CI — `fetch-notion.mjs`, sitemap, etc.), `newsletter/template`, and `newsletter/docs` (the pipeline's L1 statute docs). (The Apps Script generation engine `newsletter/gas/src/Code.gs` was retired 2026-06-28 — generation now lives in the workforce cadences below.)
- **`workforce/`** — a separate agent-organisation subtree (console `workforce/app` + `agents/`, `skills/`, `lambdas/`, `infra/`, `client/`, `projects/`, …). **It has its own governance and decision log** — read [`workforce/docs/governance.md`](workforce/docs/governance.md) and [`workforce/docs/adr/`](workforce/docs/adr/README.md) before touching `workforce/**`; do not assume the root rules map onto it 1:1. The workforce authors articles into the newsletter via the `workforce/skills/article-level2` / `article-level3` cadences (the active generation path; their `publish-notion.mjs` carries the canonical truncation guard).

Cross-cutting governance lives at root: [`docs/`](docs/) and [`AGENTS.md`](AGENTS.md). `packages/shared` is shared by both apps.

Articles flow through a 4-stage pipeline: web sources → Notion blog drafts (L2) → Notion synthesis (L3) → published markdown (L4). Generation runs through the **workforce cadences** `workforce/skills/article-level2/` (L2 explanations) and `article-level3/` (L3 analyses) — owned by the persona **Elena**, fired by the CCR / `wf-orchestrator-tick` schedule, writing directly to the Notion unified Articles DB via each skill's `publish-notion.mjs` (the canonical editorial guard **W-1**). Publication is `.github/workflows/deploy-article-site.yml`, which runs `newsletter/pipeline/fetch-notion.mjs` (exports every Articles-DB row) and deploys a React SPA built from that Notion content. Generation is increasingly run through a **multi-candidate, multi-judge quality layer** (see "The quality layer" below). (Governing record: `workforce/docs/epics/epic-005-agent-authored-article-pipeline.md`.)

## Doc map — what to read before editing

**The rules (start here):**
1. **[docs/governance.md](docs/governance.md)** — the layered law. L0 invariants → L1 framework → L2 mechanical (R-rules) → L3 operational, plus the §8.1 action-authority (A/B) matrix. The single most important constraint: **C-2, Notion is the source of truth.**
2. **[AGENTS.md](AGENTS.md)** — the multi-agent **Zone** model (A=human-owned design/identity/prompts/workflows, B=agent-assisted product code, C/D below). The Zone decides the approval bar; governance.md decides the layer. They're complementary — consult both.

**The direction:**
3. **[docs/design-policy.md](docs/design-policy.md)** — the orthogonal "how/why we build" axis: Software 2.0, external-substrate-over-reinvention, and the D-1 *innovation-velocity* bias (default to A for reversible work).

**The self-driving machinery:**
4. **[docs/governance-mechanisms.md](docs/governance-mechanisms.md)** (decision record: [docs/adr/adr-0001](docs/adr/adr-0001-self-driving-governance-mechanisms.md)) — the working mechanisms: the CI gates **R-10…R-12**, the **memory→lint ratchet**, the **content-insights loop**, the two registries. Read it before adding any gate/loop/registry — it carries the anti-reinvention reflex.

**The pipeline (read the one your task touches):**
5. **[newsletter/docs/architecture-source-of-truth.md](newsletter/docs/architecture-source-of-truth.md)** — *where* content lives and which copies are stale. Reading this once saves the hour I lost on the L2 truncation fix.
6. **[newsletter/docs/L1-L4-PIPELINE.md](newsletter/docs/L1-L4-PIPELINE.md)** — what each stage does, the daily cron schedule, and the operator runbooks.
7. **[newsletter/docs/azure-budget-rules.md](newsletter/docs/azure-budget-rules.md)** — the 3-bracket token sizing for any LLM generation call site. The L2 truncation bug existed because this wasn't documented (it was first written for the since-retired GAS `azureGenerateText`).
8. **[newsletter/docs/DESIGN.md](newsletter/docs/DESIGN.md)** — visual/IA system (L1) for `newsletter/app/src`.
9. **[newsletter/docs/GROWTH.md](newsletter/docs/GROWTH.md)** — the Software 2.0 growth plan and the two-loop quality model + rubrics (the source of the quality layer below).

## The four invariants you must not violate

From [docs/governance.md §2](docs/governance.md#2-l0--constitution):

- **C-1. Editorial integrity.** No empty articles, no mid-sentence truncations, no leaked LLM-failure artefacts on `kohuehara.xyz`.
- **C-2. Notion is the source of truth.** Don't write authoritative content anywhere else. `newsletter/app/public/posts/*.md` is a derived export — CI overwrites it from Notion every deploy.
- **C-3. Single-operator scale.** This is a hobby site. Don't propose multi-tenant primitives (auth, quotas, role-based access).
- **C-4. Fail loud, not silent.** A broken state must throw (or turn CI red), never silently publish a degraded result.

When a request would conflict with one of these, stop and report — don't ship a "creative interpretation" that violates them.

## The quality layer (Software 2.0)

Generation is no longer "one prompt → one article." L2/L3 generation is moving onto a **multi-candidate, multi-judge** model (GROWTH.md §2–§5):

- Each article can be generated by ≥1 **generator** on a panel, scored by ≥1 **judge** (editor / domain / reader perspectives) against a per-level **rubric**, with a panel-weighted aggregate and a `chosen` candidate. The schema is [`newsletter/app/src/types/quality.ts`](newsletter/app/src/types/quality.ts); per-article evidence is the operator-only `.eval.json` sidecar.
- The **chosen** candidate's `systemPromptVersion` + aggregate score are copied into the published article's frontmatter, so GA4 can bucket reader behaviour by prompt version — this is the **outer loop** that the weekly content-insights loop feeds.
- **Zone A (human-owned).** The rubric text/thresholds (`JUDGE_GATE`, `DIM_FLOOR`, `FALSIFIABILITY_FLOOR`), the panel rosters (`JUDGE_ROSTER`, `GENERATOR_ROSTER`), and the model registry (`MODEL_REGISTRY`, currently `gpt-5.4` on Azure) are **operator-approved** — propose diffs, don't self-merge. A rubric change invalidates every prior score; a roster/model change is a product-shape decision.

When investigating a content-quality issue, the first reflex (design-policy.md D-2) is: *prompt problem, eval gap, or code problem?* — usually the first two.

## Skills you should use, not reinvent

Project-local skills under `.claude/skills/`:

- **`article-health`** — sweep the published corpus on gh-pages, flag truncated articles, and (when `NOTION_API_KEY` is set) compare against the Notion Articles DB directly to surface Notion↔gh-pages drift. With no key, only the gh-pages truncation sweep runs. Run after any generation change (the workforce cadences) and any time a broken article is reported.
- **`cadence-forge`** — scaffold a new workforce "Cadence" skill (scheduled, persona-voiced periodic task).
- **`ship-pr`** — drive a freshly-opened draft PR to all-CI-green + no unresolved threads, then flip it ready.
- **`log-workforce-engagements`** — batch-record workforce Track Record engagement rows for a session's contributors.

The article-authoring skills (`article-level2`, `article-level3`) live under `workforce/skills/` — they're workforce-owned cadences validated by workforce CI, not Claude-Code session skills. They carry the W-1 guard in their `publish-notion.mjs`.

## Action authority — what to do autonomously

Default to **A (auto-execute)** for L3 work and L2 tightening. Default to **B (escalate to operator)** for anything that mutates `main`, merges PRs, amends an L1 doc / ADR / Zone-A file, loosens an existing mechanical check, or spends money outside the existing pipeline envelope. Full matrix at [docs/governance.md §8.1](docs/governance.md#81-action-authority-matrix); cross-check the [AGENTS.md](AGENTS.md) Zone of the files you touch.

- ✅ Edit a workforce cadence (`workforce/skills/article-level{2,3}/`) to fix a generation bug, validate via workforce CI, then run `article-health` (mind the workforce zone rules — see `workforce/docs/governance.md`).
- ✅ Edit a `newsletter/pipeline/` script (`fetch-notion.mjs`, sitemap, etc.) to fix a bug.
- ✅ Add a new L1 source row directly in Notion (read by `article-level2/pick-l1-source.mjs`); trigger a fresh publish with `gh workflow run deploy-article-site.yml`.
- ✅ Open a PR (you author + draft). Add a runtime guard or new lint (L2 tightening). Edit a runbook.
- 🚫 Merge any PR (incl. your own). Push directly to `main` (PR-only).
- 🚫 Edit `docs/governance.md` §2 (L0 invariants) or any **Zone A** file (design tokens, prompts, rubric/roster/model registry, workflows) without operator approval.
- 🚫 Loosen or disable any R-rule ([§4](docs/governance.md#4-l2--regulations-mechanical-enforcement)) — incl. the W-1 `publish-notion.mjs` guard and the R-10 corpus-truncation deploy gate.
- 🚫 Change `package.json` deploy IDs, `.github/workflows/*` deploy config, GitHub repo settings.

When in doubt: ask in chat with a one-line description; wait for an explicit "yes."

## Workflow expectations

- **Before implementing, check for a governing ADR.** Skim [docs/adr/](docs/adr/README.md) (root/newsletter decisions) and [workforce/docs/adr/](workforce/docs/adr/README.md) (workforce decisions) for an ADR that governs the area you're about to change. If one exists, **follow it and cite it in the PR.** ADRs are L1 framework laws (governance.md §3); a reversal is a new *superseding* ADR, never an in-place edit of a decided one.
- **Touching an L1 doc or ADR?** The R-11 citation gate requires the PR body to either reference the L1 doc / ADR you're changing or carry `RULE-N/A: <reason>`. (L1 = the statute docs in [governance.md §3.1](docs/governance.md#31-current-statute), governance.md / design-policy.md themselves, and any ADR under `docs/adr/`.)
- **Plan before non-trivial implementation.** Use `EnterPlanMode` for any change that touches a workforce cadence's `publish-notion.mjs` substantively or that modifies multiple files.
- **Verify after change.** A content-generation change (a workforce cadence edit) isn't done until `article-health` reports 0 truncated. A publish-pipeline change isn't done until `deploy-article-site.yml` is green.
- **Commit messages cite the layer.** `L2: tighten W-1 cut-off guard in publish-notion.mjs` beats `fix: bug`.
- **Label new issues per [docs/issue-labeling.md](docs/issue-labeling.md).** Mandatory axes: `project:` + `layer:` + `type:`. Reconcile colours via `node scripts/sync-labels.mjs` after editing `.github/labels.json`.
- **Found a recurring failure mode?** Log it in [docs/memory-lint-backlog.md](docs/memory-lint-backlog.md); a second occurrence within 90 days promotes it to an `R-NN` gate (the §6.1 ratchet). A real-but-not-worth-a-check gap goes to [docs/risk-acceptance-ledger.md](docs/risk-acceptance-ledger.md) instead.
- **One in_progress todo at a time** when running TodoWrite for multi-step tasks. Mark complete immediately on finish.

## Things that cost more than they look

- **gh-pages cron.** Up to 6 hours between editing Notion and seeing it live (`06:17 / 12:17 / 18:17 UTC`, plus push-to-`main`). For "make it live now," run `gh workflow run deploy-article-site.yml`.
- **Reasoning-token consumption.** The active model (`gpt-5.4`, via `MODEL_REGISTRY`) shares `max_completion_tokens` between hidden reasoning and visible output. The 2000-token default produced empty articles; 8000 is the floor for prose. See [azure-budget-rules.md](newsletter/docs/azure-budget-rules.md).
- **Generation runs in the workforce, not in-session.** The article-level2/3 cadences fire on the `wf-orchestrator-tick` schedule and write to Notion asynchronously; you don't synchronously "generate an article" from a Claude Code session. To get new content live, add the L1 source row in Notion and let the cadence pick it up (or trigger the deploy once Notion is updated).
- **Network allowlist (remote sessions).** Cloud/remote execution environments may block outbound hosts, so `article-health`'s Notion comparison (and other API calls) can 403 (`Host not in allowlist`). The gh-pages truncation sweep still works without a key; the Notion-drift comparison must run from an unrestricted machine with `NOTION_API_KEY` set.

## When something breaks

1. Run `article-health` to localise: breakage on `gh-pages`, in Notion, or both?
2. Check the workforce run logs for the failed cadence (the `wf-orchestrator-tick` / agent-runner execution) for a thrown W-1 guard (empty/short body, LLM-failure prelude, cut-off last line → exit 2) or other generation error.
3. Content issue → re-run the relevant cadence (`workforce/skills/article-level{2,3}/`), or fix/open the Notion row directly.
4. Deploy issue → `gh workflow run deploy-article-site.yml` (R-10 will block a deploy that would publish a truncated article).
5. Otherwise → [L1-L4-PIPELINE.md §Operator runbooks](newsletter/docs/L1-L4-PIPELINE.md#operator-runbooks).

If the symptom is novel, after fixing it ask whether the rule that should have caught it lives at L1 (a doc/ADR), L2 (a mechanical check), or L3 (a runbook), record it in [memory-lint-backlog.md](docs/memory-lint-backlog.md), and update the corresponding layer. That's the §6 "governance retrospective" loop.
