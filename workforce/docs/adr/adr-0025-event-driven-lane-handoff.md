# ADR-0025 — A hand-off is an event: the author lane dispatches its worker

- **Status**: Proposed
- **Date**: 2026-08-11
- **Deciders**: operator (ratifies — touches the trigger model and adds an API surface)
- **Related**: [adr-0022](adr-0022-issue-to-merge-flow.md) (the author lane this accelerates), [adr-0013](adr-0013-event-driven-pr-autopilot.md) (the same event-vs-cron argument, one cadence earlier), [adr-0005](adr-0005-single-execution-model-ccr.md) (the one execution model this stays inside), [adr-0009](adr-0009-scoped-capability-tokens.md) / [adr-0021](adr-0021-dynamic-memory-write-token.md) (the token idiom reused), R-N4 ([governance.md §4](../governance.md))

## Context

`pr-autopilot` parks an agent-fixable PR in the author lane
(`autopilot:needs-author`) and `pr-remediate` works that queue (adr-0022). The
hand-off between them is a **label**, and nothing reads that label until the
remediation cadence's cron fires. Two failures follow, and both are on the
record:

**1. The queue's latency floor is its worker's cron.** Ren's `pr-remediate`
binding fires twice a day (`cron(29 6,18 …)`). A PR parked at 06:35 waits ~12h
for its first attempt. The sweep escalates an untouched lane PR at 36h
(`--author-stale-hours`), so a lane PR gets ~2–3 attempts *if everything works*
— the backstop and the normal path are within a small factor of each other,
which is what made the next failure invisible.

**2. A queue with no worker looks exactly like a slow one.** On
`PSVL/asp-cloud` there is **no `pr-remediate` binding at all** — the cadence was
wired for `agent-workforce` only
(`workforce/scripts/wire-pr-remediate-ren-agent-workforce.mjs`; no asp-cloud
counterpart exists). So PRs [#692](https://github.com/PSVL/asp-cloud/pull/692)
and [#693](https://github.com/PSVL/asp-cloud/pull/693) — both handed to the
author lane on 2026-08-07 with concrete, mechanical remediation briefs (#693's
was one item: regenerate the frontend OSS-disclosure artefact) — sat untouched
and were escalated to the operator 36h later with
`autopilot:reason:author-stale`. The sweep comment's own words: *"the
pr-remediate cadence did not pick it up (adr-0022)"*. It never could: nothing
was bound to that queue for that project.

The second failure is the more important one. **The lane's health was
observable only through the escalations it produced** — exactly the measurement
debt adr-0022 recorded (FU-029) — and a missing binding and a slow cadence emit
the same signal. Shortening the cron would have hidden this bug rather than
found it.

## Decision

**Make the hand-off an event.** When a cadence creates work for another
cadence, it asks for that cadence to be fired now, through a new
`POST /dispatch` surface on the agents-api; the cron stays as the completeness
floor and the 36h sweep stays as the backstop. Concretely:

1. **`POST /dispatch`** (`{skill, project_id, reason?}`, optional
   `agent_slug`) validates a short-lived capability token, resolves the
   **already-declared** binding for that (skill, project), claims a debounce
   slot, and async-invokes `wf-orchestrator` with one explicit
   `{dispatch: {agent_slug, binding_idx}}`. The orchestrator prepares that task
   exactly as a cron-matched one (same credential resolution, same
   `agent-runner` CCR routine, same fire) and POSTs it.

2. **The two chain points**, both best-effort and both last in their sequence:
   - `pr-autopilot-post.mjs --needs-author` and `pr-merge.mjs`'s author-lane
     refusal → dispatch `pr-remediate` for the same project;
   - `pr-remediate-post.mjs --resolved` → dispatch `pr-autopilot`, so the
     re-review starts on the pushed fix instead of at the next 6-hourly tick.

3. **The capability is a per-fire minted token** (`workforce.dispatch_token`,
   `AUTH#DISPATCH` rows), declared in each skill's `meta.json:requires[]` and
   injected by the orchestrator — the ADR-0009/0021 idiom, with **no static
   secret fallback**, because this capability starts a *fire*.

### Why this is not a second scheduler (R-N4)

Three properties, each mechanical:

- **Dispatch cannot invent an execution.** It fires a binding that already
  exists on an agent's `META` row for that (skill, project) or refuses. "Nobody
  is bound" is a **404** — the honest answer, and the one that would have
  reported the #692/#693 bug on the first hand-off instead of 36h later.
  Bindings[] remains the sole declaration of what may run and the sole audit
  surface. This is the `external` / *"fired via API by another binding"*
  scheduler R-N4 already permits, finally having a consumer.
- **It is rate-limited, not free.** `claimDispatchSlot` is one conditional
  write: at most one dispatch per (agent, skill, project) per 10 minutes. One
  autopilot fire parking five PRs produces **one** remediation run (whose own
  scan drains the whole queue), and a review→remediate→review chain cannot
  become a hot loop even if its semantic bounds were removed.
- **The semantic bounds are untouched.** `REMEDIATION_CAP` (3, claimed before
  the work), the ≤7 `cycle_cap`, the one-commit-per-cycle hand-back, the
  `review-findings-open` / `review-findings-blocking` protocol, the remediation
  brief, `MIN_REVIEWERS`, and the R-N10 merge predicate are all unchanged. This
  ADR moves **when a worker starts**, never what it is allowed to do.

### Why best-effort is the right posture (and not a C-4 hole)

Every dispatch failure — no token, 4xx, 5xx, timeout, unknown project — logs
one line and returns. The caller does not consult the result. That is safe
because the dispatch is **strictly additive to a system that already
terminates**: the binding's cron is the completeness floor, and
`pr-autopilot-sweep.mjs` escalates any lane PR untouched past 36h. A dropped
dispatch costs latency, never correctness, and the two-outcome contract
(merged | escalated) is enforced by the same mechanism as before. Conversely,
letting a dispatch failure fail the hand-off itself *would* be a C-4 problem —
it would strand a PR with no comment and no labels.

### The missing binding is fixed too, separately

`wire-pr-remediate-ren-asp-cloud.mjs` wires the author lane's worker for
`asp-cloud` (twice daily, staggered against the 6-hourly `pr-autopilot` ticks).
Enabling it is the operator's B-authority step (governance.md §5). **The event
path does not substitute for it** — a dispatch fires a declared binding, so
without the binding the endpoint correctly returns 404 and the queue still has
no worker. Both halves ship together on purpose: the wiring makes the lane work
at all, the event makes it work in seconds.

## Consequences

- **Latency on the author lane drops from ≤12h (cron) to seconds**, in both
  directions, with no change to the review protocol or the merge predicate.
- **The 36h sweep becomes a real backstop again.** Its firing rate is the
  effect metric: `autopilot:reason:author-stale` escalations should approach
  zero once the binding exists and dispatch works, and each one that *does*
  fire now means "the worker ran and could not finish", not "nobody looked".
  This is the counter FU-029 owes; the sweep rate is available immediately and
  is the honest interim proxy.
- **A new authenticated write surface** (`POST /dispatch`) and a new credential
  type (`workforce.dispatch_token`, registered across the injector's four
  mirror points). The agents-api gains one IAM grant — `lambda:InvokeFunction`
  on the orchestrator — and **no** Secrets Manager or CCR access; the fire
  still happens only in the privileged principal (adr-0005 intact, R-N1
  unchanged, no new AWS service).
- **What gets worse, honestly.** (a) A second way for a fire to start means the
  orchestrator's log is no longer "one tick, one batch" — dispatched fires
  appear as their own single-task runs (`ccr-dispatch-fired`), which is more
  log surface to read. (b) The debounce is a fixed 10 minutes, not adaptive; a
  hand-off arriving 30 seconds after an unrelated one on the same queue waits
  for the running fire rather than starting its own — correct for a
  queue-draining worker, but it means "dispatched" and "started for THIS PR"
  are not the same claim. (c) Two cadences can now wake each other; the cost
  ceiling (W-3) is unchanged but the *shape* of spend is burstier than a cron's.
- **Reversal.** Remove `workforce.dispatch_token` from the two skills'
  `requires[]` — every dispatch then no-ops on the missing token and both
  cadences fall back to their crons, with no other change. Deleting the route
  and the IAM grant is the fuller rollback; nothing in the lane's semantics has
  to be restored, because nothing in them was changed.

## Alternatives considered

- **Shorten `pr-remediate`'s cron (e.g. every 15 minutes).** Cheapest, and it
  would have made #693 wait minutes instead of 36h — *if the binding had
  existed*. It does not address the class (a queue whose worker is polling is a
  queue that can silently have no worker), it spends a fire on an empty queue
  ~96×/day, and it would have hidden the real bug. Rejected as the primary fix;
  the cron survives unchanged as the completeness floor.
- **A CCR-native `github_event` trigger on `pull_request.labeled`** (adr-0013's
  Method 1, extended to the author lane). Conceptually the cleanest — GitHub
  already emits the event — but adr-0013 has been Proposed since 2026-06-22 and
  no live binding carries `github_event` today (every binding on the roster
  shows `trigger.github_event: null`), because the CCR-side wiring (FU-002) is
  operator work in claude.ai that has not landed. Building the author lane's
  fix on top of an unlanded dependency would repeat the failure being fixed.
  This decision is also **complementary**, not competing: if the CCR event path
  lands, it fires the same bindings.
- **A GHA workflow in the target repo → `repository_dispatch`.** Puts a
  workforce trigger (and, worse, a workforce credential) inside the customer's
  repo, and adds a Zone-A workflow file to a repo the workforce does not own.
  Rejected.
- **Let `pr-autopilot` fix the PR it just reviewed.** Rejected again for
  adr-0022's reason: the author≠reviewer separation is what makes the delegated
  merge trustworthy. The dispatch fires a *different* persona's binding
  precisely to keep that separation.
- **A queue table (SQS or a DDB work queue) between the lanes.** A new state
  store / AWS service (R-N2 / the §5 B-authority row) to hold what a GitHub
  label already holds authoritatively. The lane's queue **is**
  `is:open label:autopilot:needs-author`, and it survives every component here
  being down. Rejected as over-built at single-operator scale (C-3).
