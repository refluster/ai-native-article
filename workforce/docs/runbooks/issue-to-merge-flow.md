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
node workforce/scripts/wire-pr-remediate-ren-asp-cloud.mjs         --dry-run

aws-vault exec <profile> -- node workforce/scripts/wire-issue-triage-nadia-agent-workforce.mjs
aws-vault exec <profile> -- node workforce/scripts/wire-issue-design-dario-agent-workforce.mjs
aws-vault exec <profile> -- node workforce/scripts/wire-pr-remediate-ren-agent-workforce.mjs
aws-vault exec <profile> -- node workforce/scripts/wire-pr-remediate-ren-asp-cloud.mjs
```

**One binding per (cadence × project) — the lane does not travel with the
reviewer.** `pr-autopilot` runs on both `agent-workforce` and `asp-cloud`, so it
routes PRs into `autopilot:needs-author` on both; `pr-remediate` was wired for
`agent-workforce` only, which left `asp-cloud`'s lane with no worker from the
day it shipped. Every PR parked there aged 36h and escalated `author-stale`
(PSVL/asp-cloud#692 and #693 are the worked example). **Whenever `pr-autopilot`
is wired for a new project, wire `pr-remediate` for it in the same session** —
the reviewer creates the queue that the remediation cadence is the only consumer
of.

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
| PRs piling up in `needs-author` | `pr-remediate` unbound / paused / failing | First check it is **bound for that project**: `GET /agents/ren` and look for `pr-remediate` with the matching `project_id` (this is what #692/#693 hit — the cadence existed, for a different project). The router's own log names it too: adr-0025's hand-off dispatch logs `404 binding_not_found` when nothing is wired. Then check the sweep (it should be escalating them as `author-stale` at 36h) and the binding's fire history. |
| Hand-offs land but the worker still starts on its cron | the adr-0025 dispatch is not reaching the endpoint | Look for `request-dispatch: no-op` in the router's fire log. `no WF_DISPATCH_TOKEN` = the skill's `meta.json:requires[]` bump has not seeded to the live `SKILL#` row (ADR-0018 version gate) or the deploy carrying the mint has not landed; `409 debounced` is normal (a live run owns the queue); anything else is the endpoint. Latency-only in every case — the cron and the 36h sweep are unaffected. |
| `author-stale` escalations every day | the cadence fires but cannot finish | Read its run log; the usual cause is a target-repo gate it cannot run. |
| Same PR escalating `remediation-cap-exceeded` repeatedly | a structural conflict no attempt will resolve | Resolve it by hand, or close the PR and re-cut the branch from `main`. |
| Issues sitting untriaged | `issue-triage` unbound, or its `max_issues_per_run` too small for the backlog | Raise the cap for a few fires; it is oldest-first, so it drains the tail. |
| An issue nobody can lane | the lane vocabulary is wrong for this project | The triage run reports it explicitly (Step 4). That report is the finding — amend the lanes in a new ADR, do not invent a label. |
| `needs-author` on an L0/L1 PR | a label predating the fail-closed guard | Move it to `needs-human --reason l0l1-path` by hand; the guard refuses new ones. |
| `autopilot:reason:no-reviewer-consensus` on a PR whose findings were **diff-local** | a label predating adr-0023 / the v3.1 rescope — the code used to mean "not unanimous green" | The PR is invisible to `pr-autopilot-scan.mjs` forever (`isTerminal()` keys on `autopilot:needs-human` alone; no sweep reaches an already-escalated PR). Re-post as `--needs-author --reason review-findings-blocking` with a remediation brief, **or** clear `autopilot:needs-human` so the next scan re-routes at cycle N+1. Enumerate the backlog with `is:open label:autopilot:needs-human label:autopilot:reason:no-reviewer-consensus`. Operator's button: clearing the label is a write on an existing PR, and note it also un-reds `check-escalation-labels.mjs` only once the PR leaves the open set — see FU-036. |

## Measuring whether the lane is healthy (adr-0025)

The lane's own counter is still owed (FU-029, the condition adr-0022 attached to
itself). Until it ships, the honest interim proxy is the **sweep's firing rate**:

```sh
# author-lane escalations that reached a human because nobody worked the PR
gh search prs --repo PSVL/asp-cloud --label autopilot:reason:author-stale --state all
```

Read it as: every `author-stale` is a PR the lane failed to serve. Before
adr-0025 the rate could not distinguish "the worker is slow", "the worker is
broken" and "there is no worker"; now a dispatched hand-off means the worker
*started*, so a surviving `author-stale` means it ran and could not finish —
which is a run log worth reading, not a wiring question.

## What this deliberately does not change

The R-N10 predicate, the L0/L1 path set, the ≥3-reviewer unanimous-green rule,
`MIN_REVIEWERS`, the kill-switches, W-5. No agent gained merge authority:
`pr-remediate` and `issue-design` both declare `external-pr`, never
`external-pr-merge`. The author lane is *tighter* than the merge leg on L0/L1 — it
refuses those PRs outright rather than escalating them.

Related: [bindings.md](bindings.md) (binding shape + the enable discipline),
[dev-process.md](dev-process.md), [pr-escalation-reasons.md](../pr-escalation-reasons.md) (taxonomy v3.1).
