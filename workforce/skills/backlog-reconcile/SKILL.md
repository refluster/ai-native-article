---
name: backlog-reconcile
description: Reconcile a repo's planning artifacts — epics/specs and their open issues — against what has actually shipped in the current deployment, so the backlog reflects reality instead of intent. Use when the tracker has drifted; items marked open that already shipped, designs quietly obsoleted by a later evolution, work completed incidentally, or issues that no longer match the code. It discovers the planning surface and the issue tracker, fans out subsystem-owner agents to audit each item against the live codebase plus git history, classifies every item (done, in-progress, not-started, obsoleted-by-evolution, incidentally-done), rewrites statuses with dated evidence notes, then trues up the issues — closing shipped ones, retiring obsolete ones, splitting or rewriting stale ones, and filing fresh issues for the genuine remaining work it surfaces. Ships as a draft PR and hands the merge plus any reclassification sign-off to the operator; never self-merges.
---

# backlog-reconcile

A **claude-code-routine** skill (R-N1(a)): it runs in a Claude Code session because it
fans out audit subagents, edits planning docs, and drives a PR + the issue tracker —
none of which a Lambda can host. It is **operator-invoked and one-shot**, not a cadence.

The job: a repository's *plan* (its epics/specs and the open issues under them) drifts away
from its *shipped reality* over time. Items sit at `open`/`draft` long after the work landed;
some designs are quietly **obsoleted** by a later evolution before they were ever built; some
work **completed incidentally** as a side effect of unrelated changes; and the remaining issue
set no longer maps cleanly onto the code. This skill re-grounds the plan against the current
deployment and leaves the tracker telling the truth — **including the net change to the open
issues** (close, retire, rewrite, split, and *file new ones* for the real remaining work).

> **Nothing here is hard-coded to one repo.** Paths, status vocabularies, and who-audits-what
> are all **discovered or derived** at run time (Step 0–2). When this document gives an example
> it labels it as such. Do not assume a fixed planning-doc path or a fixed roster.

## Inputs / run context

- **Repo + tracker.** The bound project's repo (the GitHub `owner`/`repo`). A `github.token`
  is required (declared in `meta.json:requires`) — export it for the GitHub MCP / API calls
  that read, label, close, and open issues and open the PR.
- **Optional scope hint.** The operator may name a subset ("just the platform epics",
  "everything under the 2026-Q2 milestone"). Absent a hint, **every** open planning item is in
  scope.
- **Optional roster hint.** The operator may name the agents to divide the work across. Absent
  one, derive the partition from subsystem ownership (Step 2).

## Step 0 — establish the two ground truths

You are comparing **the plan** against **the deployment**. Pin both before judging anything.

1. **The planning surface.** Discover, don't assume. Look for the repo's planning artifacts and
   its *status index*:
   - a directory of specs/epics with a status line per file and an index/table that claims to be
     the canonical status view (example shape: an `epics/` or `specs/` dir with a `README` index);
   - and/or a GitHub Projects board / milestones / a `STATUS.md`.
   - **Read the repo's own status-definition doc if it has one** — capture the exact lifecycle
     states (e.g. `Draft → Accepted → In-progress → Implemented | Rejected`), whether the
     lifecycle is declared **monotonic**, and what each state's exit criteria are. You will write
     statuses back in *that* vocabulary, not a generic one.
2. **The shipped reality.** What is actually live: the deployed code on the default branch, the
   infra/IaC, the merged PRs, the release/deploy history. `git log`, the IaC templates, and the
   running app/endpoints are the evidence — not the plan's own prose.

If the repo has **no** planning surface at all, stop and tell the operator — there is nothing to
reconcile; this is not the skill for greenfield planning.

## Step 1 — inventory both sides

- Enumerate every in-scope planning item with its **current** status line, owner, and any
  "implemented by / tracked by" pointers.
- Enumerate every **open issue** in scope (and the closed-recently set, to catch double-work),
  with labels, milestone, and the epic/spec it claims to serve.
- Produce a flat work-list. This is the fan-out unit for Step 2.

## Step 2 — partition by subsystem and fan out parallel auditors

Divide the work-list into partitions **by subsystem / domain**, and assign each partition to the
agent who **owns or is strongest in that area** — match the auditor to the surface, e.g.
backend/substrate, product/UI, data/pipeline, quality/eval, infra. Pull in **additional**
auditors when a partition is too large for one pass or spans a genuinely distinct surface. The
mapping is **by ownership, not by fixed names** — derive it from the project's org/CODEOWNERS or
the operator's roster hint.

Launch the auditors **in parallel** (one subagent per partition). Give each the same contract:

> For each item in your partition: read its acceptance criteria / definition-of-done, then
> **verify against the live codebase + git history whether the behaviour actually exists** —
> cite concrete files, line refs, PR numbers, and any superseding decision record. Classify the
> item into exactly one bucket (Step 3). **Evidence discipline: never call something done unless
> you can point at the code that does it.** Return a structured report; do not edit files.

Auditors are **read-only**. All writes happen after synthesis (Step 5+), so the classification
stays consistent across partitions.

## Step 3 — the classification buckets

Every item lands in exactly one, expressed in the repo's own status vocabulary:

| Bucket | Meaning | Typical status write |
|---|---|---|
| **Done** | Behaviour is live; cite files + PRs. | the terminal "shipped" state |
| **Incidentally done** | Was open/draft, but shipped as a side effect of other work (status lagged reality). | terminal "shipped" state + a note that it skipped intermediate states |
| **In-progress** | Partially built; real open gates remain. Name the gates. | the mid-lifecycle state |
| **Not started** | Genuinely unbuilt; still valid intent. | unchanged |
| **Obsoleted by evolution** | The design was overtaken by a later decision/architecture before it shipped; the *goal* may have been met a different way. | the "rejected/superseded" state, with a pointer to what replaced it |

The last two buckets are the high-value finds and the easiest to get wrong — be skeptical, and
make the **superseding decision record** explicit for every "obsoleted".

## Step 4 — synthesize + resolve the judgment calls

Merge the partition reports into one verdict table. Resolve the ambiguous cases yourself:
disputed "done vs in-progress" gates, the date to stamp a status flip (prefer a documented
go-live event; otherwise the reconciliation date, with the imprecision noted), and whether a
"goal met a different way" is a *supersession* (rejected) or a genuine *completion*.

## Step 5 — write the plan back

For each item whose status changed:

- Update the **status line** (and any "implemented/tracked by" pointer) in the repo's vocabulary.
- Add a **dated reconciliation note** to the item body: who audited it, the bucket, and the
  evidence (files / PRs / superseding decision record). This is the audit trail that survives the
  next personnel/model migration.
- **Keep the canonical index in sync** — if the planning surface has a status table/board, update
  every changed cell and add rows for any item missing from it. If the repo documents a
  monotonic lifecycle, respect it: a forward jump to reflect reality is fine; a *backward* move
  is not — open a follow-up item instead.

## Step 6 — true up the issues (the net increase/decrease + rewrites)

Reconciliation is not done until the **open issue set** matches the new reality. For each open
issue in scope:

- **Shipped** → close it, referencing the merged PR(s) / the now-"done" planning item.
- **Obsoleted** → close as "won't do / superseded", pointing at the decision that replaced it.
- **Stale but still valid** → rewrite the body to match the current code (correct file paths,
  renamed surfaces, changed acceptance criteria). If the original issue has grown to cover two or
  more separable pieces, **split** it into focused issues.
- **Untouched & still accurate** → leave it.

Then **close the gap the audit opened**: every "In-progress" and "Obsoleted-but-goal-still-wanted"
item from Step 3 usually surfaces **genuine remaining work that has no issue yet** (a carved-out
sub-task of an obsoleted epic, an open definition-of-done gate, a follow-up the supersession
created). **File a new issue for each**, linked to its planning item and labelled per the repo's
scheme. The deliverable of this step is an explicit **diff to the backlog** — N closed, M
rewritten/split, K newly filed — not just edited docs.

> Issue mutations (close / rewrite / open) are outward-facing and harder to reverse than a doc
> edit. Batch the proposed diff and, if the operator hasn't pre-authorised the issue churn, show
> it for a yes before applying — especially bulk closes.

## Step 7 — ship it, hand off the merge

- Commit the planning-doc changes with a message that **cites the layer/area** (not "fix: stuff").
- Open a **draft PR** describing the verdict table, the bucket counts, the **issue diff**, and the
  remaining genuine open work. Then drive it to review-ready (all CI green, no unresolved threads,
  flip to Ready) — reuse the repo's existing "ship a draft PR to green" routine rather than
  re-implementing it.
- **Never self-merge.** Hand the merge to the operator. Call out explicitly any **reclassification
  that is a design decision** — every "Obsoleted/Rejected" is one — because those normally require
  operator (or governing-body) sign-off, and merging encodes that decision.

## Guardrails

- **Evidence or it didn't ship.** No status flips to "done" without a file/PR you can point at.
- **Read-then-write split.** Audit subagents never edit; writes happen once, post-synthesis.
- **Respect the lifecycle contract.** Use the repo's own status vocabulary and monotonicity rule.
- **Outward actions get a confirmation bar.** Bulk issue closes and the merge are the operator's;
  surface, don't assume.
- **Stay inside scope.** Reconcile the plan to the code — do **not** start *building* the
  remaining work in the same pass. New work becomes issues (Step 6), not commits.

## Out of scope

- Greenfield planning / authoring brand-new epics (this skill reconciles an *existing* plan).
- Merging the PR, or merging/closing issues the operator hasn't signed off when they're design
  decisions.
- Implementing the remaining work it surfaces — that ships as filed issues, not code here.
