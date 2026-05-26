# Workforce — Follow-ups index

A single index of "deferred to follow-up" items surfaced across PRs. The dev process ([dev-process.md](runbooks/dev-process.md)) requires every reviewer-flagged item to be **either fixed in the PR or named here**, never silent-dropped. This file is the index.

## Schema

Each row has:

- **#** — `FU-NNN` (engineering, governance, process) or `OP-NNN` (operator-action). Monotonically increasing.
- **Item** — one-line description.
- **Severity** — `L0` (blocks ship) / `L1` (Story-level) / `L2` (sweep at Epic boundary) / `L3` (eventual).
- **Source** — PR # or Epic ID where the finding originated.
- **Target** — concrete next anchor: Story #, separate PR scope, or "next Epic".
- **Owner** — engineering / governance / operator / `story-N` (when the resolution is folded into a specific Story's scope).
- **Status** — open / in-progress (`@PR#`) / ✅ done (`@PR#`) / ⛔ won't-do (with one-line rationale).
- **Notes** — context.

## Sweep cadence

- **Maya** sweeps the index at every Phase A (Epic kickoff) — pull anything `target = next Epic` into the new Epic's scope or re-target.
- **Author** confirms relevant FU-* items at Phase G (operator merge) — mark any rows the PR resolved as ✅.
- **Operator** sweeps OP-* rows at every stage-deploy.

## Open

| # | Item | Severity | Source | Target | Owner | Status | Notes |
|---|---|---|---|---|---|---|---|
| FU-001 | `pdm-charter` real implementation | L1 | retro 2026-05-27 | next Epic | maya | open | The next Epic should drive its first real handler. Today Epic → Story split is chat-driven. |
| FU-002 | `maya-route-pr` routine instantiation in claude.ai | L2 | retro 2026-05-27 | when conversational pattern saturates | operator | open | Spec at `routines/maya-route-pr.md`. Paste into CCR with `pull_request.opened` + `pull_request.synchronize` triggers. |
| FU-003 | Reviewer routine instantiation in claude.ai | L2 | retro 2026-05-27 | when conversational pattern saturates | operator | open | Specs at `routines/{dario,ren,aoi}-review.md`. CCR + API triggers from `maya-route-pr`. |
| FU-004 | Mechanical cycle counter CI lint | L1 | retro 2026-05-27 | separate PR | engineering | open | Count Maya-authored router comments per PR; fail build at cycle ≥ 8. Definition pinned to "router→verdict bundle" per `dev-process.md`. W-4 enforcement on the 7-cap. |
| FU-005 | Reviewer scope-creep enforcement | L2 | retro 2026-05-27 | after FU-004 | engineering | open | Cycle-2+ reviewer comments cite a cycle-1 finding-ID or are flagged `[NEW]`. Specs now mandate the ID convention; lint enforces. |
| FU-006 | Cross-PR pattern detection | L2 | retro 2026-05-27 | post-Story-6 | engineering | open | When two PRs in the same Epic make conflicting decisions, surface the conflict. Possibly an Epic-scoped audit Lambda. |
| FU-007 | `resolveProjectId` hoist to handler entry | L2 | PR #111 (Ren) | separate PR | engineering | open | Drop `?:` on `RunnerEvent.project_id` in favour of a private `ResolvedRunnerEvent`. |
| FU-008 | `aws-sdk-client-mock` standardisation | L2 | PR #111 (Ren) | before Story 2 lands | engineering | open | Replace hand-rolled SDK mocks in `backfill-tasks/handler-tests.ts`. ~5KB devDep. Settle before pattern multiplies. |
| FU-009 | `WfBackfillTasksErrorsAlarm` + `ReservedConcurrentExecutions: 1` | L2 | PR #111 (Ren) | separate PR | engineering | open | Mirror existing alarm pattern; add concurrency cap for operator-invoked Lambda safety. |
| FU-010 | `asProjectId` extra validation | L3 | PR #111 (backlog) | backlog | engineering | open | Reject `:` / `\n` / control chars in addition to current `#` / `|`. |
| FU-011 | Story 6 (#95) orphan-RUN reconciliation AC | L1 | PR #111 (Dario + Ren) | story-6 | story-6 | open | Pre-cutover one-shot emits EXEC for every RUN row missing its EXEC sibling. Filed on [#95](https://github.com/refluster/ai-native-article/issues/95). |
| FU-012 | Test-file naming convention in `naming.md` | L3 | PRs #100 / #110 (Ren) | next governance amend | governance | open | Formalise `*-tests.ts` (currently in `vitest.config.mjs`). |
| FU-013a | Extend `writeRunAndExec` to failure paths | L2 | PR #111 (Dario observation) | story-1-extension | engineering | open | Cover `failRun` / `throwRun` / `skipRun` so failure-path runs also emit EXEC rows. |
| FU-013b | Document failure-path EXEC asymmetry | L3 | PR #111 (Dario observation) | separate PR | engineering | open | If FU-013a is rejected, add a comment near the absence test naming the intentional asymmetry per Story 1-B scope. |
| FU-014 | `ccr-bootstrap.md` L82-L120 residual cleanup | L3 | PR #112 (Dario) | separate PR | governance | open | Header warns "ignore labels section" but ~30 lines of stale label-state-machine content remain. Excise or move instantiation steps to `routines/CCR-INSTANTIATE.md`. |
| FU-015 | `follow-ups.md` opened-date + grouping columns | L3 | PR #112 (Dario) | when index hits ~30 rows | governance | open | At 50 entries scan becomes hard. Add `Opened` column + group headings by owner/Epic. |
| FU-016 | Router-rule lint: lambdas/ → Ren always nominated | L2 | PR #112 (Ren) | with FU-004 | engineering | open | When `workforce/lambdas/` is touched, Maya's router comment must nominate Ren. Cheap lint on routing-comment text. |
| FU-017 | `pull_request_review_write` race avoidance | L3 | PR #112 (Dario procedural note) | with FU-002/-003 | engineering | open | Two concurrent reviewer agents stomp each other's pending review (one pending review per user). Maya's router should serialise reviewer dispatch, OR each reviewer should `delete_pending` any existing pending review before creating. |

## Operator-only action items (no PR needed)

| # | Item | Severity | Notes |
|---|---|---|---|
| OP-001 | `PROJECT#workforce-meta` DDB bootstrap | L1 per stage | Runbook at `runbooks/project-workforce-meta-bootstrap.md`. One-shot. |
| OP-002 | `wf-backfill-tasks` first invocation | L2 per stage | Runbook at `runbooks/backfill-tasks.md`. Expected today: 0 rows. |
| OP-003 | Instantiate reviewer + router CCR routines | L2 | When conversational pattern saturates. Specs in `routines/`. |

## Done

| # | Item | Resolved by | Notes |
|---|---|---|---|
| — | (none yet) | — | — |

## Won't do

| # | Item | Rationale |
|---|---|---|
| — | (none yet) | — |
