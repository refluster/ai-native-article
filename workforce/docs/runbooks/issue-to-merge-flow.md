# Runbook — the issue→merge flow (adr-0022)

How a ticket becomes a merge without stopping, who owns each state, and what the
operator has to do to switch the new legs on.

Decision record: [adr-0022](../adr/adr-0022-issue-to-merge-flow.md). Metric:
[Epic-019](../epics/epic-019-autonomous-finalization-rate.md).

## The loop

```
                    ┌──────────────── issue-triage (nadia, daily) ───────────────┐
                    │  every open issue → exactly one lane + owner               │
                    │  parked *:needs-human > 14d → re-examined (not absorbing)  │
                    └───────────────┬───────────────┬───────────────┬────────────┘
                     wf:lane:implement   wf:lane:design   wf:lane:operator
                            │                   │                   │
                    issue-implement        issue-design          (operator)
                       (ren, daily)        (dario, daily)
                            └─────────┬─────────┘
                                 draft PR (R-N9: never a direct push to main)
                                      │
                    ┌─────────────────▼──────────────── pr-autopilot (nadia) ────┐
                    │  route → ≥3 isolated lens reviews → verdict                │
                    └──┬────────────────┬───────────────────────────┬────────────┘
                  🟢 predicate      agent-fixable                only-a-human
                       │        (conflict / behind / findings)         │
                    MERGED       autopilot:needs-author        autopilot:needs-human
                  (R-N10)                │                        (operator)
                                  pr-remediate (ren, daily)
                                  push to HEAD branch → clear label
                                         │
                                  back to pr-autopilot at cycle N+1
                                         │
                          bounded: 3 attempts, or 36h untouched → needs-human
```

**The invariant that makes this safe:** the terminal states are still exactly two
(MERGED / ESCALATED). Every interim state has a named worker *and* a mechanical
bound, so "in flight" can never quietly become "forgotten". `pr-autopilot-sweep.mjs`
enforces that on every fire, including for the new lane.

## Who owns what

| State | Label | Owner | Bound |
|---|---|---|---|
| Untriaged issue | — | `issue-triage` (nadia) | daily fire; oldest-first |
| Implementable | `wf:lane:implement` | `issue-implement` (ren) | `max_issues_per_run` |
| Decision/document | `wf:lane:design` | `issue-design` (dario) | `max_issues_per_run` (2) |
| Human-only | `wf:lane:operator` | operator | — (visible queue, stated action) |
| Parked issue | `issue-*:needs-human` | `issue-triage` re-queue | `requeue_days` (14) |
| PR in review | (routing comment) | `pr-autopilot` (nadia) | `cycle_cap`, W-4 cap 7 |
| PR, agent-fixable | `autopilot:needs-author` | `pr-remediate` (ren) | 3 attempts / 36h sweep |
| PR, human-gated | `autopilot:needs-human` | operator | — |

Operator queues, in one search each:

```
is:open label:autopilot:needs-human          # PRs that are mine
is:open label:autopilot:reviewed             # …of those, the merge-ready ones
is:open label:wf:lane:operator               # issues that are mine
is:open label:autopilot:needs-author         # what the agents are fixing right now
```

## Enabling it (operator, B-authority)

The three cadences ship **paused**: adding a binding is A-authority, enabling a
cron is B (governance.md §5). Each wire script declares its binding enabled in one
write (`scheduler=external` + `invoked_by=api` + cron, atomically — never the
`manual`+cron dead-cron state), so *running the script is the enable*.

### Step 0 — seed the three skill bodies FIRST (`wf:ren` R2 on #518)

A binding whose `skill` has no `SKILL#` row fails **every** fire, loudly and
forever: `agent-runner.md` step 2 resolves the body with `GET /skills/{skill}` and
refuses to fall back to the git copy on a non-2xx. Merging this PR puts the skill
folders in git; it does **not** create the DDB rows. So the data-plane seed runs
before any wire script:

```sh
# after the PR merges + the data-plane deploy that carries the seed
aws-vault exec <profile> -- node workforce/scripts/seed-skills.mjs
# verify all three resolve before wiring anything
for s in issue-triage issue-design pr-remediate; do
  curl -sS "$WF_AGENTS_API_BASE/skills/$s" -o /dev/null -w "$s %{http_code}\n"
done   # each MUST be 200
```

If any is not 200, stop — wiring on top of it creates a cadence that throws on
every fire until someone notices. The same gate applies to the `pr-autopilot`
body bump (ADR-0018 version-gated sync, see the activation note below).

```sh
# dry-run each first — they print the PATCH without sending it
node workforce/scripts/wire-issue-triage-nadia-agent-workforce.mjs --dry-run
node workforce/scripts/wire-issue-design-dario-agent-workforce.mjs --dry-run
node workforce/scripts/wire-pr-remediate-ren-agent-workforce.mjs   --dry-run

aws-vault exec <profile> -- node workforce/scripts/wire-issue-triage-nadia-agent-workforce.mjs
aws-vault exec <profile> -- node workforce/scripts/wire-issue-design-dario-agent-workforce.mjs
aws-vault exec <profile> -- node workforce/scripts/wire-pr-remediate-ren-agent-workforce.mjs
```

**Order matters, and there is a deliberate gap in the middle.**

1. **Wire `issue-triage` first, and let it run for at least one full cycle.**
   Until issues carry `wf:lane:*` labels, nothing downstream can filter on them.
2. **Then wire `issue-design`** — its Step 1 is lane-filtered, so before step 1
   has run it simply finds nothing (a cheap no-op, not an error).
3. **`issue-implement` keeps taking un-laned issues until you say otherwise.**
   Its binding is deliberately *not* changed by this work: adding
   `issue_selection.allow_labels: ["wf:lane:implement"]` is a separate operator
   edit, made once triage has demonstrably laned the backlog. Doing it earlier
   would stop the engineer cadence dead for a cycle.
4. **`pr-remediate` can be wired any time** — it is independent of the lanes, and
   the PRs it works are labelled by `pr-autopilot`/`pr-merge` already.

**Skill-body activation (ADR-0018).** Merging the PR changes git only. The running
`pr-autopilot` keeps its current body until the matching `PATCH /skills/pr-autopilot`
(version-gated seed) lands — so the router will not pass `--needs-author` until
then. Everything degrades safely in that window: the scripts accept the flag, the
old body simply never sends it, and the merge engine's own refusal path already
routes conflicts into the lane.

## When it stalls

| Symptom | Likely cause | Action |
|---|---|---|
| PRs piling up in `needs-author` | `pr-remediate` unbound / paused / failing | Check the sweep — it should already be escalating them as `author-stale` (36h). Then check the binding's fire history. |
| `author-stale` escalations every day | the cadence fires but cannot finish | Read its run log; the usual cause is a target-repo gate it cannot run. |
| Same PR escalating `remediation-cap-exceeded` repeatedly | a structural conflict no attempt will resolve | Resolve it by hand, or close the PR and re-cut the branch from `main`. |
| Issues sitting untriaged | `issue-triage` unbound, or its `max_issues_per_run` too small for the backlog | Raise the cap for a few fires; it is oldest-first, so it drains the tail. |
| An issue nobody can lane | the lane vocabulary is wrong for this project | The triage run reports it explicitly (Step 4). That report is the finding — amend the lanes in a new ADR, do not invent a label. |
| `needs-author` on an L0/L1 PR | a label predating the fail-closed guard | Move it to `needs-human --reason l0l1-path` by hand; the guard refuses new ones. |
| `autopilot:reason:no-reviewer-consensus` on a PR whose findings were **diff-local** | a label predating adr-0023 / the v3.1 rescope — the code used to mean "not unanimous green" | The PR is invisible to `pr-autopilot-scan.mjs` forever (`isTerminal()` keys on `autopilot:needs-human` alone; no sweep reaches an already-escalated PR). Re-post as `--needs-author --reason review-findings-blocking` with a remediation brief, **or** clear `autopilot:needs-human` so the next scan re-routes at cycle N+1. Enumerate the backlog with `is:open label:autopilot:needs-human label:autopilot:reason:no-reviewer-consensus`. Operator's button: clearing the label is a write on an existing PR, and note it also un-reds `check-escalation-labels.mjs` only once the PR leaves the open set — see FU-036. |

## What this deliberately does not change

The R-N10 predicate, the L0/L1 path set, the ≥3-reviewer unanimous-green rule,
`MIN_REVIEWERS`, the kill-switches, W-5. No agent gained merge authority:
`pr-remediate` and `issue-design` both declare `external-pr`, never
`external-pr-merge`. The author lane is *tighter* than the merge leg on L0/L1 — it
refuses those PRs outright rather than escalating them.

Related: [bindings.md](bindings.md) (binding shape + the enable discipline),
[dev-process.md](dev-process.md), [pr-escalation-reasons.md](../pr-escalation-reasons.md) (taxonomy v3.1).
