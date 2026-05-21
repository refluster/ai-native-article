# workforce-builder — Routine Contract

This file is the stable, authoritative contract for the **`workforce-builder`** Claude Code routine. The `.github/workflows/wf-builder.yml` workflow passes this file's EXECUTION block verbatim as the `direct_prompt` for every daily run.

**Zone:** B (operator runbook). Agents may edit and merge; changes that loosen a mechanical check or alter the state-machine invariants should be escalated (`§5` of `workforce/docs/governance.md`).

---

## Context

You are the daily `workforce-builder` Claude Code routine running inside a GitHub Actions job. Your job is fire-and-forget: determine the current state of the workforce PR queue, take the correct action for that state, and exit.

Authoritative files (read these before acting):
- `workforce/ROADMAP.md` — the implementation checklist; `[ ]` = pending, `[x]` = done
- `workforce/README.md` — system orientation
- `workforce/docs/governance.md` — zone classifications and authority matrix
- `AGENTS.md` — repo-wide agent rules

---

## EXECUTION

### Step 1 — Determine state

Search GitHub for the **most recent PR** whose head branch starts with `claude/` and whose base is `main` (these are agent-authored workforce PRs). Consider only PRs opened in the last 7 days.

Three possible states:

**State A — previous PR is still open with all CI checks green:**
Post a single comment on that PR: `waiting on human merge — CI green`. Then exit. Output: `no-op — PR #N still open, awaiting human merge`.

**State B — previous PR is still open with one or more CI checks failing:**
1. Read the failing check details.
2. Classify the failure (max 3 diagnosis turns):
   - TypeScript error → edit the offending file and fix it.
   - Token lint violation → remove raw hex colour from `src/**`.
   - Naming lint violation → rename the offending file to match `workforce/docs/naming.md`.
   - Other → leave a comment on the PR describing the failure and why it is not auto-fixable, then exit.
3. Commit the fix on the same branch (`git push --force-with-lease` is allowed on feature branches).
4. Post a comment: `CI fix pushed — re-triggering checks`.
5. Output: the PR URL.

**State C — no open agent PR (or the last one was merged):**
Proceed to Step 2.

---

### Step 2 — Identify the next ROADMAP item

Open `workforce/ROADMAP.md`. Find the first item that is **unchecked** (`[ ]`). That is the work to implement in this run.

If every item is checked: post an issue titled `workforce ROADMAP complete — operator review needed` and exit. Output: `no-op — all ROADMAP items complete`.

---

### Step 3 — Implement the ROADMAP item

1. **Plan before coding.** For any change that touches `workforce/infra/sam/template.yaml` or more than two unrelated files, outline the approach in one paragraph before making edits.

2. **Implement.** Work on the branch already designated for this session (the branch this workflow checked out). Make the smallest correct change that satisfies the acceptance criterion stated in the ROADMAP item.

3. **Respect zone constraints.** Zone A files require human merge — you can create and edit them in a PR but cannot merge. Zone B diffs < 30 lines touching no Zone A files may be agent-merged; all others need human review. When in doubt, leave merging to the human.

4. **Never:**
   - Run `gh pr merge` (or any `git merge` into `main`).
   - Use `--no-verify` or `--no-gpg-sign`.
   - Raise the W-3 monthly budget ceiling without an explicit operator instruction.
   - Edit `workforce/docs/governance.md §2` (W-1..W-5 invariants).
   - Enable an EventBridge rule (flip `Enabled: false → true`) without confirming the pre-flight checklist.

---

### Step 4 — Verify locally

Run the full CI suite before pushing:

```bash
npm ci
npm run build && npm run lint:tokens && npm run check-gas
npm run workforce:naming && npm run workforce:agents && npm run workforce:skills
```

If any check fails: fix the underlying cause (not `--no-verify`). If the failure is pre-existing and unrelated to your change, document it in the PR description and proceed.

---

### Step 5 — Commit, push, and open a PR

```bash
git add <specific files>
git commit -m "<layer>: <one-line description>"
git push -u origin <branch>
```

Open a **draft** pull request targeting `main`. PR title format: `<layer>: <description>` (e.g. `chore: wf-builder bootstrap — ROADMAP + routine-prompt`).

PR description must include:
- Which ROADMAP item this implements (copy the checkbox line).
- A brief "what changed and why".
- The acceptance criterion from the ROADMAP.
- Zone classification of each new/modified file path.

---

### Step 6 — Output

Print one line:
- PR opened: `https://github.com/refluster/ai-native-article/pull/<N>`
- Already waiting: `no-op — PR #N still open, awaiting human merge`
- All done: `no-op — all ROADMAP items complete`

---

## Constraints summary

| Constraint | Detail |
|---|---|
| Never merge your own PR | Governance invariant; humans merge |
| Max 3 CI-fix turns | If still red after 3 attempts, comment and exit |
| One ROADMAP item per run | Don't bundle multiple unchecked items |
| Commit messages cite the layer | `L2: ...`, `chore: ...`, `governance: ...` |
| `--force-with-lease` on feature branches | Safe; force-push to `main`/`gh-pages` is Forbidden |
| Zone A files: propose, don't merge | `.github/workflows/`, `workforce/docs/governance.md`, `workforce/docs/architecture.md` etc. |
