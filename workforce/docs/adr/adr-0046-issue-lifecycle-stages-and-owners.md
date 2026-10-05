# ADR-0046 — One issue lifecycle: Proposed → Verified → Assigned → Closed, with an owner label instead of lanes

- **Status**: Proposed (operator ratifies by merging)
- **Date**: 2026-10-05
- **Deciders**: operator (directed the refactor); drafted by the operator's Claude Code session with the workforce (nadia routes, ren / dario execute, pr-autopilot reviews)
- **Supersedes**: [adr-0022](adr-0022-issue-to-merge-flow.md) §2 (lanes at intake) and [adr-0038](adr-0038-intake-lane-handoff-and-queue-invariant.md) §3–§7 (`wf:handback`, `wf:human:*`, the split rule as a label, the intake hand-off events, `HOP_CAP` markers, and §7's `issue-implement` deny-list, which goes with the skill it configured). adr-0022 §1 (the PR author lane, `pr-remediate`) and adr-0038 §1–§2 (R-N11, the bindings manifest) stand unchanged. adr-0038 §5's mechanism — every hand-off dispatches the next cadence (adr-0025) — is kept; only its call sites move, into the one write surface (§2 below).
- **Related**: [adr-0025](adr-0025-event-driven-lane-handoff.md) (dispatch; reused as is), [adr-0017](adr-0017-skill-lifecycle-api.md) (archiving the two retired skills), PSVL/asp-cloud `docs/runbooks/issue_lifecycle.md` (the same model, written first on the project side; PSVL/asp-cloud#995 / #996)
- **Epics**: [019](../epics/epic-019-autonomous-finalization-rate.md)

## Context

The intake half of the issue→merge loop grew by accretion. adr-0022 added
three lanes and a router; adr-0038 added a hand-back label, five human-role
labels, a split rule, a hop counter in comment markers, per-worker claim
labels (`issue-*:in-progress` / `*:pr-open`), a settle verdict family
(`wf:closed:*`), legacy parked labels that are read but never written, and a
14-day re-examination window. Five scripts in `issue-triage/` implement it
(`issue-lanes.mjs`, `-scan`, `-post`, `-settle`, `issue-handback.mjs`),
`issue-lanes.mjs` alone is ~430 lines of pure decision logic, and the runbook's
"when it stalls" table has fourteen rows.

Each piece answered a real incident, and together they stopped working:

1. **Routing to a lane nobody serves.** The router chose a *lane* and an
   *owner* separately, so an owner could be named who was not bound to the
   lane's worker. #760 was routed `design` / `wf:sana` on 2026-09-25 and
   re-routed three times before the 2026-10-01 fire noticed that
   `issue-design` on this project is bound only to dario — its last routing
   comment says so in as many words. The `worker_owners` check added for it
   is the fourth guard on the same write.
2. **Patrols.** `issue-implement` on PSVL/asp-cloud selected every open issue
   outside a deny-list, then commented on and labelled each one it declined
   (2026-09-28: #677, #870; before that the eighteen `needs-human` parks of
   adr-0038 §Context). The engineer cadence became the tracker's loudest
   participant on issues it was never meant to work.
3. **Two vocabularies for one state.** PSVL/asp-cloud adopted
   `stage:proposed / verified / assigned` + `owner:<slug>` on 2026-10-05
   (its runbook `issue_lifecycle.md`, PR #996). The workforce still spoke
   `wf:lane:*` / `wf:owner:*` / `wf:human:*` there, so the project's own
   rules and the cadences that operate on it disagreed about what a label
   meant.
4. **Old issues.** With nothing that reliably closed or merged what had gone
   stale, 21 of this repo's 46 open issues on 2026-10-05 were older than a
   month; the operator's words were "さすがに古い".

The operator's instruction: refactor, abstract, return to a simple structure.
Four stages in English, every member works what is assigned to it and nothing
else, the routine that comments on other people's issues goes away.

## Decision

### 1. Four stages, two label families, on every project

| Stage | Label | Meaning | Moved on by |
|---|---|---|---|
| Proposed | `stage:proposed` (an open issue with no `stage:*` counts as Proposed) | Filed; nobody has checked it | backlog reconcile |
| Verified | `stage:verified` | Still true, not a duplicate, labelled, has checkable acceptance; waiting for an owner | routing |
| Assigned | `stage:assigned` + exactly one `owner:<slug>` | One named owner is responsible | the owner |
| Closed | GitHub closed (`completed` / `duplicate` / `not_planned`) | — | — |

Rules, the same six as PSVL/asp-cloud's runbook: one stage per open issue;
`owner:*` exists iff the stage is Assigned, and exactly one; only the owner
acts on an assigned issue (no comments, labels or PRs from anyone else);
hand-back is one comment and a move back to Verified with the owner label
removed; only the router or the operator changes an owner; the operator may
perform any transition.

`owner:operator` is the human. It is a valid owner on every project. Every
other `owner:<slug>` must be a member whose executor (§3) is bound to that
project; the router reads the live roster (`GET /agents`) and the write
surface refuses anything else. That one guard replaces the lane/owner
cross-check, `worker_owners`, `LANE_ENTRY_DENY` and `laneRefusal`.

### 2. One write surface, two read scans

`workforce/skills/issue-triage/issue-stages.mjs` is the vocabulary and the
pure decisions. `issue-stage-scan.mjs --queue reconcile|route` is the only
reader; `issue-stage-set.mjs --to verified|assigned|closed` is the only
writer, and every transition — verify, assign, hand back, close — goes
through it. It stamps and strips the labels, posts the one comment, applies
the guards (roster, open PR, evidence, close budget, assignment cap) and
dispatches the next cadence (adr-0025). The five scripts above are deleted.

Retired and never written again: `wf:lane:*`, `wf:owner:*`, `wf:human:*`,
`wf:handback`, `issue-implement:*`, `issue-design:*`, `wf:closed:*`,
`<!-- wf:hops:N -->`. The reconcile strips them when it meets them. A claim
is the open PR that references the issue, nothing else: an assigned issue
with an open PR is skipped by every scan, and an assigned issue whose PR
merged as a partial slice simply stays with its owner.

### 3. Three cadences, one executor skill

| Cadence | Persona | Reads | Writes | Replaces |
|---|---|---|---|---|
| `backlog-reconcile` | nadia | Proposed; Verified/Assigned idle ≥ 30 d | Verified, or Closed with evidence (completed → PR; duplicate → open survivor; not_planned → reason) | its own epic-audit shape, and `issue-triage-settle` |
| `issue-triage` | nadia | Verified; Assigned to an unbound owner | Assigned + one owner, one comment | lanes, hand-back answering, hop cap |
| `issue-execute` | any bound member (ren, dario today) | `stage:assigned` + `owner:<self>`, not held by an open PR | a draft PR (`Closes #N`), or a hand-back | `issue-implement` and `issue-design` |

`issue-execute` is one skill because the contract became one: catch up on
the issue, its epic and the target repo's governance; deliver the thing the
issue asks for — code when it asks for code, an ADR / design note / epic
decomposition / amendment proposal when it asks for a decision — as a draft
PR; hand back when it is not yours. The persona supplies the lens; the
binding supplies the project. adr-0022 rejected widening `issue-implement`
because the two skills had two contracts. They no longer do.

`issue-implement` and `issue-design` are archived (adr-0017 soft delete:
hidden from the list, not bindable, history intact). Their bindings are
removed from `bindings[]`; adr-0041's in-place marker is still Proposed and
unimplemented, so deletion is the only retirement the API offers today —
the manifest's `RETIRED_BINDINGS` records what was removed and why.

Routing terminates by counting the router's own assignment comments — each
carries the signature `<!-- stage:assigned -->` — and the fourth answer is
`owner:operator`. This is the same comment-signature idiom `wf:hops:N` used,
with one marker instead of a numbered family; it is deliberately not a label.
The count is read fresh from the thread on every assignment (`countMarker`),
so an edited or deleted comment lowers the count — the bound is advisory
against drift, not tamper-proof, and that is accepted: the people who can
edit a router comment are the operator and the router itself.

### 4. R-N11 keeps the same shape with new queues

`QUEUES` becomes: `backlog-reconcile → issue-triage` (Verified),
`issue-triage → issue-execute` (Assigned), `issue-execute → issue-triage`
(hand-back = Verified again), and `pr-autopilot → pr-remediate` unchanged.
The manifest declares all five loop cadences on both projects
(`agent-workforce`, `asp-cloud`); `wire-bindings.mjs` writes them and
removes the retired ones.

### 5. The PSVL/asp-cloud runbook is the model's project-side twin

PSVL/asp-cloud `docs/runbooks/issue_lifecycle.md` describes the same four
stages and six rules for that repo. This ADR adopts them for every project
the workforce operates on, including its own. Where the two disagree, this
ADR governs the workforce's cadences and that runbook governs the project's
templates and conventions; the label names are identical by construction.

## Consequences

**Better.** One vocabulary everywhere; one guard ("is the owner bound here?")
instead of four; no cadence touches an issue it does not own, so the patrol
comments stop; a hand-back is a stage change, not a state; the scripts drop
from five to three and the pure module roughly halves. A reader can hold the
whole model in one table.

**Worse, honestly.** (a) Dario's lens on a design issue is now a routing
decision by nadia rather than a lane the issue is in — a mis-route costs one
hand-back. (b) `issue-execute` is one skill body for two kinds of
deliverable; it must say clearly which one an issue wants, and the body
carries the old `issue-design` artefact table for that. (c) The label
migration is real: every open issue on both repos is re-staged in the same
change (the operator asked for it: "既存のまだオープンなイシューを全て整理").
(d) Issues filed by `ops-accountability-watch` carry an `owner:<slug>` as an
*accountability* marker; under rule 2 an owner label means Assigned. The
reconcile treats such a label on a non-assigned issue as a routing hint,
strips it, and the watch's own filing shape is a follow-up issue for ren.

**Cost (W-3).** At the schema's cost-class rates (small 0.05 / medium 0.20 /
large 0.60 USD per fire) the manifest adds, per month: `backlog-reconcile` on
asp-cloud (30 × 0.60 = 18), `issue-triage` on asp-cloud (30 × 0.20 = 6),
dario's `issue-execute` on asp-cloud (30 × 0.60 = 18) and `pr-remediate` on
asp-cloud (60 × 0.60 = 36); ren's two `issue-execute` bindings and dario's on
`agent-workforce` replace `issue-implement` / `issue-design` one for one (net
0). Ceiling delta ≈ +78 USD/month before the no-op short-circuit (a fire whose
scan finds 0 candidates ends in minutes and costs a fraction of its class),
inside the 600 USD ceiling and offset in practice by the end of the daily
patrol fires that read the whole asp-cloud tracker. Each new binding's note in
the manifest is its budget line.

**Verification.** The mechanism PRs ship the pure module with unit tests for
every guard named in §2 (one stage, one owner, served owner, held-by-PR,
evidence per close reason, the per-run close budget, the assignment cap) and
for the executor's selection rule; the I/O layer's two readers (the close
budget file, the open-PR claim map) are tested with stubs. The write surface
runs every guard before its first write by construction.

**Reversal.** Re-add the five scripts from git history, unarchive the two
skills, restore the old manifest rows. Labels are additive; nothing in the
merge predicate or the PR lane changed.

## Alternatives rejected

- **Keep lanes, fix the owner check.** The fix was already in (adr-0038
  `worker_owners`); #760 still burned three hops. The defect is that two
  labels answer one question.
- **Keep `issue-implement` and `issue-design` as separate executors selecting
  by `owner:*`.** Two bodies with the same selection, catch-up, PR and
  hand-back steps, differing in one artefact table. Rule 11 would then bind
  every lifecycle change to two PRs forever.
- **Let each member patrol but comment only when owned.** Still N cadences
  reading every issue daily for nothing; the selection query is the simpler
  control and the one the operator asked for.
- **Keep `wf:handback` and the hop marker as mechanical bounds.** A hand-back
  is Verified-with-a-comment, and the router's own comments are the count;
  neither needs its own label family.
