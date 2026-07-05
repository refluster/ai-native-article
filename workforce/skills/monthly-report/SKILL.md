---
name: monthly-report
description: "Monthly Software Talent Network report: on the first days of each month, the bound persona (Maya) reviews the past month across the whole workforce - per-agent capability/autonomy/deliverables, org evolution, orchestration mechanics, human-agent-network relationship, quality guards, external communications (articles/podcast), and the macro industry/financial view distilled from the article corpus - consults the domain-owner personas for each section, synthesizes an integrated letter (about 10 pages) with next-month goals, and publishes it to the Notion unified Articles DB tagged Monthly Report."
---

# monthly-report

> **This is a Cadence skill** (固有名詞: see `.claude/skills/cadence-forge/references/cadence-archetype.md`).
> It is fired by EventBridge → `wf-orchestrator-tick` → the generic `agent-runner`
> CCR routine, which composes your runtime prompt from (persona `system.md` ×
> this `SKILL.md` × binding `config` × project credentials). The LLM owns the
> judgment; the bundled `post.mjs` owns the write. No AWS access in-session —
> just the one project-scoped capability credential (`notion.integration_token`)
> injected into your task.

## Read this first (the recall packet)

Assemble the month's evidence before writing a word. All reads are read-only;
the report window is **the 5th of last month through today** (or since the
previous report's `Date` if one exists).

1. **Dedupe check (also the skip rule input).** Query the unified Articles DB
   (`34fd0f0b-e61e-817a-9f6b-dc65b0d5b4cc`) for pages with Tag `Monthly Report`.
   Note the most recent report's `Date` — it opens this report's window and
   closes the skip rule below.
2. **The live org.** `GET {agents-api}/agents` — roster, roles, models,
   bindings (who runs which cadence on what schedule); `GET /performance`
   (Epic-016: lifecycle funnel, PR counts, autopilot share); `GET /skills`
   (the skill catalog and versions); `GET /feed` (recent persona reflections).
3. **The month in the repo.** `git log --since=<window> --oneline --no-merges`
   on `refluster/ai-native-article`, categorized into: org/hires, platform/
   orchestration, quality/guards, articles/newsletter, podcast/media,
   governance/ADRs. New ADRs under `workforce/docs/adr/` + root `docs/adr/`;
   epic status flips in `workforce/docs/epics/README.md`; hire rounds under
   `workforce/docs/hires/`; `docs/memory-lint-backlog.md` and
   `docs/risk-acceptance-ledger.md` deltas; `workforce/docs/follow-ups.md`
   open OP-items.
4. **The month's published corpus.** Query the unified Articles DB for pages
   dated in the window (title, Type, Tags, Author). The analysis titles read in
   sequence are the corpus's intellectual through-line — extract the macro
   industry/financial theses the org converged on this month.

## Do the one thing this Cadence does

Write **one integrated monthly letter, in Japanese, in your own founder voice**
(Maya's stance from `system.md`: direct, evidence-first, org-design-minded),
titled `# Software Talent Network 月次レポート YYYY年M月` (the H1 becomes the
page title), covering — in order — these eight fixed sections:

1. **個別エージェントの能力・自律性・実施業務と結果** — name names, attach
   numbers; distinguish the autonomy rungs (定型カデンツ / 判断つきカデンツ /
   委任マージ).
2. **エージェント組織の進化** — hires, reporting lines, cap trajectory (W-3),
   what structural precedent this month set.
3. **マルチエージェントオーケストレーションの仕組み** — what changed in the
   execution/config substrate and why it matters.
4. **人間とエージェントネットワークの関係性** — where the human moved: gates,
   digests, draft-only boundaries, escalation conventions.
5. **クオリティマネジメントとガード** — incidents → ratchets, what moved from
   attention to machine guarantee, what risk remains.
6. **対外コミュニケーション** — articles, podcast, taxonomy/reader-UI; the
   editorial org behind the numbers.
7. **記事分析から読むマクロ産業構造・財務のシフト** — the corpus's theses with
   the reporting events behind them, and how they mirror the org's own design.
8. **次の1ヶ月** — the integrated goals derived from 1–7, each with an owner
   and, where honest, a kill criterion.

**Consult before you synthesize.** For each domain section, engage the
domain-owner persona and let their view (and their voice, quoted sparingly)
into the letter — at minimum: the PM (per-agent delivery + priorities), the
platform VP (orchestration + human/agent relationship), QA/SRE (guards), the
external-comms VP (media), the finance VP (budget discipline + macro capital
reads), and the article-cadence owner (corpus through-line). In a Claude Code
session, run them as subagents seeded with their live `system_prompt` from
`GET /agents/{slug}` plus the evidence digest; credit them in the letter.

**Hard bounds:** 8,000–24,000 characters of body prose (~10 letter pages).
Every claim traceable to the recall packet — PR numbers, ADR ids, dates,
counts. No section skipped; if a section had a quiet month, say so in two
sentences rather than padding. Disclose that the authors are LLM personas.

## The skip path — when NOT to write

- A `Monthly Report`-tagged page already exists in the unified DB **dated
  within the current calendar month** → skip (the report is done; a re-fire
  must not produce a duplicate). Skipping = not calling `post.mjs` (W-4).
- The window contains fewer than 5 merged PRs and no published articles —
  a dormant month produces a short letter next month, not a padded one now.

## Write — run the script, do NOT hand-edit any file

The write is owned by the **deterministic script**; you produce the judgment,
`post.mjs` owns the structurally-exact write to the unified Articles DB
(dedicated series tag `Monthly Report`, `Type=report`, chunked block append —
a ~10-page letter exceeds Notion's 100-block request cap and must never be
silently sliced).

1. Write the letter to a temp file (e.g. `/tmp/monthly-report-body.md`) — a
   file, not a shell arg, so multi-line Japanese prose isn't mangled by
   quoting. Write a 2–3 sentence abstract to a second file.
2. Run:

   ```sh
   NOTION_API_KEY="<credentials['notion.integration_token'].apiKey>" \
     node workforce/skills/monthly-report/post.mjs \
       --agent maya \
       --body-file /tmp/monthly-report-body.md \
       --abstract-file /tmp/monthly-report-abstract.txt \
       --tags "Agentic AI"        # optional extra vocabulary tags
   ```

3. Report the exit code: `0` created (all blocks landed); `2` W-1 guard or
   auth rejected — read stderr, fix the body, do not retry blindly; `1`/`3`
   bad args / API error. A `3` after page creation means the page is
   INCOMPLETE — say so and escalate rather than leaving it.

The credential comes from your task's injected
`credentials["notion.integration_token"]` — never read it from anywhere else,
never hard-code it.

## When NOT to use this skill

- A single-topic deep dive or incident writeup → `article-level3` /
  `design-note`; the monthly report is a synthesis, not a container for one
  story.
- Recording who-did-what rows for the ledger → `record-engagement` (the
  report cites the ledger; it doesn't replace it).
- Mid-month status for the operator → the daily `feed-post` reflections
  already carry that; don't fire this off-cycle for a status ping.
