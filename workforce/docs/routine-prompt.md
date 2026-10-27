# workforce-builder — execution contract

> Operational digest of the `workforce-builder` CCR routine's contract, read at the start of
> every firing. **`routines/workforce-builder.md` is the single authoritative contract; on any
> conflict or gap, it wins.** Full specification (context, build steps, branch conventions):
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
- Never push to `main` directly. Never force-push.
- Never use `--no-verify` or `--no-gpg-sign`.
- Never touch `.github/workflows/*.yml` files (Zone A — flag to operator instead).
- Never edit `workforce/docs/governance.md` §2 (L0 invariants) or any Zone A document without a
  prior operator approval signal in the PR description.
- Before pushing: `npm run build && npm run lint:tokens` — both must exit 0.
- Work on a `claude/<slug>-<date>` branch and open a **draft** PR immediately after push.
- The PR body must cite the ROADMAP item (phase + name), the Zone classification of every
  changed path, and an `## L1 citation` block per R-11 (or `RULE-N/A: <reason>`).
- ROADMAP items marked "operator action" or "no PR" are skipped.
