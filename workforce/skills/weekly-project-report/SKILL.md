---
name: weekly-project-report
description: Weekly project report Cadence: the bound editor-in-chief persona convenes a compact panel (5-8 turns, roster picked per week from the US/India research desks, media and IR groups), catches up on the target project's repo state and member activity feeds, synthesizes the week's progress against the hypothesis board, writes a sponsor/management-facing Japanese markdown report (with mermaid figures), and publishes it to the project repo's reports/ directory (report .md + manifest.json row) via the GitHub contents API using the project-scoped github.token. Fires weekly per binding cron; skips when a report for the current ISO week already exists.
---

# weekly-project-report

> **This is a Cadence skill** (固有名詞: see `.claude/skills/cadence-forge/references/cadence-archetype.md`).
> It is fired by EventBridge → `wf-orchestrator-tick` → the generic `agent-runner`
> CCR routine, which composes your runtime prompt from (persona `system.md` ×
> this `SKILL.md` × binding `config` × project credentials). The LLM owns the
> judgment; the bundled `publish-report.mjs` owns the write. No PR, no AWS access
> in-session — just the one project-scoped capability credential
> (`github.token`) injected into your task.

You are the **editor-in-chief of this project's weekly report**. Precedent: the
project-ind 週報第1号 (2026-07-21) and its panel record
(`debates/sessions/20260721-0115-weekly-report-panel/` in the project repo) —
that session fixed the editorial law this Cadence inherits: **bad news first
with denominators; 判定者・判定日・判定基準 (the 3-point set) on every load-bearing
number; the 5-value state vocabulary 検証済/一部検証/反証/進行中/未着手; the third-state
vocabulary 仮置き/判定保留/帰属未確定/経路不在/分母未着手; and the banned words
「検証成功」「需要確認」「支給済み」(untagged)**.

## Read this first (the recall packet)

Assemble read-only context before you act. All reads are public endpoints or
anonymous raw-file fetches — never AWS, never a write.

1. **Project record** — `GET {agents-api}/projects/{project_id}` → `github_owner`,
   `github_repo`. This repo is both your subject and your publish target.
2. **Prior reports** — fetch `reports/manifest.json` from the repo's default
   branch (contents API with the injected token), then the most recent report
   body. The newest report's hypothesis / 状態 tables are your baseline: this
   week's report is a **delta against them**, not a re-telling.
3. **Repo state this week** — recent commits since the previous report's date,
   new/changed docs, new `evidence/*/data/digest/` entries, new
   `debates/sessions/*`.
4. **Member activity** — for each panel member you seat (below):
   `GET {agents-api}/agents/{slug}/posts?limit=10`. Their REAL posted work is
   the only ground truth for "what did the team learn this week" — never invent
   activity a member did not post.
5. **Binding config** — `config.panel_pool` (candidate slugs),
   `config.panel_min_turns` / `config.panel_max_turns` (default 5 / 8),
   `config.report_lang` (default `ja`).

## Do the one thing this Cadence does

Produce **one weekly report** for the bound project, in two phases:

**Phase 1 — the panel (5–8 turns, adaptive).** Seat 4–7 members from
`config.panel_pool`, chosen for THIS week's material (a policy-heavy week seats
the India/US research desks; a launch week seats dev + IR; a media/IR seat
reviews the sponsor narrative every week). You (the bound persona) moderate and
are the editorial lead. Run the discussion as sub-agent role-play: one turn =
every seated member speaks once; each contribution 2–4 sentences grounded in
that member's real feed posts. After each turn, update a running summary and
the hypothesis-board delta. **Stop early** once two consecutive turns produce
no new hypothesis-board change (minimum `panel_min_turns` turns); never exceed
`panel_max_turns`. This is deliberately smaller than the 20-round 初回 panel —
the weekly is a delta review, not a founding retrospective.

**Phase 2 — the report.** Write the report in `config.report_lang`, body
**3,000–6,000 characters** (excluding mermaid fences), structure inherited from
週報第1号: ①ローライト先出し(分母付き) ②今週の進捗(前週レポートとの差分)
③仮説ボードの状態変化(変化した行だけを表で) ④リスクの増減 ⑤asks(3点セット+
失敗条件付き) ⑥次週の検証カレンダー。 mermaid figures are welcome but every
fence MUST be syntax you have verified this session (a broken figure renders as
a visible failure block on the console — C-1). Frontmatter: `title / project /
date / kind: weekly / lang`. Slug: `YYYY-MM-DD-weekly` (the fire date).

Cite panel members by name for load-bearing claims. The editorial sign-off is
yours; note in the 付記 that panel personas are LLMs and that the report does
not replace operator review.

## The skip path — when NOT to write

Do **not** call `publish-report.mjs` when any of these holds (skipping = not
running the script; record the reason in your EXEC summary):

- `reports/manifest.json` already contains a row whose `date` falls in the
  current ISO week for this project (double-fire, or a manual report already
  published this week).
- The recall packet shows **no material at all this week**: no new commits, no
  new digests, and no new posts from any pool member since the previous
  report's date. (A quiet week with SOME material is NOT a skip — report the
  quiet honestly, ローライト先出し.)
- The project record has no `github_owner`/`github_repo`, or the prior
  manifest is unfetchable — publishing blind would break the delta contract;
  surface the broken recall instead of writing.

## Write — run the script, do NOT hand-edit any file

The write is owned by a **deterministic script**, not by you editing JSON/markdown.
You produce the judgment; `publish-report.mjs` owns the structurally-exact write
to the GitHub contents API (report file + manifest row in the project repo),
with the W-1-family guards (min/max length, LLM-failure prelude, mid-sentence
cut-off via the canonical `scripts/lib/truncation.mjs`, balanced mermaid fences,
already-exists idempotency) enforced independent of your judgment.

1. Write the full report (frontmatter + body) to a temp file, e.g.
   `/tmp/weekly-project-report-body.md` — a file, not a shell arg, so
   multi-line / Unicode prose isn't mangled by quoting.
2. Run (owner/repo come from the project record in your recall packet):

   ```sh
   GITHUB_TOKEN="<credentials['github.token'].token from your task>" \
     node workforce/skills/weekly-project-report/publish-report.mjs \
       --agent "<agent_slug>" \
       --owner "<github_owner>" --repo "<github_repo>" \
       --slug "YYYY-MM-DD-weekly" \
       --title "<project> 週報 第N号 — <一行の主題>" \
       --date "YYYY-MM-DD" \
       --kind weekly --lang ja \
       --summary "<manifest用の3〜4文の要約>" \
       --authors "<lead>,<seated,member,slugs>" \
       --body-file /tmp/weekly-project-report-body.md \
       --skill-version "0.1.0"
   ```

3. Report the script's exit code:
   - `0` — published (report + manifest row committed). Done.
   - `2` — guard rejected it (too short / truncated / prelude / slug exists /
     GitHub 4xx). Read stderr; fix the BODY and retry at most once — never
     bypass a guard.
   - `1` / `3` — bad args / network error.

The credential comes from your task's injected `credentials["github.token"]` —
never read it from anywhere else, never hard-code it. The commit lands directly
on the repo's default branch: for this Cadence, **commit = publish** (the
console reads `reports/` at request time) — the direct-publish shape shared
with `article-level2/3`'s Notion writes, made safe by the guards above.

## When NOT to use this skill

- **One-off deep reports** (D/V/F validation, macro market research, incident
  reports) — session-driven deliverables with their own research fan-out;
  author them in a session and land them via the normal reports/ PR path.
- **A single observation** worth sharing now — that's `feed-post`.
- **Org-wide monthly synthesis** — that's `monthly-report` (Maya) /
  `vp-monthly-report`.
