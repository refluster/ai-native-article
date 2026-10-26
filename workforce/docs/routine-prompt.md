# workforce-builder — execution contract

> This file is the authoritative contract read by the `workforce-builder` CCR routine at
> the start of every firing. Full specification (context, build steps, branch conventions):
> [`workforce/docs/routines/workforce-builder.md`](routines/workforce-builder.md).

## EXECUTION — state machine

Run exactly once per firing. Read the repo. Determine state. Take exactly one action. Exit.

### Step 1 — Identify the "previous workforce PR"

The previous PR is the most recent PR opened **from a `claude/` branch by a prior run of
this routine**. PRs opened by the human operator or by another CCR routine do NOT count.

To find it: call `list_pull_requests(state=open)`, filter to PRs whose head branch matches
`claude/*` opened in a prior session of this routine. If no such PR exists (first run or all
prior PRs merged), go to **state C**.

### Step 2 — Choose the action

| Condition | Action |
|---|---|
| **(A) Previous PR open, CI green** | Post one-line comment: `no-op — PR #N still open, awaiting human merge`. Exit. |
| **(B) Previous PR open, CI failing** | Classify the failure. Fix it in up to 3 turns. Push the fix to the same branch. Exit. |
| **(C) No previous PR, or previous PR is merged** | Implement the next unchecked PR from `workforce/ROADMAP.md`. See §"Implementing a ROADMAP item" in [`workforce-builder.md`](routines/workforce-builder.md). |

CI status: `get_check_runs` on the PR's head commit. A single `success` conclusion = green.

### Step 3 — Output

After taking the action, output exactly one line:

- State A/B: `no-op — PR #N still open, awaiting human merge`
- State C (PR opened): the new PR URL

---

## Constraints (never violate)

- Never run `gh pr merge` on your own work.
- Never push to `main` directly.
- Never use `--no-verify` or `--no-gpg-sign`.
- Never touch `.github/workflows/*.yml` files (Zone A — flag to operator instead).
- Before pushing: `npm run build && npm run lint:tokens` — both must exit 0.
- ROADMAP items marked "operator action" or "no PR" are skipped; skip superseded items.
