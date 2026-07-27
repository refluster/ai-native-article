---
name: issue-implement
description: Pick up to a bounded batch of open GitHub issues from the bound project's tracker, catch up on each issue's referenced epic/design doc plus the target repo's own governance (ADRs, CONTRIBUTING, its own CLAUDE.md/AGENTS.md-equivalent) and the surrounding code, then implement the change end-to-end and open a draft PR per issue — never merging. Use when a project's open-issue backlog should be worked continuously by an engineer persona instead of hand-dispatched one task at a time.
---

# issue-implement

A **claude-code-routine** skill (R-N1(a)): it runs in a live Claude Code session
because it needs to clone/read/edit a real working tree, run the target repo's
own build/lint/test commands, and drive branches + PRs — none of which a Lambda
can host. It is fired on a **daily binding** by the orchestrator-tick CCR path
(`scheduler=external`, `invoked_by=api`, `routine_spec=`
[`workforce/docs/routines/agent-runner.md`](../../docs/routines/agent-runner.md),
the same generic runner every claude-code-routine skill shares).

The job: an external project's issue tracker accumulates ready-to-build work
faster than a human can dispatch it one at a time. This skill closes that gap —
it reads a handful of open issues, does the homework a careful engineer would
do before touching code (the epic/design doc behind the issue, the repo's own
legal framework, the existing code shape), implements the smallest correct
change, and ships it as a draft PR. It never merges (R-N9 + the action-authority
matrix: agents don't merge except a delegated **R-N10** `external-pr-merge`,
which this skill does **not** declare) and it never pushes to the target's
default branch directly — every deliverable is an `external-pr`.

> **Nothing here is hard-coded to one repo.** Doc paths, label vocabulary, and
> branch/PR conventions are **discovered at run time** (Step 1), the same
> "discover, don't assume" discipline `backlog-reconcile` uses. Where this
> document gives an example (a label name, a file path) it is illustrative,
> not a fixed contract.

## Inputs / run context

Supplied by the generic agent-runner on every fire (same shape as every
claude-code-routine skill): `agent_slug` (the engineer persona — the standing
instance is Ren), `project_id` (the bound project; its `project.json` declares
the target `github.{owner,repo}` and `governance_docs`), `credentials['github.token'].token`
(the project-scoped PAT — export it for every GitHub call below), and
`binding_config` (this run's overlay — see fields below). `run_id` is the
fire's own correlation id; you need it for the PR citation in Step 5.

`binding_config` fields this skill reads:

- `max_issues_per_run` — hard cap on issues worked in one fire. **Never exceed
  this**, even if more candidates qualify. Absent → default **3**.
- `issue_selection` — optional filters layered onto Step 1 (label allow/deny
  lists, an assignee rule, a priority-label sort key). Absent → the Step 1
  defaults apply as-is.
- `sign_off_persona` — the slug that signs PR bodies and issue comments.

## Step 1 — discover candidates (read-only)

List the target repo's open issues (`list_issues` / `search_issues`, newest
activity first is fine — this is a backlog worked continuously, not a queue
with strict FIFO order). An issue is **eligible** when all hold:

- It is not already claimed: no open PR exists whose body references it
  (`Closes #N` / `Fixes #N` / `Resolves #N`, or a head branch matching this
  skill's naming convention below), and it does not carry this skill's
  in-progress marker label (`issue-implement:in-progress`).
- It does not carry a label signalling it isn't ready for autonomous
  implementation — the illustrative default deny-list is `blocked`,
  `needs-design`, `discussion`, `duplicate`, `wontfix`, `question`; override
  via `binding_config.issue_selection.deny_labels`.
- It is unassigned, or assigned to this run's `agent_slug` /
  `sign_off_persona`. Don't pick up an issue a human already has in hand.
- Apply `binding_config.issue_selection.allow_labels` / `.priority_label` if
  present (allow-list narrows the pool; the priority label sorts it).

Take the first `max_issues_per_run` eligible issues (default 3). **Zero
eligible candidates is a first-class, cheap outcome** — record a one-line
no-op and stop. Don't force work that isn't there.

## Step 2 — work each candidate to completion, one at a time

Process issues **sequentially**, each in its own branch off the target's
default branch, each driven to a draft PR (or an explicit skip — Step 6)
before starting the next. Don't parallelize within one fire: a shared working
tree can't hold two issues' edits at once, and a half-finished issue is worse
than one fewer issue finished. Branch name: `ren/issue-<N>-<short-kebab-slug>`
(swap the persona prefix for `agent_slug` if this binding is ever reused by a
different engineer persona).

Apply the mandatory label `issue-implement:in-progress` to the issue before
starting work on it (so a concurrent or next-day fire's Step 1 skips it), and
remove it whichever way Step 5/6 resolves (PR opened, or skipped-with-reason).

## Step 3 — catch up before touching code

This is the step that separates a careful engineer from a naive one. Do all
of it before writing a line of code:

1. **Read the full issue** — body, every comment, any linked issues/PRs.
2. **Find and read the epic / design doc it serves.** Look for an explicit
   reference in the issue body (a link, an "Epic:" / "Design doc:" field, a
   parent-issue relationship, a milestone tied to a doc). If the issue
   references one, read it **in full**, not just the linked section — an
   issue is a slice of an epic's intent, and the slice can mislead without
   the whole. If no epic is referenced, that's a valid state (a standalone
   bug/chore) — don't invent one.
3. **Read the target repo's own legal framework.** Start from
   `project.json:governance_docs` (fetched from the target repo, not this
   one), then discover further: an `AGENTS.md` / `CLAUDE.md` at the repo
   root, a `CONTRIBUTING.md`, an ADR directory (`docs/adr/`, `adr/`,
   `docs/decisions/`, whatever the repo actually uses), a `CODEOWNERS`. Treat
   whatever invariants that repo declares for itself with the same weight
   this repo's own CLAUDE.md asks of you here — a request that would force a
   violation of the **target repo's own rules** gets escalated (Step 6), not
   creatively reinterpreted.
4. **Read the code.** Locate the subsystem the issue touches, its existing
   tests, and the surrounding conventions (naming, error handling, the
   repo's own idioms) — match them; don't import this repo's style into a
   different codebase.

If Steps 3.2–3.4 turn up a conflict — the issue asks for something the epic
doesn't call for, or something an ADR/governance doc forbids, or the "fix"
would require a decision only a human should make — stop and go to Step 6
instead of guessing.

## Step 4 — implement

- Make the **smallest correct change** that satisfies the issue's stated
  acceptance criteria (or, absent explicit criteria, the issue's plain-read
  intent, cross-checked against the epic). No drive-by refactors, no
  unrelated cleanup, no speculative abstraction — the same discipline this
  repo's own CLAUDE.md asks of any implementer.
- Add or extend tests when the target repo has a test suite covering the
  touched surface.
- **Verify before shipping.** Discover and run the repo's own gate — its
  `package.json` scripts, a `Makefile`, or the CI workflow file's own
  commands (lint / typecheck / build / test, whichever exist). A change that
  hasn't been run through the target's own verification is not done; if a
  command doesn't exist, say so in the PR rather than silently skipping.
- If the issue is genuinely too large for one coherent PR, implement the
  smallest complete, mergeable slice and say exactly what's left — both in
  the PR body and as a comment on the issue — rather than either stalling or
  shipping something half-built.

## Step 5 — open the draft PR (never merge, never push default branch)

This skill's deliverable is `external-pr` **only** — R-N9 applies exactly as
it does to every external target: never a direct commit to the default
branch, always a Pull Request. This skill does not declare
`external-pr-merge`; do not merge, approve, or request-changes on the PR you
open, regardless of how confident the change is (the action-authority matrix:
agents don't merge outside a delegated R-N10 grant, which this binding
doesn't have).

The PR body **must** include, per R-N9's citation requirement:

```md
Closes #<issue-number>

<one-paragraph summary: what changed and why, in the issue's own terms>

**Epic / design doc consulted:** <path or "none referenced">
**Governance consulted:** <the governance_docs + any ADR/CONTRIBUTING files you read>
**Test plan:** <the exact commands you ran and their result>

wf-task-id: <run_id>
wf-agent: <agent_slug>

---
Authored by an LLM persona (workforce `issue-implement`, R-N1(a)). Verify
before merging.
```

Push the branch, open the PR as a **draft**, replace the issue's
`issue-implement:in-progress` label with `issue-implement:pr-open`, and post
a short comment on the issue linking the PR.

## Step 6 — skip with a reason (never silently drop an issue)

When Step 3 surfaces a blocker — ambiguous scope, a conflict with the
target's own governance, or a decision only a human should make — do **not**
implement a guess. Instead:

- Post a comment on the issue naming the specific blocker (quote the
  ambiguous clause, cite the governance doc/ADR that conflicts, or state the
  decision that's needed) so a human has exactly what they need to unblock
  it.
- Replace `issue-implement:in-progress` with `issue-implement:needs-human`.
- Move on to the next candidate. A skip is a normal, cheap outcome — not a
  failure of the run.

An issue already carrying `issue-implement:needs-human` is excluded by Step
1's eligibility check; an operator (or the issue author) clears the label to
requeue it once the blocker is resolved.

## Guardrails

- **R-N9, absolute.** External-git delivery is PR-only. No direct commit or
  push to the target's default branch, ever.
- **Never merge.** Every PR this skill opens is draft, hands off to whatever
  review path the target project already uses (e.g. `pr-autopilot` if bound),
  and is the operator's or a human maintainer's to merge.
- **Never `@`-mention a persona slug raw** in any posted comment/PR body
  (ML-012) — GitHub usernames can collide with workforce slugs. Wrap
  references in backticks.
- **Catch-up is not optional.** Step 3 runs in full for every issue, even a
  one-line-looking fix — the epic/governance read is what prevents a
  plausible-looking change that quietly violates the target's own rules.
- **Bounded batch.** Never exceed `max_issues_per_run` issues in one fire,
  even with more eligible candidates sitting in the tracker — the daily
  cadence, not a single run, works down the backlog.
- **Fail loud (W-4).** A GitHub API error, an unreadable/missing governance
  doc the issue explicitly depends on, or a verification command that can't
  be run throws / surfaces in the run output — never a silent partial PR.

## Out of scope

- Merging anything (see Guardrails).
- Reviewing PRs other agents or humans opened — that's `pr-autopilot`'s job.
- Authoring new epics or filing new issues — this skill only implements what
  is already filed and eligible; `backlog-reconcile` is the skill that trues
  up the tracker itself.
- Issues this skill cannot scope a single coherent PR for even at minimum
  slice size — skip per Step 6 rather than force it.
