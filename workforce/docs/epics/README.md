# Workforce — Epics

Specifications for workforce features. Each Epic lives in this directory from the moment it is opened until long after the work it describes is done — it stays as the **design record**. The status line at the top of each file states where in the lifecycle the Epic currently sits.

## Status definitions

Every Epic carries one of **five statuses** on its first line. The lifecycle is monotonic — moving backward (e.g. `Implemented` → `In-progress`) is not allowed; open a new Epic for follow-up work instead.

| Status | Definition | Exits to |
|---|---|---|
| **Draft** | Epic opened in this directory. Design is on the page but **operator review has not signed off**. Edits to the body are still expected. | `Accepted` once the operator approves, or `Rejected`. |
| **Accepted** | Operator review passed. **Maya is cleared to file implementation issues** on GitHub against this Epic. No code yet. | `In-progress` once the first implementation PR is open. |
| **In-progress** | One or more implementation PRs are open against the issues Maya filed. The Epic body is updated with PR links as they appear. | `Implemented` once all PRs are merged AND the change is live on its target surface. |
| **Implemented** | The change described by the Epic is **live** — deployed to AWS, served on `kohuehara.xyz`, behavior present in the runner, etc. The Epic stays here as the design record. The "Implemented by" line at the top lists the merging PR(s). | Terminal. |
| **Rejected** | The design was reviewed and the decision was *not* to implement. The rationale is recorded in the Epic body. Kept as history; rejections teach the next reviewer what we already considered and discarded. | Terminal. |

Lifecycle diagram:

```
Draft  ──operator review──▶  Accepted  ──Maya files issues──▶  In-progress  ──ship & deploy──▶  Implemented (terminal)
   │                            │                                  │
   └─── at any of these points, the decision can flip to ──▶  Rejected (terminal)
```

## Maya's role + the dev process

Maya is the **dedicated PM** for Epics. The full seven-phase loop she coordinates (Epic authoring → Story implementation → reviewer routing → revise → verdict → operator merge) is the canonical workforce dev process — see [runbooks/dev-process.md](../runbooks/dev-process.md). Highlights relevant to this file:

- Maya owns Phase A (Epic → Story decomposition) — she enforces the **scenario walkthrough**, the **cost-pushback rule**, and **defer-with-name vs silent-drop**.
- Maya owns Phases C + F (PR routing + verdict).
- Maya **never implements** and **never merges** (W-5).

`Draft` Epics are not yet hers to act on — operator approval moves an Epic to `Accepted`, after which Maya can file Story issues.

## Epic format

A new Epic is `epic-NNN-<kebab-case-slug>.md`, where `NNN` is the next zero-padded number. Required headers:

```
# Epic-NNN — <title>

- **Status**: Draft | Accepted | In-progress | Implemented | Rejected
- **Owner**: <agent slug or operator name>
- **Created**: <YYYY-MM-DD>
- **Implemented by**: <PR link(s) — only set when Status hits In-progress or later>

## Problem

## Proposed solution

## Behaviour at N = 100+ agents

## Acceptance criteria

## Open questions

## Out of scope
```

**The "Behaviour at N = 100+ agents" section is mandatory** for any Epic that touches the agent set — search, profile, org chart, skill catalog, scheduling, budgets, etc. Workforce growth is the planned axis of change; no Epic ships without thinking it through.

When the Status line flips, add a parenthetical date so the audit trail is one click away:

```
- **Status**: Implemented (2026-05-30)
- **Implemented by**: #34, #36
```

## Index

| # | Title | Status | Owner |
|---|---|---|---|
| [001](epic-001-agent-search.md) | Agent search | Rejected (superseded by 014) | Maya |
| [002](epic-002-agent-profile.md) | Agent profile page (LinkedIn-style) | Implemented | Maya |
| [003](epic-003-org-chart.md) | Org chart (MS Teams-style) | Implemented | Maya |
| [004](epic-004-skill-catalog.md) | Skill catalog + utilization | Implemented | Maya |
| [005](epic-005-agent-authored-article-pipeline.md) | Agent-authored L0→L1 article pipeline | Rejected (superseded by article-level2/3) | Maya |
| [006](epic-006-scalability.md) | Workforce scalability to 100+ agents | Rejected (obsoleted; S6 open) | Maya |
| [007](epic-007-agent-management-api.md) | Agent management surface (DDB + CRUD API, SAM, nodejs24.x) | Rejected (superseded by ADR-0007) | Maya |
| [008](epic-008-skill-repository.md) | Skill repository as the execution unit | Implemented | Maya |
| [009](epic-009-vp-tier-and-functional-expansion.md) | VP tier and functional expansion (7 new agents) | Implemented | Maya |
| [010](epic-010-project-trust-boundary.md) | Project as trust boundary: credentials, executions, agent memory | In-progress | Maya |
| [011](epic-011-agent-feed.md) | Workforce activity feed (LinkedIn-style) | Implemented | Maya |
| [012](epic-012-agent-experience.md) | Agent experience: recall, long-term memory, clean activity record | In-progress | Maya |
| [013](epic-013-talent-messaging.md) | Talent-to-talent messaging | Implemented | Maya |
| [014](epic-014-global-nav-search.md) | Global nav search (talent + skills) | Implemented | nadia |
| [015](epic-015-daily-research-cadence.md) | daily-research: one generic research cadence across personas | Implemented | sana |
| [016](epic-016-workforce-performance-analytics.md) | Workforce performance analytics (per-project + cross-project) | In-progress | nadia |
| [017](epic-017-podcast-spotify-distribution.md) | Podcast production & Spotify distribution from analysis articles | Implemented (2026-06-29) | Maya |
| [018](epic-018-semantic-memory-curation.md) | Semantic memory curation: pilot five personas, then make it a technique | In-progress (2026-07-12) | Maya |
| [019](epic-019-autonomous-finalization-rate.md) | Autonomous change finalization: 2.8% baseline → an order of magnitude (仮説一) | In-progress (2026-07-08) | nadia |
| [020](epic-020-human-leverage-metric.md) | Human leverage per intervention as a first-class metric (仮説二) | Accepted (2026-07-08) | maya |
| [021](epic-021-finance-ir-activation.md) | Finance & IR bench activation + idle-talent discipline (仮説三) | Accepted (2026-07-08) | silas |
| [022](epic-022-org-learning-loop.md) | Organisational learning: one agent's experience → everyone's premise (仮説四) | Accepted (2026-07-08) | mateo |
| [023](epic-023-trust-ladder.md) | Trust ladder: record-computed review authority (仮説五) | Accepted (2026-07-08) | priya |
| [024](epic-024-messaging-group-chat-and-latest-first-history.md) | Messaging: group compose + latest-first history paging | Implemented (2026-07-17) | operator |

The index is also the **canonical status view** — keep it in sync when a Status line in an individual Epic flips. A CI check that asserts table-vs-file consistency is on the backlog (see `workforce/scripts/validate-epic-index.mjs`, forthcoming).

> **Status reconciliation pass (2026-07-27, Nadia — backlog-reconcile).** Daily audit of the plan vs. the shipped default branch (`HEAD` = `5331584`; standing-core lenses mateo/dario/nadia/aoi, no specialist partition triggered — the scope this pass is the performance/analytics and console surfaces the standing core already covers). Scope: the ten PRs merged since the 07-23 pass (#494 the 07-23 pass note, #495 `skill-maturity-report` Cadence, #496 VP Operations hire + `ops-accountability-watch` Cadence, #497 `agent-workflow-overview` doc, #498 `/performance` axis + deck fixes, #499 Ren `issue-implement` binding, #500 console progressive rendering / mobile / drawer nav / brand mark, #501 post ordering + drawer animation, #502 `performance-refresh` Cadence + live repository-activity roll-up, #503 cold `code_frequency` cache treated as degraded). **Zero status flips** — every Epic status line still matches reality. **The drift this pass found is tracker-side, not docs-side, and it is one row: [#437](https://github.com/refluster/ai-native-article/issues/437) (Epic-016 OP-012, “Schedule the daily GitHub-API PR-metrics refresh”) is bucket **Done** and still open.** Evidence: **#502** (`54b84ae`) shipped the `performance-refresh` Cadence end-to-end — `workforce/skills/performance-refresh/` (`SKILL.md`, `meta.json`, `refresh.mjs`, `post.mjs`), the daily binding wired to **tomas** via `workforce/scripts/wire-performance-refresh-tomas.mjs`, the widened `build-repo-performance.mjs` roll-up with tests, and the `RepoPerformancePanel` / `Dashboard` surfaces that render it. Epic-016's own body already records the outcome (“Phase 4 (2026-07-26) **closed OP-012** … ending the month-long silent freeze of the PR block”), so the Epic doc and the tracker disagree: the issue is the stale side. **Proposed for operator sign-off, not auto-applied** (issue closes are outward-facing per the skill's guardrails). **Epic-016 stays `In-progress`** — its remaining gate is genuinely open: **OP-011** ([#436](https://github.com/refluster/ai-native-article/issues/436)), the `wf-performance-reducer` redeploy for the widened `delivered` definition, which is an off-repo deployment act no merged PR can discharge. **Re-verified unchanged (correct):** **010** (#89/#91/#95 credential/deletion DoD open), **012** (recall-into-runner still unwired, #212 open), **018** (sole gate is Story 2 effect evaluation, [#493](https://github.com/refluster/ai-native-article/issues/493) — the cadence went live 2026-07-19, so only ~8 days of the “~2 weeks” window have accrued and the readout is still not producible), **019** (Story 3 judge #451 open); the five `Accepted` hypothesis epics **020–023** stay `Accepted` (Story issues #452–#464 filed, still no implementation PR open against any). [#505](https://github.com/refluster/ai-native-article/issues/505), filed today off #503, is correctly open. **Hygiene observation, now on its second consecutive pass — escalating the recommendation:** the 07-23 pass flagged the console Reports page as a substantial product feature shipped with **no governing Epic**; this pass adds #500 (console progressive rendering, mobile edge-to-edge, drawer nav, brand mark), #495 (`skill-maturity-report` Cadence) and #496 (a new VP Operations function + `ops-accountability-watch` Cadence) to the same class. Four features and one org function in two passes have landed with no design record. Recommend the operator decide a standing rule — either these classes are Epic-exempt by policy, or the console/cadence surfaces get Epic rows — because “surfaced, not acted on” each pass is how the index quietly stops being the canonical view. Greenfield Epic authoring remains out of this skill's scope. **Issue diff: 1 proposed close ([#437](https://github.com/refluster/ai-native-article/issues/437), shipped by #502) / 0 rewritten·split / 0 filed.**
>
> **Status reconciliation pass (2026-07-23, Nadia — backlog-reconcile).** Daily audit of the plan vs. the shipped default branch (`HEAD` = `d95c772`; standing-core lenses mateo/dario/nadia/aoi, with the memory/agent-experience specialist lens **freya** routed in per `routing_rules` for the Epic-018 partition). Scope: the nine PRs merged since the 07-18 pass (#483 memory-curation Cadence, #484/#485 org-benchmark nine-hire round, #486 standard-cadence wiring, #487/#488 workforce console Reports page + resilience fix, #489 ADR-0021 dynamic memory-write token, #490 weekly-project-report Cadence, #492 issue-implement skill). **Zero status flips** — every Epic status line still matches reality — but **one In-progress epic is trued up in its body + tracker: Epic-018.** Two of the three open gates the 07-12 pass named have closed: **(a)** the pilot MEMORY.md content is now observable (`GET /agents/nadia` returns a populated `memory.body`, superseding the 07-12 "empty" reading), and **(b)** Stories 3–5 shipped — Story 3 `memory-curation` Cadence (**#483**, `f3fdc16`: skill + `memory-contract.ts` guard + agents-api route + SAM, all live), Story 5 subsumed into its cohort sizing, and Story 4 write-authority hardened past ADR-0020's static secret to the dynamic per-fire scoped token in **#489** (`6e2f477`, ADR-0021). Epic-018's `Implemented by` line is trued up from `#447`-only to `#447 / #483 / #489`. It stays **`In-progress`** (no flip): the sole remaining gate is **Story 2 — the effect-evaluation kill criterion**, and the cadence went live only 2026-07-19, so the ~2-week before/after readout that would confirm the layer (or fire the kill criterion and unwind the cadence) cannot yet be produced. That gate had **no tracking issue** — filed this pass as [#493](https://github.com/refluster/ai-native-article/issues/493). **No other epic moves:** #484/#485/#486 are an org-benchmark hiring/cadence round on `docs/hires/` + `seed/org-benchmark-group/` (no Epic status line, like the 07-18 pass's #478 hires); #492 (issue-implement skill) and #490 (weekly-project-report Cadence) are new skills with no Epic row. **Hygiene observation (surfaced, not acted on — greenfield planning is out of this skill's scope):** the **workforce console Reports page** (#487/#488/#490 — new `Reports.tsx`/`ReportView.tsx`/`reports.ts` SPA surface + `GET /reports` agents-api endpoint + the `weekly-project-report` Cadence that feeds it) shipped as a substantial product feature with **no governing Epic** — recommend the operator decide whether it warrants one for the design record. **Re-verified unchanged (correct):** the four other `In-progress` epics keep a verified-open gate — **010** (#89/#91/#95 credential-vault / deletion DoD open), **012** (recall-into-runner still unwired, #212 open), **016** (OP-011 #436 / OP-012 #437 reducer-redeploy + daily-PR-refresh unshipped — #487's Reports surface is a different feature, not the performance-reducer), **019** (Story 3 judge #451 open) — and the five `Accepted` hypothesis epics **020–023** stay `Accepted`: their Story issues (#452–#464) are filed but no implementation PR is open against any (org-benchmark #484 is a hiring round, not an Epic-020/021/022/023 Story). **Issue diff: 0 closed / 0 rewritten / 1 filed** ([#493](https://github.com/refluster/ai-native-article/issues/493), Epic-018 Story 2 effect-evaluation, the now-sole open gate).

> **Status reconciliation pass (2026-07-18, Nadia — backlog-reconcile).** Daily audit of the plan vs. the shipped default branch (`HEAD` = `b17737b`; standing-core lenses mateo/dario/nadia/aoi, no specialist partition triggered). Scope: the four PRs merged since the 07-12 pass (#477 W-3 cap raise, #478 two hires, #479 Epic-024, #480 multi-author bylines) and the epics they most plausibly move. **One forward, monotonic-legal flip:** **Epic-024 `In-progress (2026-07-16)` → `Implemented (2026-07-17)`** (bucket **Done**). Evidence: the single implementation PR **#479** (`e67fc4f`) merged all four acceptance surfaces (paged newest-first `GET /threads/{id}` + `getThreadDetail` rebase in `agents-api/handler.ts`·`shared/messaging.ts`; open-at-latest + group-compose chip row in `Messaging.tsx`·`lib/messages.ts`; vitest on both), and the merge fired **both** deploys green — `deploy-workforce-console` (CloudFront) success 2026-07-16 (re-run 07-17) and `deploy-workforce-data-plane` (SAM) success 2026-07-16 — so the change is live on both target surfaces. `Implemented by` trued up from a placeholder to #479. **No other flips:** #477 (governance W-3 cap) and #478 (bruno/nico hires) map to no Epic status line; #480 (article multi-author bylines) is a newsletter-surface change with no workforce Epic row. **Re-verified unchanged (correct):** the four long-standing `In-progress` epics keep a verified-open gate — **010** (project console / credential-deletion DoD, #95/#91/#89 open), **012** (recall-into-runner still unwired, #212/#93 open), **016** (OP-011 #436 / OP-012 #437 unshipped), **018** (Stories 2–4 unbuilt; Story-1 pilot content *is* now observable — `nadia.memory.body` is populated, one 07-12-flagged sub-gate closed, but the epic stays `In-progress`), **019** (Story 3 judge #451 open). The five `Accepted` hypothesis epics **020–023** stay `Accepted` — their Story issues (#452–#464) are filed but **no implementation PR is open** against any, so the `Accepted → In-progress` gate has not tripped. **Issue diff: 0 closed / 0 rewritten / 0 filed** — Epic-024 filed no tracking issue and its Q1/Q2 are deferred follow-ups, not committed work; nothing else changed since 07-12. *(Hygiene note, non-blocking: two superseded backlog-reconcile drafts, #471 (07-09) and #473 (07-11), remain open behind the merged 07-12 pass #476 — recommend the operator close them.)*

> **Status reconciliation pass (2026-07-12, Nadia — backlog-reconcile).** Daily audit of the plan vs. the shipped default branch (`HEAD` = `e560ed1`; standing-core lenses mateo/dario/nadia/aoi, no specialist partition triggered). First **non-zero** doc pass since 06-23 — the four prior daily passes (06-30 → 07-05) found 0 flips, but three PRs merged since the 07-05 true-up move two Epic lines out of sync with reality. **Two changes, both forward and monotonic-legal:** **(1) Epic-018 `Draft` → `In-progress` (2026-07-12).** ADR-0019's ratification rule is "operator ratifies by merging the implementation PR," and **#447** (`e91fbdd`) merged — the fire-time injection layer is live (agent-runner.md §3.5 reads `.memory.body` on every fire). Held below `Implemented` by a verified-open gate: the pilot MEMORY.md *content* is not observable — `memory.body` is empty on the pilot personas checked (nadia, elena) via `GET /agents/{slug}` — and Stories 2–4 are unbuilt. This flip **encodes the operator's acceptance and is surfaced for sign-off via the merging PR.** **(2) Epic-019 — no status flip** (stays `In-progress`, correctly: Story 3 judge is open, tracked by #451); doc true-up only — its `Implemented by` line predated Story 2 merging, now cites **#465** (Story 1) **and #469** (Story 2). **Issue diff: 0 closed / 0 rewritten / 0 filed** — the only Epic-018/019-relevant open issue is #451 (Epic-019 Story 3), correctly open; no other tracker mutation is warranted, so no outward-facing issue churn this pass. All other 21 rows re-verified consistent file-vs-index.

> **Hypothesis-planning pass (2026-07-07).** The 2026-07 monthly report (article `d06ecf4bb246`, Maya) closed with five explicit hypotheses to verify next month. This pass (a) reconciled **Epic-017** with the operator-reported deploy state — the one-time Spotify submission is **done**, so the episode is actually distributable; the finalization tail (`spotifyUrl` → Notion, `published` flip, live reader link, feed validation) remains unverified and #385 stays open for it — and (b) opened **Epics 019–023**, one per hypothesis, as `Draft` pending operator review. Each Draft carries a "Hypothesis under test" line citing the report, a falsifier, and an RFC record from the VP+IC review panel (all VPs mandatory: mateo/priya/elena/dario/tessa/silas/celeste; ICs pulled in per domain: nadia, farah, theo, corinne, sana). **Numbering note:** this batch was originally minted 018–022 and renumbered 019–023 at PR-review cycle 1 (#448, dario A1 / nadia C1) — the concurrently-open #447 (semantic-memory-curation, opened earlier the same day) holds the prior claim on **018**; its row lands when #447 merges. **Operator acceptance (2026-07-08):** the operator reviewed the batch and accepted all five epics in-session ("レビューした。OK"), so 019–023 land as `Accepted (2026-07-08)` in the merging PR itself; Story issues are filed next per the lifecycle.

> **Status reconciliation pass (2026-07-09, Nadia — backlog-reconcile).** Daily audit of the plan vs. the shipped default branch (`origin/main` @ `056c9ca`, #467; standing core fan-out mateo/dario/nadia/aoi, memory specialist lens pulled in for Epic-018). **Index table: 0 status flips** — all 24 rows still match their files. Two write-backs into epic bodies, one flagged operator decision, and an **empty issue diff** (the tracker is already true — the 07-05 operator-directed true-up plus prompt closing of #449/#450 kept it clean). Findings: **(1) Epic-018 is implemented-ahead-of-acceptance** — [#447](https://github.com/refluster/ai-native-article/pull/447) (merged 07-08) shipped the ADR-0019 MEMORY.md pilot live (5 seed memories under `workforce/seed/memory/`, `curate-agent-memory.mjs`, the `workforce-curate-agent-memory.yml` workflow, agent-runner.md Layer-3.5 fire-time injection, `AgentProfile.tsx`), yet the epic sits at `Draft (operator review pending)`. **Not auto-advanced** — `Draft → Accepted` is an operator design sign-off (contrast 019–023, accepted in-session 07-08); a note was added to the epic body and the **Accept decision is escalated to the operator**. **(2) Epic-019 stays In-progress**, but its `Implemented by` pointer was stale ("#465 Story 1, in review") — corrected: Stories 1 (#465/#449) and 2 (#469/#450) merged+closed 07-08; **Story 3 (#451)** is a genuine future-dated measurement gate (2026-08 interim funnel / 2026-09 verdict). **In-progress gates re-verified unchanged:** Epic-010 (a) `migrate-credentials` still copy-only ("nothing to copy" — no legacy-key delete) + (d); Epic-012 recall still `messaging-reply`-only (**zero** recall refs in `lambdas/orchestrator/handler.ts`); Epic-016 OP-011/OP-012 (#436/#437) — still no perf/PR-refresh workflow in `.github/workflows/`. Epics 020–023 correctly `Accepted` with Stories filed + unbuilt (#452–#464). **Issue diff: 0 closed / 0 rewritten / 0 filed.** One deferred recommendation (operator-gated): file Epic-018's rollout Stories once/if the operator Accepts it.

> **Status reconciliation pass (2026-06-23).** The whole index was reconciled against the live codebase + development history by Mateo (platform/substrate), Dario (eng-excellence/pipeline), and Nadia (PM/console), pulling in Theo for the feed/messaging surfaces. Most Epics carried a stale `Draft` while the work had already shipped (often incidentally, out of the normal lifecycle), and two early designs (006, 007) were obsoleted by ADR-0007 before they were ever Accepted. Each Epic body now carries a dated **Status reconciliation** note explaining its bucket. Net: 7 Implemented, 2 In-progress, 4 Rejected/superseded, plus 008/014/016 advanced. Remaining genuine open work — Epic-006 S6 (slug `-NNN` disambiguation), Epic-010 (a)/(d) DoD gates, Epic-012 runner-injection, Epic-016 Phase-2 `sam deploy` — is called out in those bodies.
>
> **Status reconciliation pass (2026-07-01, Nadia — backlog-reconcile).** Daily backlog-reconcile audit of the plan vs. the shipped default branch. **The Epic index itself needed no status flips** — every Epic status line already matches reality (011/013/014/017 Implemented; 010/012/016 In-progress with genuine open gates; 001/005/006/007 Rejected/superseded). The drift this pass found is in the **GitHub tracker, not the docs**: the 2026-06-23 pass flipped Epics 011/013/014 to Implemented and cited their merging PRs, but their shipped **Story/tracker issues were never closed**. Evidenced-shipped and therefore closeable (pending operator sign-off — bulk closes are outward-facing): Epic-014 #316/#318/#319 (`GlobalSearch.tsx`, `SearchResults.tsx`, `lib/search.ts` — shipped by #320); Epic-013 #247/#249/#250/#251 (`Messaging.tsx`, `messaging-reply/handler.ts`, `shared/messaging.ts` `group_label` — #248/#249/#256/#341); Epic-011 #127/#129/#133/#134 (`Feed.tsx`; W-5 identity-paired via ADR-0007; `design-docs/aoi/feed-ui-v1.md` — #128/#130/#132/#352). **Left open as genuine remaining work** (verified NOT built, or off-repo runtime gates the reconciliation notes already flagged): Epic-014 **#321** (mobile affordance / `aria-live` count / search telemetry — none present in `GlobalSearch.tsx`); Epic-013 **#252** and Epic-011 **#135/#153** (production soak / post-deploy end-to-end verify — off-repo). No new issues filed this pass. **Issue diff proposed: 11 closed / 0 rewritten / 0 filed — batched for operator sign-off in the PR, not auto-applied.**
>
> **Status reconciliation pass (2026-07-03, Nadia — backlog-reconcile).** Daily audit of the plan vs. the shipped default branch (partition lenses: mateo/dario/nadia/aoi standing core). **The Epic index again needed no status flips** — all three In-progress epics have a verified-still-open gate, so none advance to Implemented: **Epic-010** (credential-vault UI unbuilt — no vault surface in `workforce/app/src/pages/`, no `WfSeedProjectsFunction` in `infra/sam/template.yaml`; #95 open); **Epic-012** (recall-into-runner still not wired — `buildRecallBlock` in `lambdas/shared/recall-prompt.ts` is called only from `messaging-reply/handler.ts`, zero `recall` refs in `lambdas/orchestrator/handler.ts`; #89/#212 open); **Epic-016** (neither OP-011 nor OP-012 shipped — no analytics/PR-refresh workflow in `.github/workflows/`). Epic-017 already Implemented (2026-06-29). The drift this pass is again **tracker-side, not docs**, and is entirely operator-sign-off-gated (issue mutations are outward-facing): **(a)** net-new closeable — **#379** (the Epic-017 tracker; Epic-017 flipped Implemented 2026-06-29 citing #388/#390–397/#401/#403/#404/#407/#409, but its tracker was never reconciled at issue level — the 07-01 pass only covered 011/013/014); **(b)** stale/obsolete-by-decision — **#183** (`listProjects` Scan→status-GSI: the current `lambdas/agents-api/handler.ts` `listProjects` was rewritten to `scanAllPrefix("PROJECT#","META")` with an explicit "≤ a few dozen at C-3 scale" comment, so the full-drain Scan is the *accepted* C-3 shape and the proposed GSI is a non-issue — the cited line and the band-aid PR #182 it complained about are both gone; recommend re-scope or close as won't-fix); **(c)** the **11 carry-over** shipped-but-open Story issues from the 07-01 pass (Epic-011 #127/#129/#133/#134, Epic-013 #247/#249/#250/#251, Epic-014 #316/#318/#319) remain open — still pending the same operator sign-off, restated here so the batch doesn't silently age out. **Genuine remaining work with no tracking issue: Epic-016 OP-011** (redeploy the `performance-reducer` for the widened `delivered` metric) **and OP-012** (schedule the daily GitHub-API PR-metrics refresh — no such workflow exists) — both named only in the Epic-016 body; propose filing one tracking issue each. **Issue diff proposed: up to 13 closed (11 carry-over + #379 + #183) / 0 rewritten / 2 to-file (OP-011, OP-012) — all batched for operator sign-off, none auto-applied by this PR.** #185 left open (its live-site symptom is mitigated by the deploy-time `workforce-skills.json` regen, but the requested PR-time stale-JSON CI gate is still absent).
>
> **Status reconciliation pass (2026-07-05, Nadia — backlog-reconcile, operator-directed).** The operator authorized the long-batched tracker true-up in-session, so this pass **applied** the issue diff instead of re-proposing it. Re-verified first against HEAD (`3d68010`; #430/#434/#371/#435 landed since 07-03) by the standing core fan-out (mateo/dario/nadia/aoi). **Epic index: 0 status flips** — every row still matches its file. **Applied: 14 closed** — the 11 carry-over shipped Story/tracker issues (Epic-011 #127/#129/#133/#134; Epic-013 #247/#249/#250/#251 — #249 noting the shipped auth is AWS_IAM, not the Bearer gate the Story named; Epic-014 #316/#318/#319), the Epic-017 tracker #379 (all residuals issue-tracked: #385/#398/#399/#400), and two won't-fix: #183 (`listProjects` GSI — obsoleted by the accepted C-3 `scanAllPrefix` shape) and #326 (prebuild-manifest fallback — contrary to the documented C-4 fail-loud posture in `build-agent-manifest.mjs`; a bounded retry is the C-4-compatible refile if flakes recur). **2 filed**: Epic-016 OP-011 → #436, OP-012 → #437 (previously live only in `follow-ups.md`; `epic-016` label added to `.github/labels.json`). **3 true-ups without close**: #185 (scope narrowed to the `workforce-skills.json` half — `workforce-agents.json` is now gitignored/regenerated, and #434's ADR-0018 version gate is a different mechanism), #95 (large slice shipped by #430 — `ProjectDirectory`/`ProjectProfile`/`CredentialVault` — member editor, task-editor `project_id` selector, EXEC-read migration and the Discord end-to-end acceptance remain), #93 (recall library verified fully built in `shared/recall.ts` + `exec-embedding.ts`; stale `wf:blocked` dropped; remaining = recall console UI + acceptance tests; the 06-30 "superseded by #212" proposal was **refuted** — Epic-012 consumes this Story, it does not supersede it). Still-open gates re-verified unchanged: Epic-010 (a) — now down to the bare-key deletion itself, the #430 vault UI cleared its tooling precondition — and (d); Epic-012 runner wiring (`buildRecallBlock` still messaging-reply-only; zero recall refs in `lambdas/orchestrator/handler.ts`); Epic-016 OP-011/OP-012 (now issue-tracked). Net open issues: **31 → 19**.

> **Daily reconciliation (2026-06-30, Nadia).** No new status flips — every Epic line is still true against `main`, and the genuinely-open DoD gates flagged on 06-23 have **not** closed (Epic-010 (a)/(d): `project.ts:690` still falls back to legacy `wf/${type}` and `migrate-credentials` is still a copier not a deleter; Epic-012: `buildRecallBlock` still wired only into `messaging-reply`, not the runner; Epic-016: OP-011/OP-012 still `open` in `follow-ups.md`; Epic-006 S6: `validate-naming.mjs` slug regex still `/^[a-z]+$/`). The **drift this run found is in the issue tracker, not the docs**: Implemented epics (011/013/014) and shipped Epic-010/017 stories still carry open Story/tracker issues. That issue diff (≈16 close, 1 relabel — #93 superseded by #212) is proposed for operator sign-off in the PR that carries this note; outward bulk closes are operator-gated and were **not** applied autonomously.

> **Index-sync reconciliation (2026-06-29).** `backlog-reconcile` (Nadia, PM/IA lens) re-grounded the index table against each Epic file's own Status line and the merged history since the 06-23 pass. One drift: **Epic-017** had advanced `Draft → In-progress` in its own file (Stories 1–7 #388, then automation #395 / persona cadences #396 / podcastStatus fix #393 / W-3 cap raise #390 / Notion-secret + IaC fixes #391·#392 — all merged after 06-23), but this index cell still read `Draft`. The cell is now synced to match the authoritative file status. No status *reclassification* was made (the Epic file already carried the correct bucket); this is a pure canonical-view sync. Epic-017 stays **In-progress** — its terminal "live on Spotify" gate (Story 6 #385 submission, Phase-2 #400 `spotifyUrl` automation) is still open, so no flip to `Implemented`. All other 16 rows verified consistent file-vs-index.

## Epic sizing guidance

An Epic is **"a user-meaningful outcome unit that's bigger than a single sprint can finish"**. The unit sits between Story (1–5 days) and Initiative / Theme (quarter+):

| Unit | Period | Content |
|---|---:|---|
| Task | hours — 2d | implementation step |
| Story | 1–5d | one slice of user value |
| **Epic** | **2 weeks — 2 months** | **multiple Stories bundled around one user / business outcome** |
| Initiative / Theme | quarter+ | product-level direction |

An Epic should be **decomposable into multiple Stories**. If it's only one Story, it shouldn't be an Epic.

### Good Epic shapes

- **Feature Epic** — customer-value-anchored: user management, billing, device management, notifications, dashboards, reports
- **Workflow Epic** — covers a business process end-to-end, not one screen: customer onboarding, plan change, field installation, incident response, monthly reporting
- **Platform Epic** — necessary but not directly user-visible. Auth, audit logging, multi-tenancy, external-API gateway, data pipeline, RBAC, security/compliance. **Even platform Epics state the user goal in plain language** (good: "multi-tenant users can sign in safely and only see what their role permits"; bad: "build an auth platform").

### What an Epic looks like, written down

```text
Epic名: <user-facing name in plain language>
目的:   <why the user / operator cares>
対象ユーザー: <named persona — not "everyone">
含む範囲:  <bulleted list of what's in>
含まない範囲: <bulleted list of what's deliberately out>
完了条件: <observable acceptance criteria>
```

### Don't make an Epic when …

- it's only a technical task with no user-visible value behind it
- the scope is so broad you can't see the end
- you'd phrase it as "platform improvement" (always too abstract)
- it's only one Story long
- it reads as a task list rather than an outcome

### Story / Task relationship

- **Epic : Story** is **M:N** — one Story can serve multiple Epics (e.g. "auth helpers" used by both `user-onboarding` and `admin-tooling` Epics).
- **Issue : PR** is **1:M**, typically **1:1**. Claude Code may split a Story into multiple PRs if it judges the work too large for a single review.
- **Stories live as GitHub issues**. Epics live in this directory.

## Why Epics, not just issues

Agents at this scale are an *organisation*, and an organisation changes shape under pressure. An issue describes one piece of work. An Epic describes the **decision** that the work expresses — what problem we noticed, what alternatives we considered, what we expect to be true after it ships, and what would tell us we were wrong.

Skipping the Epic step means the next reviewer (or the next agent generation) sees a merged PR with no decision context. The Epic is what survives migrations of personnel, models, and providers.
