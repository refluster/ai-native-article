# ADR-0038 — The intake lane gets what the PR lane already had: an event, a bound, a named human act, and a wiring invariant

- **Status**: Proposed
- **Date**: 2026-09-19
- **Deciders**: operator (proposed from a PSVL/asp-cloud routing review requested of `wf:nadia` + `wf:dario`)
- **Related**: [adr-0022](adr-0022-issue-to-merge-flow.md) (the lanes this completes), [adr-0025](adr-0025-event-driven-lane-handoff.md) (the dispatch mechanism this reuses, one lane over), [adr-0007](adr-0007-agent-config-single-source.md) (bindings are DDB config), [adr-0005](adr-0005-single-execution-model-ccr.md), R-N4 / R-N9 / **R-N11** ([governance.md §4](../governance.md))
- **Epics**: [019](../epics/epic-019-autonomous-finalization-rate.md) (the funnel this moves)

## Context

adr-0022 split the issue→merge loop into two halves and built them to different
standards. The **PR half** got a lane, a worker, an attempt cap, a staleness
sweep and — via adr-0025 — an event-driven hand-off. The **intake half** got the
lane and the worker, and none of the rest. This ADR is the arrears.

The bill came due on `PSVL/asp-cloud`, where the intake half was not merely
incomplete but **absent**. Live bindings, read 2026-09-19:

| cadence | `agent-workforce` | `asp-cloud` |
|---|---|---|
| `issue-triage` (the router) | ✅ `cron(23 2 …)` | ❌ **unbound** |
| `issue-design` (design lane) | ✅ `cron(47 4 …)` | ❌ **unbound** |
| `issue-implement` (implement lane) | ✅ | ✅ `cron(17 3 …)` |
| `pr-remediate` (author lane) | ✅ | ❌ **unbound** (OP-016, declared 2026-08-11, never run) |
| `pr-autopilot` (reviewer) | ✅ | ✅ |

So asp-cloud has been running the **pre-adr-0022 world**: the tracker's only
consumer is an engineer cadence, which self-selects implementable work. Every
architecture, legal, product or governance issue reaches Ren, is correctly
declined, and lands in `issue-implement:needs-human` — a state with **no bound
worker on that project to release it**, because the re-queue rule lives in
`issue-triage`. 18 open issues sit there; the oldest, #540, has not been touched
since 2026-08-01, and six of them (#838, #835, #755, #620, #601, #598) are
Architect ratifications of drafts that already exist.

Four distinct defects are tangled in that table, and they are worth separating
because they have four different fixes.

**1. A queue was bindable without its worker — three times.** This is the same
defect as #692/#693 (adr-0025 §Context: `pr-remediate` wired for one project,
PRs parked in `autopilot:needs-author` on the other, escalated `author-stale`
36h later). adr-0025 fixed that instance and wrote the rule into the runbook as
prose — *"Whenever `pr-autopilot` is wired for a new project, wire
`pr-remediate` for it in the same session"* — scoped to one cadence pair. The
rule was right and its generalisation never happened, so the intake side
repeated it. A per-`(skill × project)` `wire-*.mjs` script, of which there are
19, **structurally cannot check a relationship it is only one half of.**

**2. `*:needs-human` asserted more than its writer knew.** A lane worker that
declines an issue knows exactly one thing: *the work is not mine*. The label it
stamped said *a human is required* — a different, stronger claim, and one the
worker has no standing to make. PSVL/asp-cloud#866 is the worked example: Ren's
decline was correct and well-reasoned, and it still left behind a label asserting
a decision nobody had made. The issue moved only when a human, on 2026-09-18,
manually separated "what the operator must decide" from "what can be written
down first" — and found that the second half was most of it.

**3. The operator queue was unsorted, and mostly not operator work.** `operator`
answered "who owns this?" with "a human", which is the same non-answer the lanes
replaced one level up. Worse, it was usually wrong: of the 18 parked asp-cloud
issues, the large majority have an **agent-draftable body and a human-only
residue** — an ADR amendment awaiting a signature, a RAL row, an ASVS
self-assessment, a checklist execution record. The residue was holding the body
hostage.

**4. The intake chain's latency floor was its slowest cron.** With daily
bindings, a route → implement → review chain is same-day only where the stagger
happens to allow it, and a route → design → implement → review chain crosses
days. adr-0025 had already solved this class one lane over, and its two chain
points are both on the PR side; **no intake hand-off dispatches anything.**

A fifth, smaller finding, recorded because it fed the pile: Ren's asp-cloud
binding denies `blocked, needs-design, discussion, duplicate, wontfix, question`
while the agent-workforce one also denies `layer:L0`, `layer:L1`, `type:tracker`
and `wf:blocked`. On asp-cloud the engineer cadence was therefore *offered*
exactly the governance and epic issues it structurally cannot take, and declined
them one at a time, forever.

## Decision

Bring the intake half up to the PR half's standard, reusing that half's
mechanisms rather than inventing parallel ones. Nothing about who may *merge*
changes; no agent gains authority.

### 1. R-N11 — a producer may not be bound without its consumer

A cadence that **fills** a queue may not be bound for a project unless the
cadence that **drains** it is bound for the same project. The queue relation is
declared as data in `workforce/scripts/lib/bindings-manifest.mjs:QUEUES` and
checked by `check-binding-queues.mjs` in CI (R-N11).

The rule is stated over *pairs*, not cadences: removing the producer is as valid
a fix as adding the consumer. What it forbids is the silent orphan — and that
matters because **an unworked queue and a slow worker emit the same signal**
(adr-0025's own diagnosis). Shortening a cron would have hidden all three
incidents; a pair check names them.

The PR gate reads the **manifest** (offline, deterministic — a PR must not turn
red for live state it did not change). `wire-bindings.mjs --live` runs the same
pure predicate against live bindings, which is the form all three incidents
actually took, and is what ops and `backlog-reconcile` run.

### 2. The wire-script family becomes a manifest

The 19 `wire-<skill>-<agent>-<project>.mjs` scripts are ~140 lines of identical
sigv4/reconcile boilerplate around one `BINDING` literal. The four loop cadences
move into `bindings-manifest.mjs` as data, driven by a single
`wire-bindings.mjs`. `pr-autopilot` stays in its own script — its per-project
`nomination_rules` are genuinely bespoke — but appears in the manifest as an
`managed: false` entry so R-N11 can see the pair.

Six scripts are deleted and replaced by manifest rows —
`wire-issue-{triage,design,implement}-*`, `wire-pr-remediate-ren-{agent-workforce,asp-cloud}`.
References to them in adr-0022 / adr-0025 and in Epic-019's narrative are left
as written: they are accurate about the past, and this section is the forwarding
address. `wire-pr-remediate-groom-ren-agent-workforce.mjs` **stays** — it binds a
second lane of the same skill on the same project (adr-0030), which is precisely
why the manifest's reconciliation key is `(skill, project_id, lane)` and not the
coarser tuple every other wire script used. A driver keyed on the coarse tuple
would have matched the groom slot and overwritten it.

This is not tidying for its own sake: **the manifest is the artefact R-N11 is
checkable against.** Declaring the three missing asp-cloud bindings as two new
copied scripts would have re-created the exact shape that hid the bug. The
cadences outside the loop keep their own scripts and are out of scope
(follow-up: migrate them once this pattern has a cycle of use).

### 3. `wf:handback` — one parked state, and the router is its only reader

The per-worker `issue-implement:needs-human` / `issue-design:needs-human` are
replaced by a single `wf:handback`, written through
`issue-triage/issue-handback.mjs` — one script, owned by the router, because the
state it writes is the router's vocabulary.

`wf:handback` claims only *"not mine; router, decide"*. It is answered by the
**router**, not by a human, and `triageAction` surfaces it **immediately** rather
than after the 14-day requeue window: the worker has just done the reading, so
waiting adds latency and no information.

The legacy labels are still **read** — asp-cloud's 18 issues wear them and must
re-enter the loop — and never written again. They age into the requeue window as
before.

One state disappears entirely with them. The `--requeue` flag on
`issue-triage-post.mjs` existed only to decide whether to clear a parked label;
since posting a lane *is* the router's answer to the park, clearing is now
unconditional and the flag is gone. There is no "parked **and** laned" state left
to reason about. (Old skill bodies passing `--requeue` are unaffected: the flag
is ignored and the behaviour is what they intended.)

### 4. The operator lane names the human act, and the split rule precedes it

`wf:human:<role>` is **required** on the operator lane, from a closed set:
`architect-ratify`, `legal`, `product`, `console`, `field`. An unknown role
throws, exactly as an unknown lane does.

The roles exist to make one rule checkable, which is the substantive change:

> **Before routing anything to `operator`, ask: what document would make the
> human's act a signature rather than an investigation?** If one exists or could
> be drafted, route the **drafting half** to `design` now and file the human-only
> **residue** on the operator lane with its role.

This is adr-0022's own move applied one level deeper. That ADR observed that an
L0/L1 issue cannot be *implemented* autonomously but can always be *proposed*;
the same is true of most issues that look human-only. An `architect-ratify` needs
a diff to ratify; a `legal` review needs the text it will review; a `product`
call needs the options written down. #866 is the proof by hand — the split is
what unstuck it — and the rule is that split, done at routing time, every time.

### 5. The intake hand-offs become events (adr-0025's mechanism, this lane)

Three new chain points, all best-effort, all last in their sequence:

- `issue-triage-post.mjs` → dispatch the **lane's worker** (`LANE_WORKER_SKILL`);
- `issue-handback.mjs` → dispatch **`issue-triage`**, closing the return leg;
- `issue-implement` / `issue-design`, on opening a draft PR → dispatch
  **`pr-autopilot`**, via the new thin `dispatch-cadence.mjs` CLI (these cadences
  are plain CCR sessions with no write-script to hang the call off).

Nothing about the dispatch contract changes: it fires an **already-declared**
binding or 404s (R-N4), it is debounced server-side at 10 minutes per
`(agent, skill, project)`, and every failure logs one line and returns. One
triage fire laning 15 issues produces **one** implement run, whose own scan
drains the queue — the designed behaviour.

**What this does and does not buy.** The *waiting* collapses; the *working* does
not. Lead time becomes `Σ(run durations)`, not `Σ(cron intervals)`: a
route → implement → review chain lands in one sitting instead of spanning days.
A design → implement chain still crosses an issue boundary and still needs two
pieces of work done — the honest floor there is two run durations plus any human
ratification, and §4's split rule (file the implementation issue as a linked
sub-issue at routing time) is what shortens it, not the dispatch.

### 6. `HOP_CAP` — routing terminates

`issue-triage-post.mjs` counts how many times an issue has been routed
(`<!-- wf:hops:N -->` markers, deliberately the same idiom as the PR side's
`<!-- autopilot:remediation:<n> -->`) and at **3** forces the `operator` lane
regardless of what the router asked for.

The bound ships **with** the accelerator, and that pairing is the point. Before
§5, route → hand back → route had a 14-day period, which reads as a stalled
issue rather than a loop. Making the hand-off immediate makes the same cycle
fast enough to matter. An issue that burns three hops has a scope or vocabulary
problem, and naming that is a human's call — so the escalation *is* the finding,
exactly as `remediation-cap-exceeded` is on the PR side.

Hops do not reset. A marker count is a `max`, not a tally, so a comment that
failed to post cannot silently reset the bound.

### 7. The asp-cloud deny-list is brought level

`issue-implement@asp-cloud` gains `layer:L0`, `layer:L1`, `type:tracker`,
`wf:blocked` — the four its agent-workforce twin already had. Deliberately
**not** included: `allow_labels: ["wf:lane:implement"]`. Narrowing the engineer
cadence to the lane is the operator's separate step, taken once triage has
demonstrably laned this backlog; doing it here would stop the cadence dead for a
cycle (issue-to-merge-flow.md, *"Order matters"* §3).

## Consequences

**What gets better.** asp-cloud's 18-issue absorbing state becomes a routed
queue on the first fires (all of them are past the requeue window or will be
handed back). The operator's queue becomes one search, sorted by the act owed,
and — via the split rule — materially shorter than it was, because most of what
was in it was never operator work. The intake chain stops being cron-bound. And
the defect class behind three incidents becomes a CI failure rather than a
diagnosis someone has to make twice.

**What gets worse, honestly.**

- **The label vocabulary changed shape, and migration is real.** Net label count
  is flat (−2 `*:needs-human`, +1 `wf:handback`, +1 `wf:human:*`; the hop counter
  is a comment marker, not a label) but the 18 legacy-parked issues are read by a
  compatibility path that has to be maintained until they drain. Deleting
  `LEGACY_PARKED_LABELS` before then would re-absorb them.
- **`HOP_CAP` will mis-fire sometimes.** An issue legitimately re-scoped three
  times lands on the operator lane wearing `hop-cap-exceeded` when nothing is
  wrong with it. That is the deliberate trade — a false escalation is visible
  and cheap; an invisible loop is neither — but the operator will see some.
- **The split rule creates issues.** It is the one place triage may file
  something, and it will increase issue count while decreasing parked count.
  That is the intended direction, and it should be watched: if the residue issues
  themselves start ageing on the operator lane, the rule has moved the problem
  rather than solved it. The `wf:human:*` breakdown in Step 4's report is the
  instrument.
- **Three more dispatch call sites** means the orchestrator's log is further from
  "one tick, one batch" (adr-0025 already accepted this), and spend is burstier
  in shape though unchanged in ceiling (W-3).
- **The manifest is a partial migration.** 13 wire scripts still exist in the old
  shape, so the repo now has two idioms for the same job until they are migrated.

**Measurement.** adr-0022 owes a lane counter (FU-029) and adr-0025 named the
sweep's firing rate as the honest interim proxy. This ADR's intake analogue is
the **hand-back funnel** in `issue-triage`'s Step 4 report — answered,
re-laned-elsewhere, returned-to-the-same-lane, hop-capped. The third number
should be ~0; if it is not, either a worker or a lane definition is wrong, and
which one is a finding. This is a report, not a counter, and it is explicitly
weaker than FU-029 asks for.

**Reversal.** Remove `workforce.dispatch_token` from the three skills'
`requires[]` and every dispatch no-ops onto its cron (adr-0025's own rollback).
Drop the R-N11 npm script to stop the gate. The label changes reverse by
re-adding `PARKED_LABELS` writes to the two worker bodies. `HOP_CAP` reverses by
raising it. Nothing in the merge predicate was touched, so nothing in it has to
be restored.

## Alternatives rejected

- **Just wire the three missing bindings and stop.** This is 80% of the value for
  5% of the diff, and it was seriously considered. Rejected as the *whole* fix
  because it repairs the instance and not the class: the same omission has now
  happened three times, and the fourth would be equally invisible. §1 and §2 are
  the part that makes a fourth occurrence loud.
- **Add lanes for the categories (`qa`, `legal`, `architecture`).** The obvious
  reading of "classify issues better", and adr-0022 forbids it for a good reason:
  a lane exists only where a worker exists, and a lane with no consumer *is* the
  failure being fixed. `wf:human:*` sorts the operator queue without inventing
  workers, and the split rule extracts the part a real worker can take.
- **Let the worker route directly to `operator`.** One hop shorter, and it would
  have been safe (a worker may only ever move an issue to the terminal lane).
  Rejected because it puts the §4 split decision in the hands of the cadence
  least equipped to make it — the one that has just established the work is not
  its own. With §5's dispatch the extra hop costs seconds.
- **`wf:hops:N` as a label.** Symmetrical with the other lane labels, and it
  grows an unbounded label family for a counter nobody queries. The PR half
  already solved this with a comment marker; reusing that idiom keeps one pattern
  instead of two.
- **Shorten the intake crons.** Cheapest latency fix, and it spends fires on
  empty queues, does not address the hand-back return leg at all, and — exactly
  as adr-0025 said of the same proposal — would have *hidden* the missing
  bindings rather than found them.
