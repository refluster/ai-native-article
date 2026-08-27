---
name: regulatory-situation-report
description: Periodic cross-desk regulatory situation report for an industry-executive audience. The bound VP persona harvests the FULL observation corpus of the configured research desks over the reporting window, runs a fixed quantitative scan, reads the recent corpus in full, extracts only cross-desk patterns (a finding must appear independently on 3+ desks), resolves a numbered source per load-bearing fact with primary/secondary marked, hunts the corpus for its own counter-evidence, then writes a Japanese markdown report whose every section carries an explicit 産業への含意 block, and publishes it to the project repo's reports/ directory via the GitHub contents API using the project-scoped github.token. Fires per binding cron; skips when a report already exists for the current window or the corpus harvest fails its completeness check.
---

# regulatory-situation-report

> **This is a Cadence skill** (固有名詞: see `.claude/skills/cadence-forge/references/cadence-archetype.md`).
> It is fired by EventBridge → `wf-orchestrator-tick` → the generic `agent-runner`
> CCR routine, which composes your runtime prompt from (persona `system.md` ×
> this `SKILL.md` × binding `config` × project credentials). The LLM owns the
> judgment; the bundled `publish-report.mjs` owns the write. No PR, no AWS access
> in-session — just the one project-scoped capability credential
> (`github.token`) injected into your task.

You are the **editor of this window's cross-desk regulatory situation report**.

**Precedent.** This Cadence standardises the 2026-08-27 operator session that
produced the first such report (米国・インド・EU の電力／エネルギー規制、2026年6〜8月)
from 2,225 observations across 14 analysts. That session's three rounds of
operator review are encoded below as the **§7 review rubric**; every one of them
caught a defect the author could not see alone. The rubric is the load-bearing
part of this skill — the harvest and the prose are mechanics.

**Sibling skills, and the boundary.** `weekly-project-report` reports on ONE
project's repo state to a sponsor. This skill reports on the **external
regulatory frontier** across MANY desks to an **industry executive** who is not
a policy specialist. Do not restate a single desk's beat — that is already on
the feed. Your deliverable is the pattern no single desk can see.

## Read this first (the recall packet)

Assemble read-only context before you act. All reads are public endpoints or
anonymous fetches — never AWS, never a write.

1. **Binding config** — `config.desk_slugs` (required, the agent slugs whose
   corpus you harvest), `config.window_days` (default 90), `config.report_lang`
   (default `ja`), `config.audience` (default `industry-executive`),
   `config.min_sources` (default 40), `config.min_cross_desk` (default 3).
2. **Project record** — `GET {agents-api}/projects/{project_id}` →
   `github_owner`, `github_repo`. That repo is your publish target.
3. **Prior reports** — fetch `reports/manifest.json` from the repo's default
   branch (contents API with the injected token). Rows with
   `kind: "situation"` are your baseline: this report is a **delta** against
   the most recent one, not a re-telling.
4. **Your own last 10 posts and 5 EXEC rows** for run continuity.

## Do the one thing this Cadence does — the eight phases

Run these **in order**. The ordering is not cosmetic: phase 3 (quantitative)
before phase 4 (reading) is what surfaces non-events; phase 5 (sources) before
phase 6 (writing) is what stops uncited prose from being written in the first
place.

### Phase 1 — Harvest the FULL corpus, and prove it

For every slug in `config.desk_slugs`:
`GET {agents-api}/agents/{slug}/posts?limit=100`, then follow the response's
**`cursor`** field (NOT `next_cursor` — that key does not exist on this route)
until it is absent. Also pull `GET /agents/{slug}/executions?limit=100` (this
route caps at 100 and returns no cursor; treat it as a sample, not a census).

**Completeness check — mandatory, and a hard skip if it fails.** Report, per
desk: post count, earliest `posted_at`, latest `posted_at`. If any desk returns
exactly 25 posts you have hit the default page size and your paging is broken —
**stop and skip this fire** with that reason in your EXEC summary. (This is the
real defect from the precedent session: the first harvest silently returned 350
of 2,225 posts because the cursor key was guessed.)

### Phase 2 — Scope the window

Filter to `config.window_days` back from the fire date. State the resulting
count and span in the report's masthead. Every day-count you later publish
(「N 日超過」) is computed against the **fire date**, and the report must say so.

### Phase 3 — The quantitative scan (fixed set, before you read anything)

Compute all of these. They are cheap and they surface findings that reading
never does:

| # | Metric | What it surfaces |
| --- | --- | --- |
| Q1 | posts per desk; span per desk | coverage gaps, a desk that went quiet |
| Q2 | posts per weekday; per UTC hour | continuity claims (do NOT publish without this) |
| Q3 | URL extraction → domain histogram; count of government/regulator domains | the primary/secondary ratio you must disclose in §8 |
| Q4 | instrument-ID extraction (docket/gazette/regulation numbers) → distinct IDs, and **distinct days each ID was revisited** | the longitudinal tracking evidence; the top IDs are your lead candidates |
| Q5 | cross-desk named references (desk A naming desk B's persona) | which findings already have two independent readers |
| Q6 | self-correction phrases (「I was wrong」「correcting」「walk back」「kill-criterion」…) | where the corpus already disagrees with itself — phase 6 depends on this |
| Q7 | execution status mix and duration median/p90 | the §7 method disclosure |
| Q8 | **date-bearing claims whose stated date has passed** — scan for 「effective from」「deadline」「due」「comes into force」 plus a date in the past | the non-event class: the precedent report's entire lead finding |

Q8 is the one most likely to produce the report's headline. It has no
equivalent in any single desk's daily output because **nothing happening is not
an event any desk posts about**.

### Phase 4 — Read the recent corpus in full

Read the **full body** of each desk's most recent 12–20 posts. Do not skim, do
not rely on the phase-3 aggregates. Themes live in the prose; numbers do not
carry them. Budget this as the largest phase.

### Phase 5 — Extract cross-desk patterns only

A candidate finding is admissible only if it appears **independently on
`config.min_cross_desk` or more desks** (default 3). A pattern seen once is a
desk's beat, not a situation. State, for each finding you keep, which desks
carried it.

Reject: a finding that is one desk's post reworded; a finding whose only
support is the aggregate you computed yourself; a trend claim with no
instrument behind it.

### Phase 6 — Resolve sources, then hunt your own counter-evidence

For **every load-bearing fact** you intend to publish:

1. Locate the originating post (regex over the corpus for the instrument ID or
   distinctive figure).
2. Extract the source URL(s) from that post body.
3. Record: **発行者 / 文書名 / 日付 / 一次・二次の別 / URL**, plus a **注記**
   whenever the desk itself flagged a limitation (a 403 on the primary host,
   a report read only via trade press, a figure the desk could not verify).
4. **Hunt the corpus for the counter-case.** Search for the same instrument or
   figure elsewhere in the window, especially in phase-3 Q6's self-correction
   hits. If a desk later corrected, reframed, or disconfirmed the claim, the
   correction is the finding — publish it, not the original.

Step 4 is not optional. In the precedent session it changed the report's read
of India's DISCOM finances entirely: a headline profit figure had been
re-priced as subsidy-propped by a later post that the first pass missed.

Source resolution is a **second reading**, not clerical work. Expect it to
produce new findings; leave room in the schedule for that.

### Phase 7 — Write, then self-review against the rubric

Write the report in `config.report_lang`, body **6,000–20,000 characters**
(excluding fences). Structure:

1. **表紙** — 一行の主題（情勢そのもの、体制の話ではない）、観測期間、基準日、対象デスク、出典方針。
2. **要旨** — 3〜6 の発見。各発見に **産業への含意** ブロックを必ず 1 つ。
3. **地域・領域別の章** — 発見を支える instrument を表で。ドケット番号は文の主語ではなく、事業影響が主語。
4. **横断章** — phase 5 のパターン。どのデスクが独立に持ち込んだかを明記。
5. **方法の開示** — 稼働数値はここに置く。冒頭には置かない。
6. **限界** — 一次／二次の比率、取材をしていないこと、基準日依存、この体制に顧客・売上・導入実績が存在しないこと。
7. **出典一覧** — 通し番号、発行者、文書名、日付、一次／二次、URL、注記。

Then run the **review rubric** on your own draft. Each line is a defect the
precedent session shipped and the operator had to catch:

| # | 観点 | 落ちていたら |
| --- | --- | --- |
| **L1 主語** | 成果物の主語は「情勢」か。体制・稼働量・件数が要旨に出ていないか。 | 稼働自慢の資料になっている。§5 へ移す。 |
| **L2 出典** | 全ファクトに番号付き出典があるか。一次／二次が明示されているか。日付があるか。 | 書き直し。無出典のファクトは削る。 |
| **L3 読者** | 各章に産業への含意があるか。読者は経営者であって政策担当者ではない。 | 含意を書けない章は、その章に情勢としての価値がない。 |
| **L4 接続** | 地域を跨ぐ整合・接続が本文にあるか。並記で終わっていないか。 | phase 5 に戻る。 |
| **L5 用語** | 独自の言い回し（「止まっている」等）に定義があるか。 | 定義するか、平易な語に置換。 |
| **L6 反証** | 主要主張ごとに phase 6-4 を実行したか。 | 実行する。1 件でも未実施なら公開しない。 |
| **L7 基準** | 外部集計値に「どの段階／どの単位／どの基準か」を付したか。 | 付す。段階・単位のすり替えは最も起きやすい誤読。 |

Cite desks by name for load-bearing claims. Note in the 付記 that the desk
personas are LLMs and that the report does not replace operator review.

### Phase 8 — Publish, then hand the contribution rows to the operator

Run the script (below). **Do not** log engagement rows for the desks yourself:
their daily cadence runs already self-record, and a second row double-counts.
If the operator wants contribution credit for this deliverable, that is a
separate `log-workforce-engagements` batch keyed to the report artefact — say
so in your EXEC summary, don't do it here.

## The skip path — when NOT to write

Skipping = not running the script; record the reason in your EXEC summary.

- **Harvest incomplete** — any desk returned exactly the default page size, or
  a desk's fetch errored. Publishing on a truncated corpus is worse than not
  publishing (phase 1).
- **A `kind: "situation"` row already exists in `reports/manifest.json`** whose
  `date` falls inside the current window (double-fire, or a manual report).
- **Fewer than `config.min_cross_desk` desks returned posts in the window**, or
  no candidate finding cleared phase 5. A thin window is honest content; an
  *empty* one is not a report.
- **Fewer than `config.min_sources` resolvable sources.** The report's whole
  claim is that every fact is traceable; below the floor it isn't.

A quiet window with real material is NOT a skip — report the quiet honestly.

## Write — run the script, do NOT hand-edit any file

The write is owned by a **deterministic script**. You produce the judgment;
`publish-report.mjs` owns the structurally-exact write to the GitHub contents
API (report file + manifest row), with the W-1 guard family plus two guards
specific to this skill, enforced independent of your judgment:

- `G1` frontmatter present · `G2` prose length within [6000, 20000]
- `G3` no LLM-failure prelude · `G4` not cut off mid-sentence
- `G5` balanced fences · `G6` slug/date coherence
- **`G7` citation floor** — the body carries at least `--min-sources` distinct
  `[^n]`-style source markers AND a 出典一覧 section. This is L2 with teeth.
- **`G8` implication floor** — the body carries at least `--min-implications`
  「産業への含意」blocks. This is L3 with teeth.

1. Write the full report (frontmatter + body) to a temp file, e.g.
   `/tmp/regulatory-situation-report-body.md` — a file, not a shell arg, so
   multi-line / Unicode prose isn't mangled by quoting.
2. Run (owner/repo come from the project record in your recall packet):

   ```sh
   GITHUB_TOKEN="<credentials['github.token'].token from your task>" \
     node workforce/skills/regulatory-situation-report/publish-report.mjs \
       --agent "<agent_slug>" \
       --owner "<github_owner>" --repo "<github_repo>" \
       --slug "YYYY-MM-DD-situation" \
       --title "<領域> 規制情勢レポート <YYYY-MM> — <一行の主題>" \
       --date "YYYY-MM-DD" \
       --kind situation --lang ja \
       --summary "<manifest用の3〜4文の要約>" \
       --authors "<lead>,<harvested,desk,slugs>" \
       --min-sources 40 --min-implications 5 \
       --body-file /tmp/regulatory-situation-report-body.md \
       --skill-version "0.1.0"
   ```

3. Report the script's exit code:
   - `0` — published (report + manifest row committed). Done.
   - `2` — a guard rejected it (G1–G8, slug exists, or GitHub 4xx). Read
     stderr and fix the body; do not retry blindly.
   - `1` / `3` — bad args / network error.

The credential comes from your task's injected `credentials["github.token"]` —
never read it from anywhere else, never hard-code it.

## When NOT to use this skill

- **A single desk's development** needing unpacking is that desk's own
  `daily-research` fire or a public explainer, not this report.
- **One project's weekly progress** is `weekly-project-report` — that skill
  reports on repo state to a sponsor; this one reports on the external
  regulatory frontier to an industry audience.
- **A marketing or capability narrative about the workforce itself** is Nico's
  positioning lane. This report's §5 discloses method; it never sells it.
