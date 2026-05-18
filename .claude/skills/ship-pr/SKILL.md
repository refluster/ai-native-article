---
name: ship-pr
description: Take a freshly pushed branch all the way to a reviewable PR — open (or update) the PR, watch CI through to completion, resolve merge conflicts by rebasing onto the base, retry on transient failures, and only hand back to the operator once the PR is non-draft, mergeable, and CI-green. Use this at the end of every work stream that produces a PR, instead of opening a draft and stopping. Triggers on requests like "open a PR for this", "ship this branch", "hand off the change", "ready this PR for review".
---

# ship-pr

A PR is not "shipped" the moment it's opened. It's shipped when a reviewer can actually act on it: no draft tag, no conflicts, no red CI, no half-finished commits on the branch. This skill encodes the **hand-off contract** so that work isn't returned to the operator in a state that requires them to chase down a green build or do `git pull --rebase` first.

## The hand-off contract

Before saying "PR ready" in chat, the following must all be true. If any cannot be made true, report the specific blocker instead — do not hand over a half-shipped PR.

| Gate | Definition | Auto-fix attempted? |
|---|---|---|
| **G1. PR exists** | One open PR on the head branch, pointed at `main`. | Yes — `mcp__github__create_pull_request` if none. |
| **G2. No conflicts** | `mergeable_state` is `clean` or `unstable`, not `dirty`. | Yes — `git fetch origin main && git rebase origin/main`, resolve mechanical conflicts (delete-vs-modify → keep the side from the working branch; modify-vs-modify → escalate unless trivial), `git push --force-with-lease`. |
| **G3. CI green** | Every required check on the head commit is `success` (or skipped). No `pending` checks remain. | Partial — re-run flaky jobs once via `gh` UI (operator-driven for now); fix the failure if it's clearly from this branch's diff. |
| **G4. Not draft** | `draft: false`. | Yes — `mcp__github__update_pull_request` with `draft: false`, **after** G2 and G3 are satisfied. |
| **G5. No "WIP" markers** | Title does not start with `WIP:` / `[WIP]` / `Draft:`. PR body has no unchecked `## Blockers` items. | Yes — `mcp__github__update_pull_request` to strip WIP prefix when graduating. |
| **G6. Body is review-ready** | Summary + Test plan filled in. No raw stacktraces, no leftover TODO markers, no `xxx` / `TBD` placeholders. | No — these come from the work-stream's PR description and should already be clean. Report if not. |

When all six gates pass, **and only then**, reply to the operator with the PR URL and a one-line status.

## Workflow

```
                         ┌─────────────────────┐
                         │ branch pushed, work │
                         │ believed complete   │
                         └──────────┬──────────┘
                                    │
                                    ▼
                  ┌─────────────────────────────────────┐
                  │ 1. Ensure PR exists (G1)            │
                  │    list_pull_requests → if none,    │
                  │    create_pull_request(draft: true) │
                  └──────────────────┬──────────────────┘
                                     │
                                     ▼
                  ┌─────────────────────────────────────┐
                  │ 2. subscribe_pr_activity            │
                  │    (events wake the session;        │
                  │     do NOT poll with sleep)         │
                  └──────────────────┬──────────────────┘
                                     │
                                     ▼
                  ┌─────────────────────────────────────┐
                  │ 3. Check G2 (mergeable_state)       │
                  │    dirty → rebase onto main,        │
                  │             resolve, force-push,    │
                  │             loop to step 3          │
                  │    clean/unstable → step 4          │
                  └──────────────────┬──────────────────┘
                                     │
                                     ▼
                  ┌─────────────────────────────────────┐
                  │ 4. Wait for CI events (G3)          │
                  │    all green → step 5               │
                  │    any failure → diagnose:          │
                  │      this branch's bug → fix, push, │
                  │                          loop to 3  │
                  │      flaky → re-run once            │
                  │      out-of-scope → escalate        │
                  └──────────────────┬──────────────────┘
                                     │
                                     ▼
                  ┌─────────────────────────────────────┐
                  │ 5. Graduate (G4, G5)                │
                  │    update_pull_request(draft: false,│
                  │      title=strip "WIP:" prefix)     │
                  └──────────────────┬──────────────────┘
                                     │
                                     ▼
                  ┌─────────────────────────────────────┐
                  │ 6. Final verification (G6)          │
                  │    pull_request_read(get)           │
                  │    confirm draft:false,             │
                  │    mergeable_state in {clean,       │
                  │    unstable}, all checks pass.      │
                  └──────────────────┬──────────────────┘
                                     │
                                     ▼
                  ┌─────────────────────────────────────┐
                  │ 7. Hand back to operator with PR    │
                  │    URL + one-line status.           │
                  └─────────────────────────────────────┘
```

## Tool sequence (quick reference)

```text
# G1 — exists?
mcp__github__list_pull_requests(state=open, head=…:…)
  → empty: mcp__github__create_pull_request(draft=true, …)

# subscribe
mcp__github__subscribe_pr_activity(pullNumber)

# G2 — conflicts
mcp__github__pull_request_read(method=get, pullNumber)
  → mergeable_state == "dirty":
       Bash: git fetch origin main
             git rebase origin/main
             # resolve, then:
             git push --force-with-lease origin <branch>
       Loop until clean/unstable.

# G3 — CI
mcp__github__pull_request_read(method=get_check_runs, pullNumber)
  → wait for webhook events, do NOT Bash sleep.
  → any "failure" with conclusion in {failure, timed_out, cancelled}:
       diagnose; if this branch's bug, fix on the branch & push;
       if flaky, the operator can re-run — report and pause.

# G4/G5 — graduate
mcp__github__update_pull_request(draft=false,
  title=stripped_of_WIP, body=cleaned_if_needed)

# G6 — final verification
mcp__github__pull_request_read(method=get, pullNumber)
  → assert: draft=false, mergeable_state in {clean, unstable},
            all check_runs conclusion=success or skipped.
```

## Rebase conflict policy

Most conflicts on this repo are one of two shapes — resolve them mechanically and continue. Escalate only when the resolution carries meaning.

| Pattern | Resolution | Notes |
|---|---|---|
| **delete-vs-modify on a path you're deliberately deleting** (e.g. `workforce/` wipe-vs-incremental-edit) | `git rm <path>` then `git rebase --continue`. | Your branch's intent (delete) wins. Mention in the PR comment that an incoming change was overridden. |
| **content edit on the same line both sides** | Manual merge — read both sides, pick the semantic union, escalate if intent disagrees. | Use `AskUserQuestion` if the change in `main` looks like it should survive on your branch. |
| **lock file drift** (`package-lock.json`) | Take base's version, run `npm install` to regenerate against your `package.json`. | Never hand-merge `package-lock.json`. |
| **manifest / generated file** (`public/posts/manifest.json`, `public/sitemap.xml`) | Take base's version; regenerate via the appropriate script after rebase. | These are Zone D in `AGENTS.md` — regenerate, don't hand-edit. |
| **Zone A file you didn't intend to touch** (`AGENTS.md`, `DESIGN.md`, `tailwind.config.ts`, …) | Abort the rebase, ask the operator. | If your branch shouldn't have touched a Zone A file, you have a different problem upstream. |

Conflict resolution that requires *judgement* is not automatic. The rule of thumb: if you can describe the resolution in one sentence ("keep our delete", "regenerate from base", "drop the duplicate import"), proceed. If the sentence has a "but" in it, ask.

## CI failure triage

When a check fails, classify before fixing:

1. **Caused by this branch's diff** — clear fix path, do it: re-stage, re-commit, push. Re-enter the loop at G2.
2. **Pre-existing main failure** — re-running won't help. Report the failure as a blocker, do not graduate the PR. The user fixes upstream and the next event wakes the session.
3. **Transient / infra flake** (network timeouts, runner provisioning) — note it; if the same job fails twice on the same SHA, treat as case 1 or 2. Don't loop forever — three identical failures = report and pause.

Never bypass with `--no-verify`, never disable a check to ship.

## What to say at hand-off

A clean hand-off message is short:

> ✅ PR #25 ready for review — https://github.com/refluster/ai-native-article/pull/25
> No conflicts, CI green (4/4), un-drafted.

A blocked hand-off is also short, but names the blocker and what was tried:

> ⏸ PR #25 paused — CI check `build` failed with `TS2322` in src/types/agent.ts (this branch). I attempted one fix (export the union type) — failed the same way. Need a second look before I can graduate it.

Do not hand off with vague "should be ready, please check" wording. The reviewer should know whether they're being asked to review or to unblock.

## What this skill is **not** for

- **Merging PRs** — agents do not merge (`AGENTS.md` §1 Zone A, §2 R-6). This skill stops at graduation.
- **Force-pushing main** — never. Force-push is for the feature branch only (`AGENTS.md` §2 R-6).
- **Opening a new PR for an unrelated change** — one PR per logical change (`AGENTS.md` §2 R-1). If a fix you need to make grows past 30 lines or crosses zones, branch it off and ship it separately.
- **Skipping the contract because "the change is small"** — even a 1-line PR can have a conflict or red CI. Run all six gates every time. The cost is seconds; the cost of a sloppy hand-off is the operator's afternoon.

## Relation to other skills

- **gas-deploy-verify** — verifies a GAS deployment is live. Conceptually similar (don't return until the artifact is actually serving), but operates on a deployment, not a PR.
- **article-health** — content-domain check, not a PR-shape check. Independent.
- **subscribe_pr_activity** (MCP tool, not a skill) — this skill calls it; it is what makes the wait at G3 event-driven instead of poll-driven.
