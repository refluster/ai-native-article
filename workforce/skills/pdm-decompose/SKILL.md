---
name: pdm-decompose
description: |
  SUPERSEDED (2026-05-25). The role-tagged Epic → child-task decomposition
  step is no longer part of the workflow — Claude Code consumes Story
  issues directly and decides role decomposition inside the PR. This file
  remains on disk for trivial reversibility; the Maya binding that fires
  it daily has been removed.
---

# pdm-decompose — superseded (kept on disk for reversibility)

> **STATUS**: superseded by the simplified flow defined in
> [workforce/docs/epics/README.md](../../docs/epics/README.md). Maya
> still owns Epic → Story decomposition (covered by `pdm-charter`), but
> the additional role-tagging layer this skill produced is no longer
> needed.

**Owner**: maya (PM / Founder)
**Executor**: deterministic (handler calls Anthropic + GitHub directly)
**Cadence**: daily 15:00 America/Los_Angeles (cron(0 22 * * ? *) — PDT; slips to 14:00 in PST)
**Status**: binding removed from `workforce/agents/maya/agent.json`; handler retained for reversibility

## What this skill does

Reads the open GitHub issues in `refluster/ai-native-article` whose title matches `^\[Epic-` and whose body contains a `## Workstreams` section. For each, it classifies the state and advances exactly one transition per run.

### State machine

```
UNDECOMPOSED          (no children, no Maya-authored proposal comment)
   │
   │  Maya reads Workstreams, runs scenario-validation step,
   │  posts a ### Proposed decomposition comment listing the
   │  child issues she WOULD create (role, deliverable, AC,
   │  reviewer personas). Marks the comment with the literal
   │  HTML comment `<!-- pdm-decompose:proposal -->` so
   │  subsequent runs can detect it.
   │
   ▼
AWAITING_OPERATOR     (proposal comment present; no 👍 reaction)
   │
   │  Operator either:
   │   (a) adds a 👍 reaction on the proposal comment → APPROVED
   │   (b) leaves a reply comment with adjustments → Maya revises
   │       and re-posts (stays in AWAITING_OPERATOR)
   │   (c) closes the epic → SKIPPED (no further action)
   │
   ▼
APPROVED              (proposal comment has 👍 from operator)
   │
   │  Maya creates the child issues using the proposal's
   │  contents. Each child issue carries:
   │   - title `[Epic-N Story M] (role) — concise deliverable`
   │   - body with AC + parent link + "Reviewer personas: dario, aoi"
   │   - labels: `wf:ready`, `role:{architecture|engineering|design|qa}`,
   │     `epic:{N-M}`, and `reviewer:{persona}` for each reviewer
   │  Adds them as sub-issues of the parent (REST sub_issues API).
   │  Then dispatches the implementer routine (POST to CCR /fire
   │  for executor=claude-code-routine bindings; ...).
   │
   ▼
DECOMPOSED            (has child issues — no further action)
```

### Per-run budget

- ≤ 1 Anthropic call per epic (cap at 5 calls per run to bound cost)
- ≤ 1 GH comment per UNDECOMPOSED epic
- ≤ N GH issue creates per APPROVED epic (N = children in proposal, typ. 3–5)
- ≤ N dispatch POSTs per APPROVED epic

A run that finds nothing to do exits with `summary: "no work"`. The deterministic handler records the scan summary as the RUN row's `output_summary` so the audit trail is non-empty.

## Inputs

Standard `RunnerContext` (slug + startedAt). No extra parameters. The
target repository is hard-coded to `refluster/ai-native-article` (this
skill's only consumer for v1).

## Outputs / side effects

- **Output bytes (S3)**: JSON record of the scan. Shape:
  ```json
  {
    "scanned": [
      { "issue": 90, "state": "DECOMPOSED" },
      { "issue": 91, "state": "AWAITING_OPERATOR" },
      { "issue": 92, "state": "UNDECOMPOSED", "action": "proposal_posted", "comment_url": "..." }
    ],
    "approved_decomposed": [
      { "parent": 93, "children": [124, 125, 126] }
    ],
    "errors": []
  }
  ```
- **GitHub**: at most one issue comment per UNDECOMPOSED epic; at most N issue creates per APPROVED epic
- **No Notion / Discord side-effects** in v1. Discord notification of the daily summary is a future enhancement (dispatch via Yuki's `discord-ping` skill chained from Maya — out of scope for PR B).

## Reasoning step prompt

When proposing a decomposition, Maya's reasoning call is sent to `claude-opus-4-7` with:

- **system**: Maya's `system.md` (PM/Founder voice) + the contract block below
- **user**: the parent issue's body, specifically the `## Workstreams` section, plus a section reminding her of the scenario-validation requirement

The contract block (kept in the handler, not in agent system.md, so it
versions with the skill):

> You are decomposing an Epic into child GitHub issues. Read the parent
> issue body's `## Workstreams` section carefully. Before proposing,
> identify 2–3 concrete operator scenarios this epic must support and
> walk through whether each child task makes them work. If a scenario
> reveals a gap, expand the workstream list.
>
> For each child, output:
> - title: `[Epic-N Story M] (role) — <≤80-char deliverable>`
> - body: includes AC bullets + parent link + "Reviewer personas: ..."
> - labels: `wf:ready`, `role:<role>`, `epic:<N-M>`, `reviewer:<persona>` for each reviewer
>
> Output ONLY a JSON array of children, no preamble. Schema:
> `[{title, body, labels: string[], reviewer_personas: string[]}]`.
>
> Architecturally significant decisions (new managed service, > USD 10/mo
> spend, R-N* implications) → propose alternatives in the body and add
> `coordination_required:[dario]` label. Do NOT silently decompose work
> that should go through architecture review.

## Failure modes

- **GH API down / rate-limited**: skill throws; orchestrator records RUN.status=throw; next tick (24h later) retries from scratch. State is fully derivable from issue/comment state.
- **Anthropic call fails / `stop_reason=max_tokens`**: skill throws (W-1 invariant).
- **Proposal comment posted but issue create later fails**: subsequent run re-reads state, sees the proposal already exists (skips proposal), sees no children yet (still APPROVED), retries the create step. Idempotent.
- **Operator adds 👍 to a stale proposal**: Maya proceeds with the proposal text as committed — she does not regenerate. To force regeneration, operator removes the proposal comment (👍 will be lost too).

## Related docs

- [bindings.md](../../docs/runbooks/bindings.md) — binding shape
- [pdm-decompose.md](../../docs/runbooks/pdm-decompose.md) — operator runbook (gate handling, troubleshooting)
- [project-workforce-meta-bootstrap.md](../../docs/runbooks/project-workforce-meta-bootstrap.md) — one-time DDB row for `PROJECT#workforce-meta`
