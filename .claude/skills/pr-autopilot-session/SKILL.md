---
name: pr-autopilot-session
description: >-
  Run the workforce pr-autopilot lane on a refluster/ai-native-article PR from
  this Claude Code session — route, isolated ≥3-persona panel, verdict, fix
  loop, and merge through the fail-closed engine gate — and report one line per
  state change. Use right after a PR is opened (the PostToolUse hook asks for
  it), or when the user says "pr-autopilot を回して", "autopilot this PR",
  "run the panel and merge". Not for PRs in other repos.
---

# pr-autopilot-session

The same lane the workforce cron (`workforce/skills/pr-autopilot`) runs, run
here at once instead of waiting up to 6 h for the tick. Statute:
[ADR-0009](../../../docs/adr/adr-0009-session-run-autopilot-lane.md) and
[governance.md §4.4](../../../docs/governance.md#44-autopilot-pr-merge--workforce-r-n10-delegation--l0l1-off-limits)
— this file cites them, it does not restate the merge rule.

The cron lane treats a PR carrying `**Nadia — cycle N of` as already routed,
so once this skill posts cycle 1 the two lanes never both drive one PR.

**Output to the user: one line per state change** (e.g.
`#912 🟢 panel green (dario, ren, farah) → CI pending`). Reviewer comment
bodies stay on the PR; do not paste them into chat unless asked.

GitHub writes (comments, labels) go through the GitHub MCP tools
(`add_issue_comment`, `issue_write`). The only merge path is step 5's gate;
`merge_pull_request`, auto-merge and `gh pr merge` are denied in
`.claude/settings.json`.

## 0 · Preconditions — stop with one line if any fails

- The PR is open in `refluster/ai-native-article` and has no `autopilot:off` label.
- No routing comment (`— cycle N of ≤ 7`) from another run in the last 7 days.
  If there is one, the PR is already in a lane: report that and stop.

## 1 · Route

- Read the full diff and the changed paths (`pull_request_read`).
- Seat **≥ 3 distinct personas**, one per lens with real surface in the diff —
  the lens → persona map is `.claude/skills/outsource-to-workforce/profiles/pr-autopilot.md`
  (`ren` engineering, `dario` architecture/governance, `farah` QA/SRE,
  `aoi` design). A lens without surface is skipped, not seated for show.
- Compare the paths with the `<!-- autopilot:l0l1-paths -->` block in
  `docs/governance.md` §4.4. An L0/L1 PR is still reviewed but ends at a human (step 5).
- Post the routing comment. First line exactly `**Nadia — cycle 1 of ≤ 7.**`,
  then one paragraph: what the PR does, the panel with a one-line reason each,
  and `_Session-run lane (docs/adr/adr-0009)._`

## 2 · Panel — one isolated subagent per persona, in parallel

Launch one `Agent` (general-purpose) per persona **in the same message**. Each
gets only: the persona's `system_prompt` from
`GET https://workforce-api.kohuehara.xyz/agents/<slug>`, its lens, the PR
number, and the instruction to read the **full diff** itself and return
`{verdict: green|red, findings: [{severity: blocking|non-blocking, file, line, text}]}`
— green iff no blocking finding. Never give a reviewer another reviewer's output
or your own opinion: lenses that share a context converge.

Post each review as its own comment. First line
`🟢 **<slug> — <lens> lens, cycle N.**` (or 🔴), findings as `file:line`
bullets, and — **only when green** — the marker
`<!-- autopilot:review:<slug>:green -->`. The engine counts exactly these markers.

## 3 · Verdict

One comment: first line `**Nadia — verdict, cycle N of ≤ 7. 🟢 unanimous-green.**`
(or `🔴 <short reason>`), one short paragraph, and `<!-- autopilot:panel:isolated -->`.
Non-blocking findings on a green panel do not hold the merge — file them as one
follow-up issue linked from the verdict.

## 4 · 🔴 → fix loop (you are the author)

Fix the blocking findings on the PR branch, push, and re-run steps 1–3 as cycle
N+1 (`**Nadia — cycle N+1 of ≤ 7.**`). After cycle 7, label
`autopilot:needs-human` + `autopilot:reason:no-reviewer-consensus` and stop.

## 5 · Merge — only through the gate

- **L0/L1 PR** → label `autopilot:needs-human` + `autopilot:reason:l0l1-path`,
  report one line, stop. The operator merges.
- **Otherwise** wait for CI with the `ship-pr` loop (it also flips a draft to
  Ready), then:

  ```bash
  node scripts/claude/autopilot-merge.mjs <PR> --reviewers <slug1>,<slug2>,<slug3>
  ```

  The gate fetches the workforce PAT from Secrets Manager and runs
  `pr-merge.mjs` from `origin/main`, which re-verifies §4.4 against the live PR
  and refuses fail-closed. `--dry-run` checks eligibility without writing.
- Exit 2 (refused): if the reason is transient (`mergeable=null`, checks
  pending), wait and retry once; otherwise report the refusal line and stop —
  the engine has already stamped the reason label.
- Exit 1 (setup): report the `✋ gate:` line. Do not look for another way to merge.

## 6 · Report

One final line: PR number, terminal state (merged / needs-human), panel, and
the gate's line if it ran.
