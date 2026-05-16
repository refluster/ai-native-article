# `workforce-builder` routine prompt (stable contract)

This file is the prompt the daily Claude Routine uses. Treat it as a config file — change it only when changing the routine's contract, not when working on a specific PR.

The routine fires at **09:00 JST** every day (`7 0 * * *` UTC, i.e. 00:07 UTC / 09:07 JST — minute-7 to dodge the :00 fleet-wide minute). It runs in a fresh cloud CCR session against the `main` branch and exits. Agents never self-merge (governance C-3) — the routine opens PRs and waits for the human.

The cloud session has **no access to local user paths** (no `~/.claude/plans/`, no `~/.claude/skills/`). Everything the routine needs is committed to the repo: this file, `workforce/ROADMAP.md`, `workforce/README.md`, and `AGENTS.md` for governance rules.

---

## Prompt

```
You are continuing the AI Agent Workforce build.

CONTEXT (all authoritative, all in the repo — no local paths)
- This is the daily 09:00 JST routine. One PR per day, sized to fit.
- Read workforce/README.md for the system overview.
- Read workforce/ROADMAP.md top to bottom. Find the first un-checked PR.
- Read AGENTS.md for zone rules — Zone A files require human review,
  Zone B can be agent-merged subject to CI + review, Zone B with Rule 11
  applies to workforce/agents/** and workforce/skills/**.
- Skill schemas: workforce/skills/*/SKILL.md (openclaw shape).
- Agent schemas: workforce/agents/{slug}/agent.json (Claude Managed Agents shape).
  Both formats are designed to be `cp -r`-portable to Managed Agents later.

EXECUTION
1. Check the state of the most recent workforce PR:
     gh pr list --state open --search "workforce in:title" \
       --json number,title,headRefName,statusCheckRollup
   a. If the previous PR is open AND CI is green → STOP. Leave a one-line
      "Still waiting on human merge — daily routine no-op." comment on the
      PR via `gh pr comment {n} --body "..."` and exit.
   b. If the previous PR is open AND CI is failing →
      - Pull the failure log: `gh run view {run_id} --log-failed`
      - Classify the failure (typecheck / build / token-lint / check-gas /
        permission / hook-bypass / test).
      - Apply a targeted fix (max 3 fix turns). Push.
      - Re-watch: `gh pr checks {n} --watch`
      - If still failing after 3 turns, leave a comment with the
        classification + diagnosis and exit.
   c. If the previous PR is merged → proceed to step 2.

2. Implement the next un-checked PR per workforce/ROADMAP.md.
   - Branch from latest main: `git checkout -b claude/workforce-pr-{N}-{slug}` off main.
     (Cloud routines can only push to `claude/`-prefixed branches by default —
     keeping this prefix avoids needing "Allow unrestricted branch pushes".)
   - Touch only files in scope for that PR. If you find yourself wanting to
     edit something outside the PR's scope, write a TODO in ROADMAP.md and
     stop touching it. Cross-zone PRs are forbidden (AGENTS.md §4).
   - Honor AGENTS.md zones:
     • Zone A (DESIGN.md, GROWTH.md, tailwind.config.ts, src/config/site.ts,
       src/index.css, .github/**, CODEOWNERS, generator prompts, judge rubric,
       MODEL_REGISTRY) → flag in PR description, do NOT merge.
     • workforce/agents/**/*.{json,md} and workforce/skills/** → Rule 11
       binding (one prompt-version bump per PR). v0 bulk loads are exempt
       (see ROADMAP PR3a note).
   - Update ROADMAP.md checkboxes for the items you just shipped.
   - Verify locally before push:
       npm run build && npm run lint:tokens && npm run check-gas
     If any of these fail, fix before pushing.

3. Open the PR:
     gh pr create --title "{prefix}(workforce): {scope} (PR{N}/6)" \
       --body-file <a file you write summarising the change, with a
                    "Test plan" section and the
                    "🤖 Generated with Claude Code" footer>
   Then watch CI to completion:
     gh pr checks {pr_number} --watch
   If failures arise, apply the same classify-fix loop as in step 1b.

4. After CI passes, leave the PR open and await human merge.
   NEVER run `gh pr merge` on your own work. C-3 is absolute.

CONSTRAINTS
- One in_progress todo at a time (TodoWrite).
- Don't sleep-poll CI — use `gh pr checks --watch` or `gh run watch`.
- If a smoke test in ROADMAP.md needs real AWS access and credentials are
  missing in this routine context, mark the smoke as "deferred to operator"
  in the PR description and proceed.
- Skip if you can't safely do the work: a partial PR is worse than no PR.
- Do not skip pre-commit/pre-push hooks via --no-verify (governance C-2 in
  ~/.claude/CLAUDE.md; equivalent rule applies in this project).

OUTPUT
- The session result is the PR URL (or a one-line "no-op, waiting on PR #N").
- That URL gets surfaced in the routine result chip.
```

---

## When to update this prompt

Update only when:

- The PR sequence in `ROADMAP.md` changes meaningfully (e.g. a new PR4.5 inserted).
- A new governance rule lands that the routine must honor.
- The `ship-pr` skill's interface changes.

Do **not** update this prompt when working on the day's PR — that's prompt drift inside an in-flight change, and it breaks attribution per AGENTS.md §2 rule 11.
