---
name: issue-execute
description: Work the issues assigned to you — `stage:assigned` + your own `owner:` label in the bound project's tracker, nothing else — to a draft PR each, or hand one back with a reason. The one executor skill of the four-stage lifecycle (adr-0046), bound per member × project; it replaces issue-implement and issue-design. The deliverable is whatever the issue asks for: a code / config / test / doc change, or a decision document (ADR, design note, epic decomposition, amendment proposal) when the issue is a decision. Catches up on the issue's epic and the target repo's own governance before touching anything; never merges (R-N9); never comments on or labels an issue it does not own. Runs as a CCR task on the binding's cron and on dispatch when an issue is assigned; github.token via the binding's project linkage.
---

# issue-execute

A **claude-code-routine** skill (R-N1(a)): it clones and edits a working
tree, runs the target repo's own gate, and drives a branch to a draft PR.
Fired on a per-member daily binding by the orchestrator-tick CCR path, and
on dispatch the moment the router assigns you something.

**The whole selection rule.** You work an issue if and only if it is open,
`stage:assigned`, and carries `owner:<agent_slug>`. You do not read, comment
on, label, or open a PR for any other issue — not to decline it, not to be
helpful, not to note a finding. Findings about an issue you do not own go in
your run report, nowhere else. This replaced a cadence that patrolled the
whole tracker and left a decline comment on everything it could not take.

Your task context supplies `agent_slug` (you — ren or dario today),
`project_id` (its `project.json` names the target `github.{owner,repo}` and
`governance_docs`), `credentials['github.token'].token` (export as
`GITHUB_TOKEN`), `credentials['workforce.dispatch_token'].token` (exported
as `WF_DISPATCH_TOKEN`), `run_id`, and `binding_config`:
`max_issues_per_run` (default **2**), `sign_off_persona`.

## Step 1 — your queue (read-only)

```
is:issue is:open label:stage:assigned label:owner:<agent_slug>
```

Drop any issue an **open PR** already references (`Closes` / `Fixes` /
`Resolves` / `Refs #N`, or an `issue-N` head branch) — that PR is the claim
and the review lane owns it now. Take the oldest `max_issues_per_run`.
**Zero is a first-class, cheap outcome**: record a one-line no-op and stop.

There is no in-progress label. The branch and the draft PR are the only
claim; a run that dies before opening one leaves nothing behind to clean up.

## Step 2 — catch up before touching anything

This is what separates a careful member from a naive one. For each issue,
before writing a line:

1. **Read the full issue** — body, every comment (the router's assignment
   comment says what it decided you are delivering), linked issues and PRs.
2. **Read the epic / design doc it serves, in full.** An issue is a slice of
   an epic's intent and the slice can mislead without the whole. No
   reference → a standalone item; do not invent one.
3. **Read the target repo's own law.** `project.json:governance_docs`
   first, then what the repo itself points at: `AGENTS.md` / `CLAUDE.md`,
   `CONTRIBUTING.md`, its ADR directory, `CODEOWNERS`. The target's
   invariants bind you exactly as this repo's bind you here.
4. **Read the code or the documents the change touches**, their tests, and
   the surrounding conventions. Match them.

## Step 3 — decide the deliverable

The issue says which of two things it wants. Pick one, and say which in the
PR.

**A change** (code, config, CI, test, doc) — when the statute already permits
it and no new decision is needed. Make the **smallest correct change** that
meets the acceptance criteria; add or extend tests where the surface has
them; run the repo's **own gate** (its `package.json` scripts, `Makefile`, or
the commands its CI workflow runs). A change that has not been through the
target's verification is not done; a gate you cannot run is stated in the PR,
never silently skipped. Too large for one PR → ship the smallest complete,
mergeable slice and say exactly what is left, citing the issue with `Refs #N`
rather than `Closes #N`; the issue stays yours after the merge.

**A document** — when the issue is a decision, or asks for one. Pick the
lightest artefact that settles it, in the target repo's own format:

| The issue asks for | Artefact |
|---|---|
| How to do something *inside* existing statute (a fix shape, a structure choice, a data-shape detail) | a **design note** in the repo's design-record location — not an ADR |
| A decision between options, or a rule that will constrain later work | an **ADR**, numbered against the directory **and every open PR that adds one** (collisions have cost three drafts their merge) |
| A body of work to split into deliverable pieces | an **epic / story decomposition**, each piece scoped to one PR |
| A change to an L0/L1 statute | a **proposal diff** to that document, written so the operator can reject it as easily as accept it |

A document states the decision in one sentence at the top; what forced it,
with evidence; the alternatives rejected; what it costs; how it would be
reversed; what is out of scope. You never implement the decision you propose
in the same PR — a decision and its implementation are two reviews with two
bars. Say what would implement it.

## Step 4 — open the draft PR (never merge, never push the default branch)

Branch `<agent_slug>/issue-<N>-<short-kebab-slug>` off the default branch;
one issue, one PR. Push it, open it as a **draft**, and post one short
comment on the issue linking it. Body:

```md
Closes #<N>   ← `Refs #<N>` when work remains after this merges

<one paragraph: what this delivers, in the issue's own terms>

**Deliverable:** change | document (<artefact + path>)
**Epic / design doc consulted:** <path or "none referenced">
**Governance consulted:** <governance_docs + the ADRs / CONTRIBUTING you read>
**Test plan:** <the exact commands you ran and their result, or why none could run>

wf-task-id: <run_id>
wf-agent: <agent_slug>

---
Authored by an LLM persona (workforce `issue-execute`, R-N1(a)). Verify before merging.
```

Then wake the reviewer so the PR routes now rather than at `pr-autopilot`'s
next tick (adr-0025) — best-effort, always exits 0:

```sh
node workforce/scripts/dispatch-cadence.mjs --skill pr-autopilot \
  --project "<project_id>" --reason "draft PR #<pr> opened for issue #<N>"
```

This skill declares `external-pr`, never `external-pr-merge`: do not merge,
approve, or request changes on your own PR, however confident you are.
Merging it closes the issue; that is the only way an issue of yours closes.

## Step 5 — hand back when it is not yours

When Step 2 shows the issue is not something you can deliver — the deliverable
needs a decision only a human may make and nothing is left to draft, the
scope is ambiguous beyond what a reasonable reading settles, it conflicts
with the target's own governance, or it belongs to a different lens — do
**not** guess and do **not** decide who should have it instead. Write
`/tmp/handback-<N>.md` with the specific blocker (quote the clause, cite the
ADR, name the decision) and:

```sh
GITHUB_TOKEN="…" node workforce/skills/issue-triage/issue-stage-set.mjs \
  --project "<project_id>" --issue <N> --to verified \
  --body-file /tmp/handback-<N>.md
```

That posts your comment, moves the issue back to Verified with your owner
label removed, and dispatches the router. One comment, then move on. A
hand-back is a normal, cheap outcome, not a failure of the run — but a
hand-back whose reason is "this needs an ADR" is usually wrong: drafting the
ADR *is* the deliverable (Step 3), and the operator's signature is what comes
after.

## Guardrails

- **Only what is yours.** The selection query in Step 1 is the whole scope.
- **R-N9, absolute.** PR-only; never a direct commit to the target's default
  branch; never a merge.
- **Catch-up is not optional.** Step 2 runs in full for every issue.
- **Never `@`-mention a persona slug** (ML-012) — backticks.
- **Bounded batch.** Never exceed `max_issues_per_run`.
- **Fail loud (W-4).** A GitHub error, an unreadable governance doc the
  issue depends on, or a gate you cannot run surfaces in the run output —
  never a silent partial PR.
- **Rule 11 on this repo.** When the target is `refluster/ai-native-article`
  and the deliverable is a `workforce/skills/*/SKILL.md` body, bump that
  skill's `meta.json:version` in the same PR and touch only one skill body.

## Out of scope

- Reviewing PRs (`pr-autopilot`), fixing review findings on a PR
  (`pr-remediate`), filing or closing issues (`backlog-reconcile`), routing
  (`issue-triage`).

Related: [adr-0046](../../docs/adr/adr-0046-issue-lifecycle-stages-and-owners.md),
[issue-to-merge-flow runbook](../../docs/runbooks/issue-to-merge-flow.md),
[issue-triage](../issue-triage/SKILL.md).
