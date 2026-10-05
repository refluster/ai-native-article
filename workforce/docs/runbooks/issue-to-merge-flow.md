# Runbook — the issue→merge flow (adr-0046, adr-0022 §1)

How a ticket becomes a merge without stopping, who owns each state, and what
the operator has to do to switch it on for a project.

Decision records: [adr-0046](../adr/adr-0046-issue-lifecycle-stages-and-owners.md)
(the intake half: four stages, owners) and [adr-0022](../adr/adr-0022-issue-to-merge-flow.md)
§1 (the PR half: the author lane). Metric: [Epic-019](../epics/epic-019-autonomous-finalization-rate.md).
The same model, written for the project side, is PSVL/asp-cloud
`docs/runbooks/issue_lifecycle.md`.

## The loop

```
                 backlog-reconcile (nadia)        issue-triage (nadia)              the owner
   Proposed ───────────────────────────▶ Verified ─────────────────────▶ Assigned ──────────▶ draft PR
      │        done / duplicate / stale      ▲      stage:assigned + owner:<slug>    │               │
      └──────────────────────────▶ Closed    └────────── hand-back ──────────────────┘               │
                                                 (back to Verified, one comment)                     │
                                                                                                     ▼
                                 ┌──────────────────────────── pr-autopilot (nadia) ─────────────────┐
                                 │  route → ≥3 isolated lens reviews → verdict                       │
                                 └──┬────────────────────┬──────────────────────────────┬────────────┘
                               🟢 predicate          agent-fixable                  only-a-human
                                    │            (conflict / behind / findings)          │
                                 MERGED            autopilot:needs-author        autopilot:needs-human
                               (R-N10)                     │                          (operator)
                           closes the issue        pr-remediate (ren)
                                                   push to HEAD → clear label → re-review at N+1
                                                   bounded: 3 attempts, or 36h untouched → needs-human
```

**Every arrow is also a dispatch** (adr-0025): the label is the load-bearing
write and the next cadence is woken directly, so the crons are the
completeness floor rather than the latency. A dropped dispatch costs latency,
never correctness.

## The model

| Stage | Label | Meaning | Moved on by |
|---|---|---|---|
| **Proposed** | `stage:proposed` — or no `stage:*` label at all | Filed. Nobody has checked it. | `backlog-reconcile` |
| **Verified** | `stage:verified` | Still true on the default branch, not a duplicate, labelled, has checkable acceptance criteria. Waiting for an owner. | `issue-triage` |
| **Assigned** | `stage:assigned` + exactly one `owner:<slug>` | One named owner is responsible for closing it. | the owner |
| **Closed** | GitHub closed: `completed` / `duplicate` / `not_planned` | Labels are left as history. | — |

Six rules, the same on every project:

1. Every open issue carries **exactly one** `stage:*` (none counts as Proposed).
2. `stage:assigned` ⇔ **exactly one** `owner:*`. No other stage carries an owner.
3. **Only the owner acts on an assigned issue.** No other member comments on,
   labels, or opens a PR for it. Nobody acts on a Proposed or Verified issue
   except the reconcile and the router. There are no patrols.
4. **Hand-back** is one comment and a move back to Verified with the owner
   label removed (`issue-stage-set.mjs --to verified`). The router re-assigns.
5. Only the router — or the operator — changes an owner.
6. The **operator** may perform any transition. A Claude Code session the
   operator directs acts as `owner:operator`.

`owner:operator` is valid on every project. Any other `owner:<slug>` must be a
member whose **`issue-execute` binding is live on that project** — the router
reads the roster from `GET /agents`, and the write surface refuses anything
else. That one guard is what makes "assigned" mean "somebody will do it".

Incidents (`incident` label) follow incident response and carry no stage.

## Who owns what

| State | Label | Owner | Bound |
|---|---|---|---|
| Proposed | `stage:proposed` / none | `backlog-reconcile` (nadia) | daily, oldest first, `max_issues_per_run` (15); closes ≤ `max_closes_per_run` (10) per run, each with evidence |
| Verified | `stage:verified` | `issue-triage` (nadia) | daily + dispatched on every verify / hand-back; `max_issues_per_run` (15) |
| Assigned to a member | `stage:assigned` + `owner:<slug>` | that member's `issue-execute` | daily + dispatched on assignment; `max_issues_per_run` (3 ren / 2 dario) |
| Assigned to the human | `stage:assigned` + `owner:operator` | the operator | — (a visible queue, one search) |
| Idle ≥ 30 days (Verified / Assigned, no open PR) | (its stage) | `backlog-reconcile` re-check | the same three closing rows; a still-valid issue keeps its stage and owner |
| Claimed | an **open PR** that references the issue (`Closes` / `Refs #N`, or an `issue-N` branch) | the PR's author | every scan skips it; the set script refuses to move it |
| Routed 3× without closing | `owner:operator` (forced) | the operator | `ASSIGN_CAP` (3), counted from the router's own comments |
| PR in review | (routing comment) | `pr-autopilot` (nadia) | `cycle_cap`, W-4 cap 7 |
| PR, agent-fixable | `autopilot:needs-author` | `pr-remediate` (ren) | 3 attempts / 36h sweep |
| PR, human-gated | `autopilot:needs-human` | operator | — |

Operator queues, one search each:

```
is:issue is:open label:stage:assigned label:owner:operator   # issues that are mine
is:issue is:open label:stage:verified                        # waiting for the router
is:issue is:open -label:stage:verified -label:stage:assigned -label:incident   # the reconcile queue
is:issue is:open label:stage:assigned label:owner:ren        # a member's work (ren)
is:open label:autopilot:needs-human                          # PRs that are mine
is:open label:autopilot:needs-author                         # what the agents are fixing right now
```

## The scripts (three files, one vocabulary)

| File | Role |
|---|---|
| `workforce/skills/issue-triage/issue-stages.mjs` | The vocabulary and every pure decision: stages, owners, the roster check, reconcile / route decisions, the label plan, the assignment cap, the close guards. Unit-tested (`issue-stages-tests.ts`). |
| `issue-stage-scan.mjs --queue reconcile\|route` | The only reader. Candidates oldest-first under a cap, plus the index of every open issue, the last 30 days of merged PRs, the open-PR claims and the live roster. |
| `issue-stage-set.mjs --to verified\|assigned\|closed` | The only writer. Posts the one comment, applies the label plan (one stage, one owner, retired labels stripped), runs the guards, closes with GitHub's reason, dispatches the next cadence. Never edits a body, never opens a PR. |

Retired and stripped on sight: `wf:lane:*`, `wf:owner:*`, `wf:human:*`,
`wf:handback`, `issue-implement:*`, `issue-design:*`, `wf:closed:*`, and the
`<!-- wf:hops:N -->` comment marker (the count is now the router's own
`<!-- stage:assigned -->` comments).

## Enabling it (operator, B-authority)

The loop's bindings are **data**, in
[`workforce/scripts/lib/bindings-manifest.mjs`](../../scripts/lib/bindings-manifest.mjs),
driven by one script. `wire-bindings.mjs` declares each binding enabled in one
write (`scheduler=external` + `invoked_by=api` + cron, atomically), **removes**
the bindings the manifest retires (`RETIRED_BINDINGS` — adr-0041's in-place
marker is not implemented, so removal is the retirement), and refuses a set
that would leave a queue unworked (R-N11).

### Step 0 — seed the skill bodies first

A binding whose skill has no `SKILL#` row fails every fire. Merging a PR puts
the skill folder in git; the data-plane deploy bundles it; `wf-seed-skills`
creates or version-bumps the row. New skill (`issue-execute`) or a body bump →
after the deploy:

```sh
node workforce/scripts/seed-skills.mjs prod          # needs AWS creds (lambda:InvokeFunction)
node workforce/scripts/wire-bindings.mjs --check-skills   # read-only; each MUST be 200
```

### Step 1 — wire

```sh
node workforce/scripts/wire-bindings.mjs --dry-run                 # prints the PATCHes, sends nothing
node workforce/scripts/wire-bindings.mjs --project asp-cloud --dry-run
aws-vault exec <profile> -- node workforce/scripts/wire-bindings.mjs            # everything
```

Idempotent, keyed on `(skill, project_id, lane)` **within one agent**: absent
→ appended, equal → no-op, drifted → replaced in place (`binding_idx` and
`bound_at` preserved), retired → removed. The same `(skill, project_id)` on
two agents — ren and dario both carry `issue-execute @ asp-cloud` — is two
bindings, not a collision.

### Step 2 — verify against live state

```sh
node workforce/scripts/wire-bindings.mjs --live
```

Reports every declared binding that is not live, every retired binding that
still is, and runs R-N11 against the live bindings rather than the manifest.

### Adding a member to a project's roster

Add an `issue-execute` row for them in the manifest and wire it. Nothing else:
the router reads the roster live, and the write surface refuses an owner that
is not on it. On PSVL/asp-cloud, also add the `owner:<slug>` row to that
repo's `issue_lifecycle.md` §5 and `labels.yml` in the same change.

## When it stalls

| Symptom | Likely cause | Action |
|---|---|---|
| Proposed issues piling up | `backlog-reconcile` unbound / paused / failing for that project | `wire-bindings.mjs --live` first; then its fire log. Raise `max_issues_per_run` for a few fires if it is bound and just behind. |
| Verified issues piling up | `issue-triage` unbound, or every candidate refused for an unserved owner | `--live`; then the router's report (Step 4): it names what it could not assign and why. |
| An Assigned issue nobody works | its owner's `issue-execute` is not bound here (the #760 shape) | The next router fire re-assigns it (`reassign`). Wire the member if they should be on this project. |
| The same issue bounces owner ↔ Verified | a scope or vocabulary problem | The third hand-back lands it on the operator (`ASSIGN_CAP`). Read the comments together; split or rewrite the issue. |
| A member comments on an issue it does not own | an old `issue-implement` / `issue-design` binding is still live | `--live` shows it as retired-but-live; run the wire script to remove it. |
| A close you disagree with | — | Reopen it. The reconcile sees the `<!-- stage:closed -->` marker and will verify rather than close again. |
| An issue with `owner:*` but not Assigned | filed by `ops-accountability-watch` (its accountability hint), or hand-labelled | The reconcile strips it and records the hint in its comment; the router restores it as a real assignment if the member is bound. |
| PRs piling up in `needs-author` | `pr-remediate` unbound / paused / failing | `--live`; then the sweep (36h `author-stale`) and the binding's fire history. |
| Hand-offs land but the worker starts on its cron | the adr-0025 dispatch is not reaching the endpoint | Look for `request-dispatch: no-op` in the fire log: `no WF_DISPATCH_TOKEN` = the skill's `requires[]` has not seeded (ADR-0018); `404` = no binding for that (skill, project); `409 debounced` is normal. Latency only. |
| `author-stale` escalations every day | the cadence fires but cannot finish | Read its run log; usually a target-repo gate it cannot run. |
| `needs-author` on an L0/L1 PR | a label predating the fail-closed guard | Move it to `needs-human --reason l0l1-path` by hand. |

## What this deliberately does not change

The R-N10 predicate, the L0/L1 path set, the ≥3-reviewer unanimous-green
rule, `MIN_REVIEWERS`, the kill-switches, W-5. No agent gained merge
authority: `issue-execute` and `pr-remediate` both declare `external-pr`,
never `external-pr-merge`.

Related: [bindings.md](bindings.md) (binding shape + the enable discipline),
[dev-process.md](dev-process.md), [pr-escalation-reasons.md](../pr-escalation-reasons.md).
