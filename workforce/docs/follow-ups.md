# Workforce — Follow-ups index

A single index of "deferred to follow-up" items surfaced across PRs. The dev process ([dev-process.md](runbooks/dev-process.md)) requires every reviewer-flagged item to be **either fixed in the PR or named here**, never silent-dropped. This file is the index.

When you defer something in a PR, add a row below. When you ship the follow-up, mark it ✅ with the merging PR number.

Sorted by status (open first) then by source PR. Sweep periodically; stale entries that are no longer worth doing → mark ⛔ with a one-line rationale.

## Open

| # | Item | Source | Owner | Notes |
|---|---|---|---|---|
| FU-001 | `pdm-charter` real implementation | Process retro 2026-05-27 | maya / operator | The next Epic should drive its first real handler. Currently the Epic → Story split is a chat-driven conversation. |
| FU-002 | `maya-route-pr` routine instantiation in claude.ai | Process retro 2026-05-27 | operator | The routine spec exists at `workforce/docs/routines/maya-route-pr.md`. Operator pastes it into a CCR routine with `pull_request.opened` + `pull_request.synchronize` triggers when ready to move past conversational routing. |
| FU-003 | Reviewer routine instantiation in claude.ai | Process retro 2026-05-27 | operator | Specs at `workforce/docs/routines/{dario,ren,aoi}-review.md`. Instantiate as CCR routines with API triggers so Maya's `maya-route-pr` can fire them. Conversational sub-agent reviewing works for now; instantiation removes the "Claude session must be open" dependency. |
| FU-004 | Mechanical cycle counter | Process retro 2026-05-27 | engineering | CI lint that counts Maya-authored PR comments and fails the build at 8+. Hard-enforces the ≤ 7 cycle cap. |
| FU-005 | Reviewer scope-creep enforcement | Process retro 2026-05-27 | engineering | Re-verify reviewer comments should cite the cycle-1 finding ID they map to. CI lint: any new finding in cycle 2+ must be flagged `[NEW]` or matched to a cycle-1 ID. |
| FU-006 | Cross-PR pattern detection | Process retro 2026-05-27 | engineering | When two PRs in the same Epic make conflicting decisions (e.g. one PR adds GSI3, another removes GSI2 without coordination), surface the conflict. Possibly an Epic-scoped audit Lambda. |
| FU-007 | `resolveProjectId` hoist to handler entry | PR #111 (Ren) | engineering | Drop the `?:` on `RunnerEvent.project_id` in favour of a private `ResolvedRunnerEvent` after entry-time normalisation. |
| FU-008 | `aws-sdk-client-mock` standardisation | PR #111 (Ren) | engineering | Replace hand-rolled SDK mocks in `backfill-tasks/handler-tests.ts` with `aws-sdk-client-mock` (~5KB devDep) before the same pattern multiplies across Stories 2-6. |
| FU-009 | `WfBackfillTasksErrorsAlarm` + `ReservedConcurrentExecutions: 1` | PR #111 (Ren) | engineering | Mirror the existing alarm pattern; add concurrency cap for operator-invoked Lambda safety. |
| FU-010 | `asProjectId` extra validation | PR #111 (backlog) | engineering | Reject `:` / `\n` / control chars in addition to current `#` / `|` exclusions. |
| FU-011 | Story 6 (#95) orphan-RUN reconciliation AC | PR #111 (Dario + Ren) | story-6 | Pre-cutover one-shot that emits EXEC for every RUN row missing its EXEC sibling. Filed as a comment on [#95](https://github.com/refluster/ai-native-article/issues/95). |
| FU-012 | Test-file naming convention in `naming.md` | PR #100 / PR #110 (Ren) | governance | The `*-tests.ts` workaround was the right call at the time but lives in `vitest.config.mjs` rather than `workforce/docs/naming.md`. Formalise it in the naming doc so the next test author finds it. |
| FU-013 | Failure-path EXEC dual-write | PR #111 (Dario observation) | story-1-extension | The `writeRunAndExec` wrapper covers the success seam (3 executors). The failure-path helpers (`failRun` / `throwRun` / `skipRun`) write a `row` variable directly. Either extend the wrapper or document the intentional asymmetry near the absence test. |

## Operator-only action items (no PR needed)

| # | Item | Status | Notes |
|---|---|---|---|
| OP-001 | `PROJECT#workforce-meta` DDB bootstrap | open | One-shot per stage; runbook at `workforce/docs/runbooks/project-workforce-meta-bootstrap.md`. |
| OP-002 | `wf-backfill-tasks` first invocation | open per stage | One-shot; runbook at `workforce/docs/runbooks/backfill-tasks.md`. Expected output today: 0 rows (no TASK rows exist yet). |
| OP-003 | Instantiate reviewer + router CCR routines | open | When the conversational pattern reaches its operational limit. Specs already exist; just paste into claude.ai/code/routines. |

## Done

| # | Item | Source | Resolved by |
|---|---|---|---|
| — | (none yet) | — | — |

## Won't do

| # | Item | Source | Rationale |
|---|---|---|---|
| — | (none yet) | — | — |
