# `workforce-builder` — CCR routine for ROADMAP-driven PR delivery

**Kind**: scheduled CCR routine (successor to the retired 2026-07-05 GHA-based `wf-builder`).
**Trigger**: daily schedule via claude.ai/code/routines.
**Purpose**: keep the workforce ROADMAP moving — one PR per run, CI green before push, never self-merge.

> **Authoritative contract.** The full execution logic lives here. The claude.ai routine prompt is a one-line pointer to this file; do not embed logic there.

## Context

`workforce/ROADMAP.md` is the single, ordered list of implementation milestones for the workforce subsystem. Items are picked up one PR at a time. Humans merge; this routine authors.

The routine was originally implemented as a GHA running on `claude-code-action@beta`. That version was retired 2026-07-05 (the secret was unset, every run failed silently). This CCR version supersedes it.

## EXECUTION — state machine

Run exactly once per firing. Read the repo. Determine state. Take exactly one action. Exit.

### Step 1 — Identify the "previous workforce PR"

The previous PR is the most recent PR opened **from a `claude/` branch by a prior run of this routine**. A PR opened by the human operator, or by another CCR routine (Nadia's backlog-reconcile, Ren's engineer routine, etc.), does NOT count.

To find it: call `list_pull_requests(state=open)`, filter to PRs whose head branch matches `claude/*` and was opened in a prior session of this routine. If no such PR exists (first run or all prior PRs merged), go to **state C**.

### Step 2 — Choose the action

| Condition | Action |
|---|---|
| **(A) Previous PR open, CI green** | Post one-line comment: `no-op — PR #N still open, awaiting human merge`. Exit. |
| **(B) Previous PR open, CI failing** | Classify the failure. Fix it in up to 3 turns. Push the fix to the same branch. Exit. |
| **(C) No previous PR, or previous PR is merged** | Implement the next unchecked PR from ROADMAP.md. See §"Implementing a ROADMAP item" below. |

CI status is the `get_check_runs` result on the PR's head commit. A single `success` conclusion = green.

### Step 3 — Exit

After taking the action, output exactly one line:
- State A/B: `` no-op — PR #N still open, awaiting human merge ``
- State C (PR opened): the new PR URL

---

## Implementing a ROADMAP item

### Pick the next item

Scan `workforce/ROADMAP.md` top-to-bottom. The "next item" is the first `[ ]` entry that:

1. Has an associated PR (not marked "no PR" / "operator action").
2. Does not have an open PR already in flight.
3. Falls within Zone B authority (or is a Rule-11 "first version" Zone A item) per [workforce/docs/governance.md §3](../governance.md#3-zone-classifications-for-workforce).

Skip operator-only items and items requiring explicit operator approval (Zone A governance amendments, SAM template scheduling changes).

### Build

Before pushing:

```bash
npm run build          # both article + workforce SPAs
npm run lint:tokens    # design-token lint
```

Both must exit 0. If they fail, fix the underlying issue rather than skipping the check.

### Branch + PR

```bash
git checkout -b claude/<slug>-<date>
git push -u origin <branch>
```

Open a **draft** PR immediately after push. PR body must:
- Cite the ROADMAP item being implemented (phase + name).
- Cite the Zone classification of every changed path.
- Include an `## L1 citation` block per the R-11 gate, or `RULE-N/A: <reason>`.

Never force-push, never `--no-verify`, never `--no-gpg-sign`.

### Do NOT

- Run `gh pr merge` (or any equivalent) on your own work.
- Push to `main` directly.
- Touch `.github/workflows/*.yml` files (Zone A — flag to operator instead).
- Edit `workforce/docs/governance.md` §2 (L0 invariants) or any Zone A document without a prior operator approval signal in the PR description.

---

## Operator instantiation (one-time, claude.ai/code/routines)

The prompt stored at claude.ai is **deliberately minimal** — a pointer to this file:

```
You are the daily workforce-builder CCR routine. On each firing:
1. Clone refluster/ai-native-article (provided as the routine's repo).
2. Read workforce/docs/routines/workforce-builder.md (this file).
3. Follow the EXECUTION section exactly.

Do not improvise; the markdown owns the contract.
```

**Settings**:
- **Name**: `wf-workforce-builder`
- **Trigger**: schedule — daily (e.g. `09:00 UTC`).
- **Repository**: `refluster/ai-native-article`. Branch: `main`.
- **Network**: Trusted (needs GitHub MCP + npm install).
- **Permissions**: Branch-push prefix `claude/`; no unrestricted push.
- **Connectors**: GitHub MCP only.

No AWS credentials needed — this routine touches only git and GitHub.

## Related

- [`workforce/ROADMAP.md`](../../ROADMAP.md) — the milestone list this routine advances.
- [`workforce/docs/routines/agent-runner.md`](agent-runner.md) — the peer CCR routine for agent skill execution.
- [`workforce/docs/governance.md`](../governance.md) — zone classifications and authority matrix.
