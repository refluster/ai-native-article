---
name: pr-remediate
description: Work every PR sitting in the autopilot AUTHOR lane (`autopilot:needs-author`) to a pushed fix — resolve a merge conflict with the base branch, update a behind branch, address the open blocking findings a reviewer panel left, or fix a failing check — then hand the PR back to pr-autopilot for re-review at cycle N+1. Bounded: three attempts per PR, after which it escalates to a human with `autopilot:needs-human`. The author-side half of the issue→merge loop (adr-0022); never merges, never pushes the default branch (R-N9). Runs as a CCR claude-code-routine task, fired on the binding's cron; github.token via the binding's project linkage.
---

# pr-remediate

**The gap this closes.** `pr-autopilot` reviews PRs; it cannot fix them — it is
comment-and-label only by construction (R-N9 / W-5). So a PR that reviewed 🟡
("the author is expected to revise"), or whose branch conflicted because another
PR merged first, waited for an author who does not exist: the workforce's PRs are
opened by fire-and-forget sessions that are long gone. The PR aged out and the
terminal-state sweep escalated it to the operator — correct behaviour, wrong
owner. Every such PR consumed a human decision for work no human needed to do.

This cadence is the missing author. It owns exactly one queue —
`is:open label:autopilot:needs-author` — and drives each PR in it to a pushed
fix or an honest hand-off.

**What you may and may not do.** You push commits to the PR's **head branch**
and nothing else. Never the default branch, never a merge, never an approval
(R-N9; this skill declares `external-pr`, not `external-pr-merge`). The review
of your fix belongs to `pr-autopilot`'s next tick — you are the author here, and
the author≠reviewer separation is the whole reason the merge leg is trustworthy.
Do not review your own fix in the PR thread beyond stating what you changed.

Your task context supplies `agent_slug` (you — the standing instance is Ren),
`project_id` (whose `project.json` names the target repo),
`credentials['github.token'].token` (export as `GITHUB_TOKEN`), and
`binding_config` (`max_prs_per_run`, `sign_off_persona`).

## Step 1 — discover the lane (deterministic, read-only)

```sh
GITHUB_TOKEN="<credentials['github.token'].token>" \
  node workforce/skills/pr-remediate/pr-remediate-scan.mjs \
    --project "<project_id>" --max <binding_config.max_prs_per_run ?? 3> \
    --out /tmp/pr-remediate-candidates.json
```

Each candidate carries its classified `remediation.kind`, the attempt counter
(`attempt_next` of `cap`), the hand-off reason codes, the failing checks, and the
reviewers' **verbatim** review bodies. **0 candidates is a first-class, cheap
outcome** — record the no-op and stop.

Never work a PR the scan classified `not-in-lane` or `terminal`, and never
"just one more" attempt on a `cap-exceeded` one — go to Step 5 for those two
non-actionable classes (`cap-exceeded` → escalate; `unclear` → escalate).

## Step 2 — work ONE PR at a time, in its own clone/worktree

Sequential, like `issue-implement`: a shared working tree cannot hold two PRs'
resolutions, and a half-resolved conflict pushed to a branch is worse than an
unfixed one. For each candidate, check out its `head.ref` and fix by kind:

**`merge-conflict` — the common case, and the one with the sharp edge.**
Merge the base branch into the head (`git fetch origin <base.ref> && git merge
origin/<base.ref>`), or rebase if that is the target repo's stated convention.
Then resolve each conflict **semantically**:

- Read *both* sides and the commits that produced them. A conflict is two
  intents meeting, not two text blocks — `git log --oneline <base>..HEAD` and
  `git log --oneline HEAD..<base>` tell you what each side was trying to do.
- Keep **both** intents whenever they are compatible. The failure mode to avoid
  is resolving by preference — taking one side wholesale because it is easier to
  read — which silently reverts whatever the other side shipped. If main added a
  step to a document your branch also edits, the resolution contains both steps.
- If the two intents genuinely conflict (both sides changed the same logic and
  keeping one loses the other's behaviour), that is **not yours to decide** —
  Step 5, `remediation-blocked`, quoting both sides.
- **Never resolve a conflict inside the target's L0/L1 / Zone A surface.** A
  governance doc, an ADR, an identity/prompt file, a workflow: resolving there
  is editing there, and those edits are the operator's. `pr-autopilot-post.mjs`
  already refuses to route such a PR into this lane, but check again here — the
  label may predate the guard. Escalate with `remediation-blocked`.

**`branch-behind`** — update the head from the base; no semantic work beyond
verifying the result still builds.

**`review-findings`** — read every review body in the candidate **as written**.
For each open blocking finding: implement the fix the reviewer named, or — when
you believe the finding is wrong — leave the code and write the rebuttal in the
Step 4 comment, citing the finding-ID. A rebuttal is a legitimate outcome; a
silently-ignored finding is not. Address findings by ID (`A1`, `B2`) so the next
cycle's reviewers can check them off.

**`checks-failing`** — read the failing job's log, fix the cause, and say in the
comment what the cause was. If the check fails for a reason outside the diff
(infrastructure, a broken base branch), do **not** patch around it: escalate with
`remediation-blocked` naming what you found. Bending a product failure into a
green check is the worst outcome this cadence can produce (C-4).

## Step 3 — verify before pushing

Discover and run the target repo's own gate — its `package.json` scripts, a
Makefile, the CI workflow's own commands — exactly as `issue-implement` does. A
conflict resolution that has not been run through the target's verification is
not a resolution; it is a guess that happens to compile. If a command cannot be
run, say so in the Step 4 comment rather than skipping it silently.

Push to the head branch (`git push origin <head.ref>`; `--force-with-lease` only
after a rebase — §5 permits feature-branch force-push, and only that).

## Step 4 — record the attempt (deterministic)

Write the body to `/tmp/remediation-<number>.md`:

```md
**<PersonaName> — remediation attempt <n> of ≤ 3.** <kind>

<what was wrong, in one sentence — the conflict/finding/check, not a summary of the PR>

**What changed:** <the resolution, and for a conflict: which intents were kept from each side>
**Findings addressed:** `A1` fixed in <sha> · `B2` — <rebuttal, if any> (omit when not a findings run)
**Verification:** <the exact commands run and their result>

Handing back to `pr-autopilot` — the next tick re-routes this at cycle N+1.

— <PersonaName> (CCR persona; see workforce/skills/pr-remediate/SKILL.md)
```

```sh
GITHUB_TOKEN="…" node workforce/skills/pr-remediate/pr-remediate-post.mjs \
  --project "<project_id>" --pr <number> --attempt <n> \
  --body-file /tmp/remediation-<number>.md --resolved
```

This stamps the `<!-- autopilot:remediation:<n> -->` marker (the lane's bound is
counted from it), clears `autopilot:needs-author` + the author-lane reason
labels, and leaves the PR for `pr-autopilot`. **Never `@`-mention a persona**
(ML-012) — the script refuses the post. Never post the record by hand or via an
MCP comment tool: that drops the label moves and strands the PR (ML-009's exact
shape, one lane over).

## Step 5 — escalate, with the same discipline (deterministic)

Three cases leave the lane for a human: `cap-exceeded` (attempts spent),
`unclear` (parked with no recognisable cause), and any judgment call above that
is not yours — an intent-level conflict, an L0/L1 surface, a check failing for a
reason outside the diff.

```sh
GITHUB_TOKEN="…" node workforce/skills/pr-remediate/pr-remediate-post.mjs \
  --project "<project_id>" --pr <number> --attempt <n> \
  --body-file /tmp/remediation-<number>.md \
  --blocked --reason remediation-blocked|remediation-cap-exceeded [--reason-text "…"]
```

The body states **exactly what a human must decide**, quoting both sides of a
conflict or the finding you could not resolve. "Could not fix" is not a hand-off;
it is a shrug. The script stamps `autopilot:needs-human` + the reason and clears
the author label, so the PR is in exactly one queue.

An attempt that escalates still **consumes an attempt** — the marker is written
on both shapes. That is deliberate: a PR bouncing between "tried and blocked" and
"re-parked" three times has a structural problem no fourth attempt will find.

## Scope

- **Drive the lane to empty.** A run that discovers candidates and pushes
  nothing, escalating none, is an incomplete run — the same standard
  `pr-autopilot` holds itself to.
- **Bounded by construction.** `REMEDIATION_CAP` (3) attempts per PR; the
  attempt marker is the counter; `pr-autopilot-sweep.mjs` independently escalates
  a PR that sits here untouched past `--author-stale-hours` (36) even if this
  cadence never fires. The lane cannot become a place PRs go to die.
- **Author, never merger.** No merge, no approve, no request-changes, no push to
  the default branch, under any path (R-N9; `external-pr`).
- **One PR at a time**, `max_prs_per_run` per fire.

## Out of scope

- Reviewing PRs (`pr-autopilot`), implementing issues (`issue-implement`),
  triaging the tracker (`issue-triage`), or opening new PRs of any kind.
- Any PR not in the author lane. If you believe a `needs-human` PR is actually
  agent-fixable, say so in a comment and leave the label alone — moving a PR out
  of the operator's queue is the operator's call.

Related: [adr-0022](../../docs/adr/adr-0022-issue-to-merge-flow.md) (the flow this
implements), [pr-autopilot](../pr-autopilot/SKILL.md) (the reviewer half and the
lane's other end), [issue-to-merge-flow runbook](../../docs/runbooks/issue-to-merge-flow.md),
[agent-runner.md](../../docs/routines/agent-runner.md).
