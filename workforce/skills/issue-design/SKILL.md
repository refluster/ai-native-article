---
name: issue-design
description: Work the `wf:lane:design` issues in the bound project's tracker — architecture, product and L0/L1-governance items whose deliverable is a decision or a document, not code — into a reviewable draft PR carrying an ADR, an epic/story decomposition, a design record or a governance-amendment proposal. The counterpart to issue-implement for work an engineer cadence structurally cannot take (adr-0022). Never merges, never implements the decision it proposes; the operator merges anything touching L0/L1. Runs as a CCR claude-code-routine task on the binding's cron; github.token via the binding's project linkage.
---

# issue-design

**Why this exists.** `issue-implement` correctly refuses `layer:L0` / `layer:L1`
and `type:tracker` issues: those surfaces are operator-owned, and an epic does not
scope to one coherent code PR. But refusing to *implement* was silently read as
refusing to *touch*, and the whole architecture/product tail of the backlog
stopped moving — issues nobody claimed and nobody declined.

The resolution is a distinction the tracker was missing: **an L0/L1 issue may not
be implemented autonomously, but a proposal for it can always be drafted.** A
drafted ADR the operator merges or rejects is progress. An untouched issue is not.
This cadence produces that draft.

**What you produce is a document diff, and nothing else.** You never implement the
change the document proposes — not "while you are in there", not as a
demonstration. A decision and its implementation are two reviews with two
different bars, and merging them is how a governance change ships without ever
being read as one. If the issue needs both, the PR carries the decision and names
the implementation as follow-up work.

Your task context supplies `agent_slug` (the architecture/product persona — the
standing instance is Dario), `project_id`, `credentials['github.token'].token`,
`run_id`, and `binding_config` (`max_issues_per_run` default **2** — design work
is slower and more expensive per item than implementation; `sign_off_persona`).

## Step 1 — pick candidates (read-only)

Eligible issues carry **`wf:lane:design`** (stamped by `issue-triage`) and:

- are not already claimed — no open PR references them (`Closes #N`), no
  `issue-design:in-progress` / `issue-design:pr-open` label;
- do not carry `issue-design:needs-human` (the parked state; `issue-triage`'s
  re-queue window is what brings one back, not you);
- are unassigned or assigned to this run's persona.

Take the first `max_issues_per_run` (default 2), **oldest activity first** — the
aged tail is the reason this lane exists. Zero candidates is a first-class, cheap
outcome. Stamp `issue-design:in-progress` before starting, and replace it however
Step 4/5 resolves.

## Step 2 — catch up, then decide what artefact is owed

Do the full `issue-implement`-grade homework before writing: the issue and every
comment, the epic it serves **in full**, the target repo's own governance
(`project.json:governance_docs`, its `AGENTS.md`/`CLAUDE.md`, its ADR directory,
`CONTRIBUTING.md`), and the code or docs the decision would touch. A design
document written without reading the system it governs is the most expensive kind
of wrong.

Then pick **one** artefact — matching the target repo's own conventions, which you
discover rather than assume:

| The issue asks for | Artefact |
|---|---|
| A decision between options, or a rule that will constrain later work | An **ADR** in the repo's ADR directory, following its existing template + index conventions |
| A body of work to be broken into deliverable pieces | An **epic / story decomposition** in the repo's epic format, each story scoped to one coherent PR |
| A change to an L0/L1 statute (governance, invariants, identity) | A **proposal diff** to that document — the amendment itself, written so the operator can read exactly what changes and reject it as easily as accept it |
| A UI/visual-system decision | A **design record** in the repo's design-doc location (`design-note` is the workforce's own format) |

If the issue does not scope to one artefact, produce the **decomposition** (a
tracker with the pieces named) rather than a sprawling document — that is itself
the deliverable, and say so.

## Step 3 — write it so it can be rejected

A proposal a reviewer cannot disagree with is not a proposal. Every artefact
states, in the repo's own idiom:

- **The decision, in one sentence**, at the top — not buried in the rationale.
- **What forced it** — the concrete situation, with evidence (issue numbers, PRs,
  observed failures, dates). Not "for maintainability".
- **The alternatives considered and why each was rejected.** An ADR with one
  option is a record of a preference, not a decision.
- **What it costs** — what becomes harder, what has to change, what it forecloses.
  A proposal with no stated cost has not been thought through.
- **How it would be reversed**, and what would tell us it was wrong.
- **Explicitly out of scope**, so the review is bounded.

Cite the governing law: the ADR/statute this amends or defers to, and the rule
that would have to change for the proposal to hold. Where the target repo requires
a citation in the PR body (this repo's R-11 gate does), carry it.

## Step 4 — open the draft PR (never merge, never implement)

Branch `<agent_slug>/issue-<N>-<short-kebab-slug>` off the default branch; one
issue, one PR. Body:

```md
Closes #<issue-number>

<one-paragraph summary: the decision proposed, in the issue's own terms>

**Artefact:** <ADR / epic decomposition / statute amendment / design record> — <path>
**Epic / design doc consulted:** <path or "none referenced">
**Governance consulted:** <the governance_docs + ADRs/CONTRIBUTING you read>
**Decision, in one line:** <the proposal>
**Alternatives rejected:** <one clause each>
**Implementation:** not in this PR — <what would implement it, and where it is tracked>

wf-task-id: <run_id>
wf-agent: <agent_slug>

---
Authored by an LLM persona (workforce `issue-design`, R-N1(a)). This proposes a
decision; it does not make one. Verify before merging.
```

Open it as a **draft**, replace `issue-design:in-progress` with
`issue-design:pr-open`, and comment the PR link on the issue. Then stop: the PR
goes to `pr-autopilot` like any other, and an L0/L1 artefact escalates to the
operator by the existing predicate — which is correct and is the point. Your
deliverable is the reviewable diff, not the merge.

## Step 5 — park with a reason (never silently drop)

When the issue cannot be turned into one artefact — the decision needs
information only the operator has, the issue's premise is contradicted by a
standing ADR, or it is really three decisions — comment saying **exactly that**
(quote the clause, cite the ADR, name the three decisions), replace
`issue-design:in-progress` with `issue-design:needs-human`, and move on. This is a
normal outcome.

The park is **not** absorbing: `issue-triage`'s re-queue window brings it back for
re-examination, so a blocker that resolves later does not bury the issue. That is
the whole reason to state the blocker precisely — your comment is what the next
router reads.

## Guardrails

- **Propose, never merge** (R-N9; `external-pr`, not `external-pr-merge`). No
  direct commit to the default branch, ever.
- **Never implement the proposal in the same PR** — see the opening. The one
  exception is a mechanical index/README row the repo's own convention requires
  alongside a new ADR.
- **Never edit a decided ADR in place.** A reversal is a new superseding ADR;
  that is the same rule this repo holds itself to.
- **Never `@`-mention a persona slug raw** (ML-012) — `wf:<slug>` in backticks.
- **Bounded batch**: `max_issues_per_run` per fire.
- **Fail loud (W-4)**: an unreadable governance doc the issue depends on, or a
  GitHub API error, surfaces — never a half-written artefact.

## Out of scope

- Implementing anything (`issue-implement`), reviewing PRs (`pr-autopilot`),
  fixing your own PR after review (`pr-remediate` owns the author lane).
- Deciding which issues belong in this lane — that is `issue-triage`.
- Reconciling epic status across the tracker — that is `backlog-reconcile`.

Related: [adr-0022](../../docs/adr/adr-0022-issue-to-merge-flow.md),
[issue-to-merge-flow runbook](../../docs/runbooks/issue-to-merge-flow.md),
[issue-triage](../issue-triage/SKILL.md), [issue-implement](../issue-implement/SKILL.md),
[design-note](../design-note/SKILL.md) (the workforce's own design-record format).
