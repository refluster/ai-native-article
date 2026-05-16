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

   PRE-PUSH VERIFICATION (run ALL that apply; do NOT push if any fails):
   - Always:
       npm run build && npm run lint:tokens && npm run check-gas
   - If the diff touched workforce/lambdas/**:
       cd workforce/lambdas && npm ci && npm run typecheck
   - If the diff touched workforce/infra/sam/template.yaml:
       cd workforce/infra/sam && sam validate --lint
     If `sam` is not in PATH, install it: `pip install aws-sam-cli` (or
     `pip install cfn-lint` for a faster subset). Without this gate the
     same CFN-lint errors will fail in CI and waste a push cycle.
   - If the diff touched workforce/agents/**/agent.json or workforce/skills/**:
       (PR3 onward) run the JSON Schema validator added in PR3a/b.

3. Open the PR:
     gh pr create --title "{prefix}(workforce): {scope} (PR{N}/6)" \
       --body-file <a file you write summarising the change, with a
                    "Test plan" section and the
                    "🤖 Generated with Claude Code" footer>

   THEN WATCH CI UNTIL ALL CHECKS COMPLETE (not just the first one):
     gh pr checks {pr_number} --watch
   This blocks until every check on the PR is in a terminal state. The
   `--watch` exits with status 8 if any check FAILED. Treat any non-zero
   exit as a failure to fix; do NOT exit the session on success of one
   workflow if another is still pending.

   This repo has TWO workflows on most PRs:
     • CI (ci.yml) — npm build + token-lint + check-gas, ~20s
     • Workforce SAM Deploy (workforce-deploy.yml) — typecheck + sam
       validate --lint + sam build + dry-run, ~30–90s
   Both must pass.

4. If CI fails, apply the classify-fix loop from step 1b. Common classes:
   - `sam validate --lint` W3011 — DynamoDB/S3 with DeletionPolicy needs
     matching `UpdateReplacePolicy: Retain` on the same resource.
   - `sam validate --lint` W2531 — deprecated Lambda runtime; bump to the
     current LTS (`nodejs22.x` as of 2026-05; check
     https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html).
   - `sam validate --lint` E3001/E3002 — required property missing or
     wrong type; read the error, fix, re-run `sam validate --lint`.
   - `aws-actions/configure-aws-credentials@v4` AccessDenied — OIDC role
     trust condition doesn't match the branch/event. If the trust is
     pinned to `ref:refs/heads/main`, PR-stage validate from a `claude/`
     branch will be denied; broaden trust to `repo:refluster/...:*` or
     scope per-event.
   - Typecheck — read the tsc error, fix at the source, do NOT add
     `@ts-ignore` or `any` to silence it.
   - Token-lint — only fires on `src/**`. If you touched src/, no raw
     hex (use tailwind tokens), no `rounded-md|lg|xl|2xl|3xl` (system
     is 0-radius). See `scripts/lint-design-tokens.mjs`.

5. After ALL CI checks pass, leave the PR open and await human merge.
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
- A green `ci.yml` check does NOT mean the routine is done. Wait until
  every workflow on the PR is in a terminal state before concluding.
- If you run out of session budget before CI completes, post a status
  comment with `gh pr comment {n} --body "Routine session ran out
  mid-watch at $(date -u). Next routine fire will re-check and continue."`
  and exit cleanly. The next fire will pick up via step 1b.

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
