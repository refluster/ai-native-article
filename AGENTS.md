# AGENTS.md — Governance for Multi-Agent Work

This repo is built to run *many* agents — Claude Code sessions, skills, scheduled jobs, and humans — concurrently, without stepping on each other. This document is the regulation. Read it before editing, spawning a skill, or merging.

The philosophy: **let machines do everything that is cheap to re-run and safe to revert; hold a human line on anything that shapes identity or that readers see as "the product."**

## 1. Zones — who owns what

Every file in this repo belongs to one of four zones. The zone determines the approval bar.

### Zone A — Human-owned (design, identity, governance, prompts)

Agents may propose diffs. Agents may NOT merge without a human on the PR.

- [DESIGN.md](DESIGN.md)
- [GROWTH.md](GROWTH.md)
- [AGENTS.md](AGENTS.md) (this file)
- [tailwind.config.ts](tailwind.config.ts)
- [src/config/site.ts](src/config/site.ts)
- [src/index.css](src/index.css) — base and utilities layers
- [.github/CODEOWNERS](.github/CODEOWNERS)
- [.github/workflows/*.yml](.github/workflows/)
- **L2/L3 generator prompts** — [skills/l2-ai-blog/SKILL.md](skills/l2-ai-blog/SKILL.md), [skills/l3-insight/SKILL.md](skills/l3-insight/SKILL.md), and the prompt blocks in [gas/src/Code.gs](gas/src/Code.gs). This applies to *every* generator on the panel.
- **Judge rubric text and thresholds** — the rubric tables in [GROWTH.md §3, §4](GROWTH.md), and `JUDGE_GATE` / `DIM_FLOOR` / `FALSIFIABILITY_FLOOR` constants in [src/types/quality.ts](src/types/quality.ts).
- **Panel rosters** — `JUDGE_ROSTER` and `GENERATOR_ROSTER` in [src/types/quality.ts](src/types/quality.ts). Adding or removing a panel member, or changing perspective weights, is a product-shape decision.

Rationale: these files encode the brand, the typography, the deployment surface, and the governance itself. A design-token change cascades across every article. A workflow change can nuke production. A prompt change is an identity change — it shifts what the product *is*. A rubric change invalidates every score that came before it. Humans approve.

### Zone B — Agent-assisted (product code)

Agents may author and merge, subject to CI passing and one human review *unless* the diff is smaller than 30 lines and touches no Zone A files.

- `src/components/**`
- `src/pages/**`
- `src/lib/**`
- `src/types/**`
- `scripts/**` (except GAS deploy target)
- `gas/src/**`

### Zone C — Agent-generated (content)

Agents merge freely. No human review required. Machine regenerable.

- `public/posts/*.md`
- `public/posts/manifest.json`
- `public/posts/images/*`
- `public/sitemap.xml`
- `public/robots.txt`

If an agent deletes a file in Zone C that is referenced from Zone B or A (e.g., an article still linked from the homepage), CI's build step catches it. That is the safety net — not human review.

### Zone D — Frozen (build output, lock files)

Nobody edits by hand. Agents regenerate via scripts only.

- `dist/**`
- `package-lock.json` (only `npm install` touches it)
- `public/manifest.webmanifest`

## 2. The rules agents must follow

1. **Small, labeled PRs.** Each PR carries a `growth:`, `fix:`, `content:`, `chore:`, or `governance:` prefix. The prefix decides the reviewer (CODEOWNERS) and the release note section.
2. **Every `growth:` PR names a metric.** The PR description says which KPI from [GROWTH.md](GROWTH.md) it is expected to move and in which direction. No metric → not a growth PR, relabel to `chore:`.
3. **No raw hex colors in `src/**`.** The design-token linter blocks this. Use the token.
4. **No new top-level routes without updating [AGENTS.md](AGENTS.md) zones.** Silent IA additions erode the public/internal separation.
5. **No writes to Zone A from a skill.** Skills must edit Zone B or C only. If a skill "needs" to touch a token, it files a PR and stops.
6. **Never force-push `main` or `gh-pages`.** The deploy workflow owns `gh-pages`. Human operators own `main`.
7. **Idempotent scripts only.** `fetch-notion.mjs`, `generate-sitemap.mjs`, and their peers must be safe to run twice. No "this script assumes fresh state" scripts.
8. **Secrets stay in `.env` (local) or GitHub Secrets (CI).** An agent that prints a secret to stdout is a bug. CI redaction is a backstop, not a plan.
9. **When in doubt, file an issue, not a PR.** It is cheaper for a human to redirect an idea than to close a PR.
10. **Every L2/L3 generation writes a sidecar `.eval.json`** with full panel output — every candidate, every judge (schema: [src/types/quality.ts](src/types/quality.ts)). No sidecar → no publish. This applies whether the generator is a Claude skill or the GAS pathway. Articles missing the sidecar are treated as Zone A changes and require human review.
11. **A prompt-version bump is its own PR.** Do not bundle a prompt change with unrelated work. The outer-loop leaderboard attributes reader behavior by `generator.systemPromptVersion`; mixed PRs corrupt attribution. Bumping two panel members in one PR is also forbidden — bump one at a time so the outer loop can tell which move helped.
12. **Model disjointness must hold after every roster change.** No generator on the panel shares a model id with any judge on the panel. A PR that changes the roster must include a one-line "disjointness check" in the description.

## 3. What machines decide vs. what humans decide

| Decision                                              | Who   | Why                                                                 |
| ----------------------------------------------------- | ----- | ------------------------------------------------------------------- |
| Which L1 sources to pull this week                    | Machine | Data-driven; see GROWTH.md §2 feedback loop                        |
| Which L2 blogs to combine into an L3 insight          | Machine | Same; bias toward top-completion categories                         |
| Prompt wording for any generator on the panel          | Mixed   | Machine proposes; prompt-version bump requires human merge. The prompt is the model. |
| Adding/removing a generator or judge from the roster   | Human   | Changes the product shape; also must respect model-disjointness (§2a) |
| Perspective weights on the judge panel                 | Human   | "How much does the editor count vs the domain expert" is product-level |
| Judge rubric text (dims, "10/10 looks like")           | Human   | Changing the rubric invalidates all prior scores; change intentionally, in its own PR |
| Judge-score gates and per-dim floors                   | Human   | A product decision about what counts as shippable                    |
| Aggregation algorithm (weighted-mean, cascaded ranker) | Machine | Implementation of the panel; change freely as long as rubric/roster don't move |
| Judge-scoring code (scoring call wiring)               | Machine | Implementation detail                                                |
| Rolling back a panel member after outer-loop regress   | Mixed   | Data-driven decision but editorially consequential — human on the PR |
| Design tokens, typography scale, spacing              | Human   | Identity; small changes have broad visual cost                      |
| Public IA (what appears in header/footer)             | Human   | Navigation is a promise to readers                                  |
| Internal tool routes (`/l[1-4]-*`)                    | Machine | Operator ergonomics; change freely                                  |
| Copy on the homepage hero                             | Human   | Brand voice                                                         |
| Article body content                                  | Machine | That is the product                                                 |
| Workflow YAML, deploy target, CNAME                   | Human   | Production surface                                                  |
| CI checks (lint, typecheck, build)                    | Mixed   | Machines add checks; humans remove them                             |
| Which metrics are KPIs                                | Human   | Goal-setting is not delegable                                       |
| How KPIs are computed                                 | Machine | Implementation of a goal                                            |
| Moving a route or breaking a URL                      | Human   | URL changes silently break referrers                                |

## 4. Running tens or hundreds of agents safely

The constraint is not compute — it is *merge-contention* on `main` and *surface-confusion* for readers. Guardrails:

- **One PR per logical change.** An agent that opens a 900-line PR across components, content, and config is a bug. Split or close.
- **Agents rebase, they do not merge main into their branch.** Linear history on `main` is enforced (repo setting, not code).
- **Agents scoped to Zone C can run without approval queues.** Content generation is embarrassingly parallel.
- **Agents scoped to Zone B serialize via CODEOWNERS review.** A human is the concurrency controller.
- **Agents never open a PR that modifies files across zones.** If the change is truly cross-cutting, it is a Zone A design change, file a human-led RFC first.
- **Every skill writes its `originSessionId` / agent id into the PR body.** Attribution is how we debug behavior drift.

## 5. Escalation

If an agent is uncertain whether a change is Zone A or Zone B, treat it as Zone A and request human review. The cost of a redundant review is a minute; the cost of shipping a token change without one is visible on every page for days.

---

*This file is itself Zone A. Agents may propose edits. Agents may not merge edits.*
