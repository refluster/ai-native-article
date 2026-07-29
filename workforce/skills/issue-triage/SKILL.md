---
name: issue-triage
description: Assign every open issue in the bound project's tracker to exactly one worker lane — implement (issue-implement), design (issue-design), or operator (a human) — as machine-readable `wf:lane:*` + `wf:owner:*` labels plus a stated dispatch comment, and re-examine issues parked in a `*:needs-human` state longer than the re-queue window so no issue is permanently absorbed. The dispatcher end of the issue→merge loop (adr-0022): work is routed to a named worker rather than left for whoever happens to self-select. Runs as a CCR task on the binding's cron; github.token via the binding's project linkage.
---

# issue-triage

**The gap this closes.** The tracker had one consumer — an engineer persona's
`issue-implement` — and that cadence self-selected implementable work. Nothing
was wrong with its judgment; the problem was structural. An architecture,
product, or L1 issue was eligible for **nobody**: no cadence claimed it, and no
cadence declined it, so it simply aged. On 2026-07-29 the open backlog held 35
issues, of which the `role:architecture` / `role:product` / `layer:L1` tail had
sat untouched since early June — not rejected, just never looked at. The
`issue-implement:needs-human` label had the mirror-image shape: an absorbing
state with no path back, holding issues whose blockers had since resolved.

You are the routing persona (Nadia's PdM lens). Your output is not work on
issues — it is the **assignment** of every issue to a worker who will do it, and
the honest naming of the ones only the operator can.

Your task context supplies `agent_slug`, `project_id` (whose `project.json`
declares the repo), `credentials['github.token'].token` (export as
`GITHUB_TOKEN`), and `binding_config`: `max_issues_per_run` (default 10),
`requeue_days` (default 14), `lane_owners` (the lane → persona-slug map this
binding dispatches to), `sign_off_persona`.

## The lanes

| Lane | What belongs in it | Worker |
|---|---|---|
| `implement` | A code or config change with a verifiable acceptance criterion. | `issue-implement` (engineer persona) |
| `design` | A decision or document to be **drafted**: an ADR, an epic/story, a design record, a governance-amendment proposal. | `issue-design` (architecture/product persona) |
| `operator` | Work no agent can perform: AWS console actions, credentials, spend, physical/live verification. | the operator |

**The design lane is the one that unlocks the stalled tail, and its logic is
worth stating plainly:** an L0/L1 issue may not be *implemented* autonomously —
that is the operator's surface and stays so — but a **proposal** for it can
always be drafted. The `layer:L1` deny-list on `issue-implement`'s binding was
correct and stays; what was missing was any lane where an L1 issue produces a
reviewable diff instead of silence. A drafted ADR the operator merges (or
rejects) is progress; an untouched issue is not.

**`operator` is a decision, not a default.** Route an issue here because you
identified the specific action only a human can take — and say what it is in the
dispatch comment. If you find yourself putting most issues here, the lane
vocabulary is wrong and that is a finding to report, not a workaround to apply.

## Step 1 — discover (deterministic, read-only)

```sh
GITHUB_TOKEN="<credentials['github.token'].token>" \
  node workforce/skills/issue-triage/issue-triage-scan.mjs \
    --project "<project_id>" --max <max_issues_per_run ?? 10> \
    --requeue-days <requeue_days ?? 14> \
    --out /tmp/issue-triage-candidates.json
```

Candidates come back **oldest-activity first** — the aged tail is exactly what
stopped being looked at — each with its labels, body, `decision.action`
(`triage` | `requeue`) and a heuristic `lane_suggestion`. **0 candidates is a
first-class outcome**: the tracker is fully dispatched; record the no-op and stop.

## Step 2 — decide each issue's lane (your judgment)

The `lane_suggestion` is a starting point from the issue's labels, never the
decision. **Read the issue** — body, comments, the epic it serves — and decide:

- **What is the deliverable?** A diff to code (`implement`), a diff to a document
  (`design`), or an action outside git (`operator`). This question, not the
  issue's labels, is the lane.
- **Is it one coherent piece of work?** A tracker/epic issue (`type:tracker`)
  that decomposes into stories is a `design` item — its deliverable is the
  decomposition, not the work. Say so.
- **Who owns it?** Take the persona from `binding_config.lane_owners`; if the
  issue's surface clearly belongs to a different persona than the lane's default
  (a finance surface, a design-system surface), name that persona instead and
  say why. The owner label is `wf:owner:<slug>` — **never** an `@`-mention
  (ML-012; the post script refuses a raw `@` outside backticks).

**On a `requeue` candidate** (parked past the window), do the re-examination for
real: read the parking comment, then check whether its stated blocker still
holds — the blocking PR may have merged, the design may have landed, the question
may have been answered. Then either re-lane it (the label is cleared with
`--requeue`) or **restate the blocker with today's evidence** and leave it parked.
"Still blocked, because <current fact>" is a complete and useful outcome; silently
leaving it is what this step exists to prevent.

## Step 3 — dispatch (deterministic)

Write `/tmp/dispatch-<number>.md`:

```md
**<PersonaName> — dispatch: lane `<lane>`, owner `wf:<slug>`.**

<one paragraph: what the deliverable is and why this lane — in the issue's own terms>

<For `operator`: the specific action only a human can take. For `requeue`: what changed since it was parked, or why the blocker still stands.>

— <PersonaName> (CCR persona; see workforce/skills/issue-triage/SKILL.md)
```

```sh
GITHUB_TOKEN="…" node workforce/skills/issue-triage/issue-triage-post.mjs \
  --project "<project_id>" --issue <number> --lane <lane> --owner <slug> \
  --body-file /tmp/dispatch-<number>.md [--requeue]
```

The script stamps `wf:lane:<lane>` + `wf:owner:<slug>`, removes any **other**
lane label (one issue, one lane), and with `--requeue` clears the parked
`*:needs-human` label that made the issue invisible. Never apply these labels by
hand or with an MCP tool — the one-lane invariant and the ML-012 guard live in
the script.

## Step 4 — report what the dispatch revealed

End the run with a short summary: counts per lane, how many were re-queued, and
— the load-bearing part — **any issue you could not lane**, with why. An issue
that fits no lane is a finding about the lane vocabulary (or about the issue),
and it is the one thing this cadence must never do silently: leaving it
unlaned recreates precisely the invisible backlog this skill exists to end.

## Scope

- **Dispatch, never implement.** You do not write code, draft the design, or do
  the operator's action. Assigning it is the whole job.
- **Every candidate ends laned or reported.** A run that leaves a candidate
  untouched and unmentioned is incomplete.
- **Bounded batch** (`max_issues_per_run`); the daily cadence works the backlog
  down, not a single fire.
- **Comment + label only.** No issue closes, no body edits, no PRs (R-N9).
- **You never change a lane an active worker holds** — `*:in-progress` /
  `*:pr-open` issues are skipped by the scan; re-laning under a worker's feet
  strands its branch.

## Out of scope

- Closing stale issues or reconciling epic status — that is `backlog-reconcile`.
- Filing new issues; deciding whether an issue is *worth doing*. Triage routes
  what exists.
- Anything on a PR — `pr-autopilot` (review) and `pr-remediate` (author-side).

Related: [adr-0022](../../docs/adr/adr-0022-issue-to-merge-flow.md),
[issue-to-merge-flow runbook](../../docs/runbooks/issue-to-merge-flow.md),
[issue-implement](../issue-implement/SKILL.md), [issue-design](../issue-design/SKILL.md).
