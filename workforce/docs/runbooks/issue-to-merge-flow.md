# Runbook — the issue→merge flow (adr-0022)

How a ticket becomes a merge without stopping, who owns each state, and what the
operator has to do to switch the new legs on.

Decision record: [adr-0022](../adr/adr-0022-issue-to-merge-flow.md). Metric:
[Epic-019](../epics/epic-019-autonomous-finalization-rate.md).

## The loop

```
                    ┌──────────────── issue-triage (nadia, daily) ───────────────┐
                    │  every open issue → exactly one lane + owner               │
                    │  wf:handback → answered NOW · legacy park >14d → re-examined│
                    │  bounded: HOP_CAP 3 routings → forced to operator          │
                    └───────────────┬───────────────┬───────────────┬────────────┘
                     wf:lane:implement   wf:lane:design   wf:lane:operator
                            │                   │            + wf:human:<role>
                            │                   │                   │
                    issue-implement        issue-design          (operator)
                       (ren, daily)        (dario, daily)      the act is named
                            │                   │
                            │  can't take it? ──┴──► wf:handback ──┐
                            │  (issue-handback.mjs)                │
                            │                    dispatches issue-triage, seconds
                            │                                      │
                            └─────────┬─────────┘◄─────────────────┘
                                 draft PR (R-N9: never a direct push to main)
                                      │  dispatches pr-autopilot, seconds
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
enforces that on every PR fire; on the intake side the bound is `HOP_CAP` (3
routings, then the operator lane) and the worker of last resort is always the
router, because `wf:handback` is addressed to it rather than to a human.

**Every arrow is also a dispatch** (adr-0025/adr-0038): the label is the
load-bearing write and the cadence is woken directly, so the crons are the
completeness floor rather than the latency. A dropped dispatch costs latency,
never correctness.

## Who owns what

| State | Label | Owner | Bound |
|---|---|---|---|
| Untriaged issue | — | `issue-triage` (nadia) | daily fire; oldest-first |
| Implementable | `wf:lane:implement` | `issue-implement` (ren) | `max_issues_per_run` |
| Decision/document | `wf:lane:design` | `issue-design` (dario) | `max_issues_per_run` (2) |
| Human-only | `wf:lane:operator` + `wf:human:<role>` | operator | — (visible queue, the act named) |
| Handed back by a worker | `wf:handback` | `issue-triage` (nadia) | answered on the next fire — dispatched, so seconds |
| Parked pre-adr-0038 | `issue-*:needs-human` | `issue-triage` re-queue | `requeue_days` (14); read-only legacy, never written |
| PR in review | (routing comment) | `pr-autopilot` (nadia) | `cycle_cap`, W-4 cap 7 |
| PR, agent-fixable | `autopilot:needs-author` | `pr-remediate` (ren) | 3 attempts / 36h sweep |
| PR, human-gated | `autopilot:needs-human` | operator | — |

Operator queues, in one search each:

```
is:open label:autopilot:needs-human          # PRs that are mine
is:open label:autopilot:reviewed             # …of those, the merge-ready ones
is:open label:wf:lane:operator               # issues that are mine
is:open label:wf:human:architect-ratify      # …of those, the ones needing only my signature
is:open label:wf:human:legal                 # …the ones needing a legal lens
is:open label:autopilot:needs-author         # what the agents are fixing right now
is:open label:wf:handback                    # declined by a worker, awaiting the router
```

The `wf:human:*` split is the point of the operator lane, not decoration: an
`architect-ratify` row means a document already exists and only the signature is
missing, which is a two-minute act. If a `wf:lane:operator` issue has **no**
`wf:human:*` label it was routed before adr-0038 (or by hand) — re-run triage on
it rather than working it, because the split rule has not been applied.

## Enabling it (operator, B-authority)

The loop's bindings are **data**, in
[`workforce/scripts/lib/bindings-manifest.mjs`](../../scripts/lib/bindings-manifest.mjs),
driven by one script. That replaced the per-`(skill × project)` `wire-*.mjs`
family, which had let a cadence be bound for one project and not another three
times running (adr-0038 §Context) — the shape R-N11 now refuses.

Adding a binding is A-authority; **enabling a cron is B** (governance.md §5).
`wire-bindings.mjs` declares each binding enabled in one write
(`scheduler=external` + `invoked_by=api` + cron, atomically — never the
`manual`+cron dead-cron state), so **running it is the enable.**

### Step 0 — seed the skill bodies FIRST (`wf:ren` R2 on #518)

A binding whose `skill` has no `SKILL#` row fails **every** fire, loudly and
forever: `agent-runner.md` step 2 resolves the body with `GET /skills/{skill}`
and refuses to fall back to the git copy on a non-2xx. Merging a PR puts the
skill folders in git; it does **not** create the DDB rows. So the data-plane
seed runs before any wiring:

```sh
# after the PR merges + the data-plane deploy that carries the seed
aws-vault exec <profile> -- node workforce/scripts/seed-skills.mjs

# verify every skill the manifest binds resolves — read-only, no creds needed
node workforce/scripts/wire-bindings.mjs --check-skills   # each MUST be 200
```

If any is not 200, stop — wiring on top of it creates a cadence that throws on
every fire until someone notices. The same gate applies to a version-gated
`SKILL.md` body bump (ADR-0018): `npm run workforce:skill-version-sync` reports
a git-ahead-of-live skew, which is normal immediately after a merge and must
clear once the seed runs.

### Step 1 — wire

```sh
# always dry-run first: it prints the PATCH without sending it
node workforce/scripts/wire-bindings.mjs --dry-run
node workforce/scripts/wire-bindings.mjs --project asp-cloud --dry-run

aws-vault exec <profile> -- node workforce/scripts/wire-bindings.mjs --project asp-cloud
aws-vault exec <profile> -- node workforce/scripts/wire-bindings.mjs            # everything
```

Idempotent, keyed on `(skill, project_id, lane)`: absent → appended, equal →
no-op, drifted → replaced in place with `binding_idx` and `bound_at` preserved.

> **The key includes the lane, and that matters.** adr-0030 gave `pr-remediate`
> a second binding on the same project (`config.lane: "groom"`). A coarser
> `(skill, project_id)` key would match the groom slot and overwrite it with the
> author lane's config. Any new driver or matcher must use `bindingMatcher()`
> from the manifest, never re-derive the key.

### Step 2 — verify against live state

```sh
node workforce/scripts/wire-bindings.mjs --live
```

This is the check that would have caught all three incidents: it reports every
declared binding that is not live (**a script that was written but never run
looks exactly like one that was** — OP-016 sat that way for five weeks) and runs
R-N11 against the live bindings rather than the manifest.

**Order matters, and there is a deliberate gap in the middle.**

1. **Wire `issue-triage` first, and let it run for at least one full cycle.**
   Until issues carry `wf:lane:*` labels, nothing downstream can filter on them.
2. **Then `issue-design`** — its Step 1 is lane-filtered, so before step 1 has
   run it simply finds nothing (a cheap no-op, not an error).
3. **`issue-implement` keeps taking un-laned issues until you say otherwise.**
   Its binding deliberately carries no
   `issue_selection.allow_labels: ["wf:lane:implement"]`: narrowing the engineer
   cadence to the lane is a separate operator edit, made once triage has
   demonstrably laned that project's backlog. Doing it earlier stops the cadence
   dead for a cycle.
4. **`pr-remediate` can be wired any time** — it is independent of the lanes, and
   the PRs it works are labelled by `pr-autopilot`/`pr-merge` already.

**Skill-body activation (ADR-0018).** Merging a PR changes git only. A running
cadence keeps its current body until the matching version-gated
`PATCH /skills/{name}` lands — so, for example, the router will not pass
`--human-role` or dispatch its lane's worker until then. Everything degrades
safely in that window: the scripts accept the new flags, an old body simply
never sends them, and every dispatch is best-effort over a cron that still fires.


## When it stalls

| Symptom | Likely cause | Action |
|---|---|---|
| PRs piling up in `needs-author` | `pr-remediate` unbound / paused / failing | First check it is **bound for that project**: `GET /agents/ren` and look for `pr-remediate` with the matching `project_id` (this is what #692/#693 hit — the cadence existed, for a different project). The router's own log names it too: adr-0025's hand-off dispatch logs `404 binding_not_found` when nothing is wired. Then check the sweep (it should be escalating them as `author-stale` at 36h) and the binding's fire history. |
| Hand-offs land but the worker still starts on its cron | the adr-0025 dispatch is not reaching the endpoint | Look for `request-dispatch: no-op` in the router's fire log. `no WF_DISPATCH_TOKEN` = the skill's `meta.json:requires[]` bump has not seeded to the live `SKILL#` row (ADR-0018 version gate) or the deploy carrying the mint has not landed; `409 debounced` is normal (a live run owns the queue); anything else is the endpoint. Latency-only in every case — the cron and the 36h sweep are unaffected. |
| `author-stale` escalations every day | the cadence fires but cannot finish | Read its run log; the usual cause is a target-repo gate it cannot run. |
| Same PR escalating `remediation-cap-exceeded` repeatedly | a structural conflict no attempt will resolve | Resolve it by hand, or close the PR and re-cut the branch from `main`. |
| Issues sitting untriaged | `issue-triage` unbound for that project, or its `max_issues_per_run` too small for the backlog | **First check it is bound for that project**: `node workforce/scripts/wire-bindings.mjs --live`. This is the #1 cause and the hardest to see — asp-cloud ran with no router at all from 2026-05 to 2026-09 while `issue-implement` was bound, so the tracker looked worked. If it is bound, raise the cap for a few fires; it is oldest-first, so it drains the tail. |
| A queue fills and nothing drains it | A producer cadence bound for a project whose consumer is not (R-N11) | `npm run workforce:binding-queues` for the manifest, `wire-bindings.mjs --live` for reality. Then declare the consumer in `lib/bindings-manifest.mjs` and wire it — or unbind the producer, which the rule accepts equally. Do **not** "fix" it by shortening the producer's cron: that hides the orphan, which is how this shipped three times (adr-0038 §Context). |
| `wf:handback` issues piling up | The router is unbound, paused, or failing; or its dispatch is not reaching the endpoint | A hand-back is answered on the router's next fire, and the hand-off dispatches it, so a pile means the router itself is not running. Check the binding first (`--live`), then the fire log: `request-dispatch: no-op` with `no WF_DISPATCH_TOKEN` means the skill's `meta.json:requires[]` bump has not seeded to the live `SKILL#` row (ADR-0018 version gate); `409 debounced` is normal; `404` means nothing is bound. Latency-only in every case — the cron still fires. |
| An issue escalated `hop-cap-exceeded` that looks perfectly routable | It was routed 3× without resolving (`<!-- wf:hops:N -->` markers in its comments) | Read the three dispatch comments together: they usually disagree about what the issue *is*, which is the finding. Split it, or rewrite its body so one lane plainly owns it, then clear the lane label to re-triage. Raising `HOP_CAP` is not the fix — the cap found something. |
| A `wf:lane:operator` issue with no `wf:human:*` label | Routed before adr-0038, or labelled by hand | Re-run triage on it. Without a role the split rule was never applied, and the majority of pre-adr-0038 operator-lane issues turned out to have a draftable body and only a small human residue. |
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
