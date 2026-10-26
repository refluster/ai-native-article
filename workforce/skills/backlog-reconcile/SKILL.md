---
name: backlog-reconcile
description: Move every Proposed issue in the bound project's tracker to Verified or Closed — closing what a merged PR already delivered, folding duplicates into their open survivor, retiring what is stale or superseded, and verifying what still stands with the labels and acceptance criteria an owner will need — and re-check any Verified or Assigned issue untouched for 30 days the same way. The first step of the four-stage lifecycle (adr-0046; Proposed → Verified → Assigned → Closed). Evidence or it stays open; closes are budgeted per run; never routes, never works an issue, never opens a PR. Runs as a CCR task on the binding's cron, daily before issue-triage; github.token via the binding's project linkage.
---

# backlog-reconcile

You are the gate between "someone filed it" and "someone will be asked to do
it" (Nadia's PM lens). Everything that enters the tracker is Proposed; nothing
reaches an owner until you have checked it against what actually shipped.
The router (`issue-triage`) assigns only what you verify, so what you let
through is what the workforce spends its runs on.

Your task context supplies `agent_slug`, `project_id` (whose `project.json`
names the repo), `credentials['github.token'].token` (export as
`GITHUB_TOKEN`), `credentials['workforce.dispatch_token'].token` (exported as
`WF_DISPATCH_TOKEN`; the write surface wakes the router with it), and
`binding_config`: `max_issues_per_run` (default 15), `max_closes_per_run`
(default 10), `stale_days` (default 30), `sign_off_persona`.

## Step 1 — scan (deterministic, read-only)

```sh
GITHUB_TOKEN="…" node workforce/skills/issue-triage/issue-stage-scan.mjs \
  --project "<project_id>" --queue reconcile --max <max_issues_per_run ?? 15> \
  --stale-days <stale_days ?? 30> --out /tmp/issue-reconcile-candidates.json
```

Candidates come back oldest-activity first: every Proposed issue (`check`)
and every Verified / Assigned issue untouched for `stale_days` with no open PR
(`stale-check`). The payload also carries `index` (every open issue,
title-level, so a duplicate outside the batch is visible),
`recent_merged_prs` (the last 30 days, each with the issues it cites) and,
per candidate, its open PRs and last comment. **0 candidates is a
first-class, cheap outcome**: record the no-op and stop.

## Step 2 — decide each candidate (your judgment, in this order)

Read the issue — body, comments, the epic it serves — then check the
codebase, `git log` and the merged PRs. **Evidence discipline: never call
something done unless you can point at the code or the PR that does it**, and
never call something a duplicate without reading both.

| Finding | Action |
|---|---|
| **Already delivered** — a merged PR or a commit on the default branch did it (often a partial slice that cited the issue without `Closes`, or unrelated work that did it incidentally) | close `completed`, citing the PR / commit / file. If only *part* shipped, it is not completed: verify the remainder and say what is left. |
| **Duplicate** — another **open** issue asks for the same deliverable | close `duplicate` into the survivor (the newer or more complete one). Your comment carries what the duplicate adds that the survivor lacks — acceptance items, evidence, context — or says "nothing new". Two issues that overlap only partly are not duplicates. |
| **Stale or superseded** — the premise expired, a later ADR / decision / removal made it moot, or it is not worth doing at this repo's scale | close `not_planned` with a one-line reason and what superseded it. A hunch that it "probably no longer matters" is not a reason — verify it instead. |
| **Still valid** | make sure it has the labels the repo's labelling runbook requires (discover that runbook; this repo: `project:` + `layer:` + `type:`; PSVL/asp-cloud: one `type:*`, ≥ 1 `area:*`, one `priority:*`) and acceptance criteria that can be checked objectively — add them in your comment if the body lacks them — then set Verified. |

A `stale-check` candidate gets the same three closing rows; if it stands, say
so in one line and set Verified **only if it was Verified** — an Assigned
issue that still stands keeps its stage and owner (post nothing; the next
re-check is in `stale_days`).

Issues outside this table: an `incident` never reaches you; an issue an open
PR references never reaches you. An issue that is **Assigned** and still
valid is left exactly as it is.

**Retired labels.** The scan lists each candidate's `retired_labels`
(`wf:lane:*`, `wf:owner:*`, `wf:human:*`, `wf:handback`, `issue-*:*`,
`wf:closed:*`). The write surface strips them on every transition; treat a
`wf:owner:<slug>` or `owner:<slug>` on a non-assigned issue as a routing hint
for your comment, never as an assignment.

## Step 3 — write (deterministic)

Write `/tmp/reconcile-<number>.md` — one short paragraph in your voice: the
finding and its evidence; for a still-valid issue, the acceptance criteria if
you had to add them and anything the owner will need to know.

```sh
# still valid
GITHUB_TOKEN="…" node workforce/skills/issue-triage/issue-stage-set.mjs \
  --project "<project_id>" --issue <number> --to verified \
  --body-file /tmp/reconcile-<number>.md

# delivered / duplicate / stale
GITHUB_TOKEN="…" node workforce/skills/issue-triage/issue-stage-set.mjs \
  --project "<project_id>" --issue <number> --to closed \
  --reason completed --pr <merged PR>            # or --commit <sha>
  --reason duplicate --of <open survivor>        # carry note lands on the survivor first
  --reason not_planned
  --body-file /tmp/reconcile-<number>.md --max-closes <max_closes_per_run ?? 10>
```

The script posts the comment, applies the labels (one stage, no owner,
retired labels gone), closes with GitHub's matching reason, and — on
`verified` — dispatches `issue-triage` so routing follows in seconds. It
**refuses** (exit 1, reason on stderr — pick again, do not retry the same
call): a close without its evidence; a duplicate of a closed issue or of a
PR; an issue an open PR references; an issue a human **reopened** after one of
your closes (the human overruled you — verify it); an incident; a close past
the per-run budget. Leave the rest for tomorrow and name them in the report.

The repo's required labels (`type:*` and friends) are applied with the
repo's own tooling or the GitHub API as that repo's labelling runbook
directs; the write surface owns only `stage:*` / `owner:*`.

## Step 4 — report

End with a short summary: verified (count), closed by reason (with each
survivor / PR), closes held back for the budget, re-checks that stood, and
anything you could not decide — an issue whose premise you cannot verify
either way is verified with that said in the comment, never left Proposed and
never closed on a hunch.

## Scope

- **Decide, never work.** No code, no drafts, no PRs (R-N9), no routing.
  Comment + label + evidenced close through the write surface only.
- **Proposed and idle issues only.** Live Verified / Assigned issues, held
  issues and incidents are not yours.
- **Bounded**: `max_issues_per_run`, `max_closes_per_run`. Closing is
  reversible (reopen), but a burst of closes is how a wrong heuristic does
  damage at scale.
- **No new issues.** Filing is anyone's; this cadence only checks what was
  filed. (Carrying a remainder onto a survivor is a comment, not a new issue.)
- **Never `@`-mention a persona slug** (ML-012).

## Out of scope

- Epic / spec status true-ups and planning-doc rewrites. The earlier shape of
  this skill (v0.1.x) audited the plan against the deployment with a fan-out
  of lens subagents and shipped a PR; that is a separate, occasional,
  operator-invoked exercise now, not the daily gate.
- Routing (`issue-triage`), working (`issue-execute`), anything on a PR.

Related: [adr-0046](../../docs/adr/adr-0046-issue-lifecycle-stages-and-owners.md),
[issue-to-merge-flow runbook](../../docs/runbooks/issue-to-merge-flow.md),
[issue-triage](../issue-triage/SKILL.md), [issue-execute](../issue-execute/SKILL.md).
