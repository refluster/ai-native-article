# `workforce-builder` routine prompt (stable contract)

This file is the prompt the daily Claude Routine uses. Treat it as a config file — change it only when changing the routine's contract, not when working on a specific PR.

The routine fires at **09:00 JST** every day (`0 9 * * *` in local cron). It clones a fresh worktree of `main`, runs this prompt, and exits. Agents never self-merge (governance C-3) — the routine opens PRs and waits for the human.

---

## Prompt

```
You are continuing the AI Agent Workforce build per
/Users/koh.uehara/.claude/plans/ai-linkedin-ui-db-zany-pixel.md.

CONTEXT
- This is the daily 09:00 JST routine. One PR per day, sized to fit.
- Read workforce/ROADMAP.md top to bottom. Find the first un-checked PR.
- Read workforce/README.md for orientation if anything's unclear.
- Skill schemas live in workforce/skills/*/SKILL.md (openclaw shape).
- Agent schemas live in workforce/agents/{slug}/agent.json (Claude Managed
  Agents shape). Both formats are designed to be `cp -r`-portable later.

EXECUTION
1. Check the state of the previous PR via `gh pr list --state open --search "workforce" --json number,title,headRefName,statusCheckRollup`.
   a. If the previous PR is open AND CI is green → STOP. Leave a one-line
      "still waiting on human merge" comment on the PR and exit.
   b. If the previous PR is open AND CI is failing → use the `ship-pr` skill's
      failure-class playbook to classify and fix. Max 3 fix turns. If still
      failing, leave a comment with the classification and exit.
   c. If the previous PR is merged → proceed to step 2.

2. Implement the next un-checked PR per workforce/ROADMAP.md.
   - Touch only files in scope for that PR. If you find yourself wanting to
     edit something outside the PR's scope, write a TODO in ROADMAP.md and
     stop touching it. Cross-zone PRs are forbidden (AGENTS.md §4 rule 108).
   - Honor AGENTS.md zones:
     • Zone A (DESIGN.md, GROWTH.md, tailwind.config.ts, src/config/site.ts,
       src/index.css, .github/, CODEOWNERS, generator prompts, judge rubric,
       MODEL_REGISTRY) → flag in PR description, do NOT merge.
     • workforce/agents/**/*.{json,md} and workforce/skills/** → Rule 11
       binding (one prompt-version bump per PR). v0 bulk loads are exempt
       (see ROADMAP PR3a note).
   - Update ROADMAP.md checkboxes for the items you just shipped.

3. Open the PR using the `ship-pr` skill. The skill handles:
   - `gh pr create` with a body that names the metric or scope,
   - watching `ci.yml` checks to completion,
   - classifying typecheck / token-lint / build failures and fixing.

4. After CI passes, leave the PR open and await human merge.
   NEVER run `gh pr merge` on your own work. C-3 is absolute.

CONSTRAINTS
- One in_progress todo at a time (TodoWrite).
- Don't sleep-poll CI — use `ship-pr` or `gh run watch`.
- If a smoke test in ROADMAP.md needs real AWS access and credentials are
  missing in this routine context, mark the smoke as "deferred to operator"
  in the PR description and proceed.
- Skip if you can't safely do the work: a partial PR is worse than no PR.

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
