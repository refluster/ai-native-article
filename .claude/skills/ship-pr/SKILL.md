---
name: ship-pr
description: Drive a freshly-opened draft PR all the way to "all CI green + no unresolved review threads, then flipped Ready for Review" before handing back to the operator. Polls check runs via the GitHub MCP, diagnoses failures, pushes fixes, and only un-drafts when the PR is genuinely review-ready. Use after opening a draft PR with mcp__github__create_pull_request — instead of returning to the operator with "PR is open" while CI is still queued. Triggers on requests like "ship the PR", "drive PR to green", "make PR review-ready", "don't hand it over until CI passes".
---

# ship-pr

Codify the protocol for handing a PR back to the operator only when it is **genuinely ready to review** — never with CI still running, never with a known-failing check, never as a draft when the work itself is complete.

## Why a skill

Without this protocol, the default "open draft PR → end turn" pattern surfaces an alert to the operator that says nothing useful: they look, see CI queued, and have to come back later. Or worse, CI fails and the operator finds out before the agent does. The handoff contract this skill enforces:

> When the agent says "the PR is ready", the operator should be able to open it, click Review, and start reading. Not wait. Not check CI. Not nudge.

If CI is genuinely broken in a way the agent can't fix, the agent says **that** instead — explicitly, with a diagnosis. Silence-while-red is the failure mode.

## When to use

- Immediately after `mcp__github__create_pull_request` with `draft: true`.
- After any push that re-triggers CI on an already-open PR (e.g. a fixup commit on a `Ready for Review` PR — the same loop applies; this skill un-drafts as a no-op if already non-draft).

## When NOT to use

- For PRs the operator explicitly wants to keep as draft (work-in-progress sign, asking for early feedback). The operator signals this by saying "leave it draft" — respect it.
- For PRs on repos outside this session's `Repository Scope` allowlist (the GitHub MCP will deny anyway, but don't waste turns trying).
- For PRs whose CI deliberately requires an external trigger (e.g. waits for a maintainer label). Skip and surface the dependency.

## The loop

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. After create_pull_request: subscribe to PR activity                       │
│       mcp__github__subscribe_pr_activity                                    │
│    Then end the turn. CI completion arrives as a <github-webhook-activity> │
│    event and wakes the session.                                             │
│                                                                             │
│    Fallback when subscription is unavailable: poll with Monitor (see below).│
│                                                                             │
│ 2. On each wake / poll tick, call:                                          │
│       mcp__github__pull_request_read method=get_check_runs                  │
│    Inspect every check run's {status, conclusion}.                          │
│                                                                             │
│ 3. Decide based on the aggregate:                                           │
│    a. Any status != "completed" → still running. Wait for the next event.   │
│    b. All conclusions == "success" or "skipped" → proceed to step 4.        │
│    c. Any conclusion in {"failure", "cancelled", "timed_out",               │
│       "action_required"} → diagnose (step 5) and fix.                       │
│                                                                             │
│ 4. Verify no unresolved review threads:                                     │
│       mcp__github__pull_request_read method=get_review_comments             │
│    For any unresolved thread, address it before un-drafting (see            │
│    "Unresolved review threads" below).                                      │
│                                                                             │
│    Then flip draft → ready:                                                 │
│       mcp__github__update_pull_request draft=false                          │
│    Report the green status to the operator in one short sentence with the   │
│    PR URL. Done.                                                            │
│                                                                             │
│ 5. CI failure diagnosis:                                                    │
│    - Read the failing check's details_url for log content (via WebFetch     │
│      on the html_url, or by mapping the run to logs via mcp__github__       │
│      list_commits if available).                                            │
│    - Cross-check against the diff: mcp__github__pull_request_read           │
│      method=get_diff to confirm which file the failure is in.               │
│    - If the failure is tractable and small (lint, type error, missing       │
│      import, naming-lint violation): fix it locally, commit with a focused  │
│      message (e.g. "fix(workforce): satisfy R-N7 on rfc-008 path"), push,   │
│      and return to step 2.                                                  │
│    - If the failure is ambiguous, architecturally significant, or would     │
│      require a destructive operation (force-push to overwrite published     │
│      commits, --no-verify, disabling a CI step), STOP. Surface the          │
│      diagnosis to the operator with the failing check's URL and ask.       │
│      Do NOT undraft.                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Subscribing vs polling

**Prefer subscription.** In environments that support `mcp__github__subscribe_pr_activity`, subscribe once and end the turn. PR webhook events (`<github-webhook-activity>`) wake the session on every check-run conclusion and review event, so the loop above runs once per *real* state change rather than on a clock.

**Polling fallback.** When subscription is not available (no GitHub MCP, or running locally without webhooks), use `Monitor` with a poll loop that emits one line per *terminal* check-run state, exiting once every check has reached `completed`:

```
prev=""
while true; do
  s=$(mcp_call get_check_runs ...)              # pseudo-CLI; adapt to env
  cur=$(jq -r '.check_runs[] | select(.status=="completed") | "\(.name): \(.conclusion)"' <<<"$s" | sort)
  comm -13 <(echo "$prev") <(echo "$cur")        # emit newly-completed checks
  prev=$cur
  jq -e '.check_runs | all(.status=="completed")' <<<"$s" >/dev/null && break
  sleep 30
done
```

Pick the poll interval at 30–60s. GitHub rate-limits aggressively under 10s.

**Never `sleep` in Bash to wait for CI.** `sleep` blocks the turn and burns wall-clock for no benefit. Either subscribe (event-driven) or Monitor (background, emits per occurrence).

## What "review-ready" means

All four must hold before un-drafting:

1. **All check runs `completed` with `conclusion in {success, skipped, neutral}`**. No `failure`, no `cancelled`, no `timed_out`.
2. **No unresolved review threads.** A new draft PR usually has none; this matters more when re-running ship-pr after a review round.
3. **The PR head SHA matches the local branch.** If a fix was pushed in step 5, confirm `git rev-parse HEAD` equals the PR head before flipping draft.
4. **The PR is currently a draft** (otherwise the flip is a no-op — fine, just skip the update call).

## Unresolved review threads

When ship-pr is invoked on a PR that has prior review activity:

- For each unresolved thread, decide:
  - **Actionable, small, unambiguous** — fix it, push, recheck CI, and on next ship-pr loop the thread should be addressed by the reviewer marking resolved (or the agent resolving via `mcp__github__resolve_review_thread` if the reviewer's intent is unambiguously satisfied by the fix).
  - **Ambiguous or architecturally significant** — leave the thread open and surface it to the operator. Do NOT un-draft.
  - **Already-stale** (the comment refers to code that no longer exists in the diff) — call `mcp__github__resolve_review_thread`.

## Failure modes

- **CI flake — re-run helps.** If a check fails with a transient error (network, runner died), re-running the workflow is acceptable once. Use the GitHub web "Re-run failed jobs" via `mcp__github__update_pull_request_branch` (which updates head and re-triggers PR-triggered workflows) or by closing/reopening the PR. Two consecutive flakes on the same job → surface, don't re-run a third time.
- **Skill-incompatible CI.** Some checks require external state (a label, a maintainer review, a dependent PR landing). ship-pr can't drive these; surface the dependency in the handoff message.
- **Pre-commit / pre-push hook fails on a fix push.** Per CLAUDE.md: never bypass hooks. Diagnose, fix the underlying issue, create a new commit, push.

## The end state

When everything passes, ship-pr's final action is one message to the operator, format:

> PR #N is green and ready for review: <url>.

Optionally one line per non-trivial fix that was applied during the loop. Nothing else. The PR body and diff are the record of what was done.

## Out of scope

- **Merging.** Agents never merge (workforce governance §5; root AGENTS.md R-6). ship-pr stops at "ready for review".
- **Asking for reviewers.** Reviewer assignment is the operator's call.
- **PR description quality.** ship-pr does not rewrite the PR body; that's the create_pull_request call's job.
- **Cross-PR dependency resolution.** If PR-B depends on PR-A landing first, surface it; don't try to chain.
