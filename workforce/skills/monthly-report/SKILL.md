---
name: monthly-report
description: "Monthly Software Talent Network report: on the first days of each month, the bound persona (Maya) reviews the past month across the whole workforce and writes one integrated why-first letter (~15-20 pages) FOR A GENERAL AUDIENCE - executives, designers, legal, HR, engineers, marketers who are curious about AI but know nothing of this org's internals - covering what the org is trying to prove (MVV level), how far delegation to agents has climbed, where humans remain, quality culture, external voice, the macro theses distilled from the article corpus, and the open hypotheses for the next month. Consults the domain-owner personas per section, visualizes quantitative claims as inline mermaid figures, and publishes to the Notion unified Articles DB tagged Monthly Report."
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
2. **The why.** Re-read `workforce/docs/mvv.md` (the north-star corpus). The
   letter is an instalment in the org's standing question — "can an
   organisation work when humans design and govern the institution while AI
   agents execute, learn, and compound?" — and every section must connect back
   to it.
3. **The live org.** `GET {agents-api}/agents` — roster, roles, models,
   bindings (who runs which routine on what schedule); `GET /performance`
   (lifecycle funnel, PR counts, autonomous-merge share); `GET /skills`
   (the skill catalog and versions); `GET /feed` (recent persona reflections).
4. **The month in the repo.** `git log --since=<window> --oneline --no-merges`,
   categorized into: org/hires, platform/orchestration, quality/guards,
   articles/newsletter, podcast/media, governance decisions. New decision
   records under `workforce/docs/adr/` + root `docs/adr/`; epic status flips;
   hire rounds under `workforce/docs/hires/`; the incident/risk registries
   (`docs/memory-lint-backlog.md`, `docs/risk-acceptance-ledger.md`); open
   items in `workforce/docs/follow-ups.md`.
5. **The month's published corpus.** Query the unified Articles DB for pages
   dated in the window (title, Type, Tags, Author). The analysis titles read in
   sequence are the corpus's intellectual through-line — extract the macro
   industry/financial theses the org converged on this month, plus exact tag
   frequencies and type counts for the figures.

## Do the one thing this Cadence does

Write **one integrated monthly letter, in Japanese, in your own voice** (the
bound persona's stance from `system.md`: hypothesis-first, direct,
org-design-minded), titled `# Software Talent Network 月次レポート YYYY年M月`
(the H1 becomes the page title). Sign with the persona's name and their
**current title as recorded on the live agent roster** (`GET /agents/{slug}`
`role` field — e.g. Maya is President) — never a title remembered from an
older prompt or issue.

**Audience — the binding constraint.** Write for general readers: executives,
designers, legal, HR, engineers, marketers who are interested in AI but know
NOTHING of this org's internals or GitHub workflows. Concretely:

- **No internal proper nouns or codes.** Never mention repository names, DB
  names, script/file names, rule codes (W-1, R-13, L0/L1, ADR numbers), API
  names, or skill slugs. Translate every one into plain language: "カデンツ"
  → 定期ルーティン; "ADR" → 意思決定の記録; "W-1ガード" → 公開前の自動品質検査;
  "feed-post" → 社内SNSへの日報; "L0/L1に触れないPR" → 組織の憲法に触れない
  変更提案; "agents-api" → エージェント管理の仕組み. Widely-known external
  terms (GitHub Pull Request, CI, Spotify, Notion as a product) are fine when
  briefly glossed.
- **Business-meaningful numbers.** Prefer "エージェントが執筆した90本の記事を
  一般公開" over internal DB phrasing; give活動回数・成果物数・費用 in terms a
  manager can reuse in their own meeting.
- **Why before what.** Open every chapter at the meaning level: what question
  about human-agent organisations this month's events answer or sharpen.
  Facts serve as evidence, never as the point. Ground the "why" in the MVV.
  This is a writing principle, not text — don't pad the letter with parables
  or metaphor set-pieces; state the question plainly and let the evidence
  carry it.
- **Prose, not bullets.** This is an essay-letter. Bullets only where a true
  enumeration reads better; never as the default texture.

**Shape.** Choose chapter titles that would pull in a general reader (don't
inherit section names from any earlier issue). A frame that works — adapt, do
not copy blindly:

1. What we are trying to prove (the standing question, MVV level, LLM-persona
   disclosure up front).
2. The delegation ladder — how far "leaving it to agents" climbed this month
   (routine observation → judged publication → autonomous confirmation), with
   named agents and honest failures (e.g. hires still without real work).
3. The organisation as a running program — roles/authority/procedures as
   executable, hiring as writing a document, the economics (monthly cost for
   the whole workforce).
4. Where humans remain — the constitutional layer; fewer touches, each
   carrying more leverage; incidents turned into permanent mechanisms.
5. The external voice — articles, podcast, and what changed editorially;
   include unflattering truths (e.g. published but not yet heard).
6. What the corpus says about the world — the month's macro theses in plain
   language, and the recursion (this org lives the theses it reports).
7. The frontier hypotheses — NOT a todo list. Ambitious open questions about
   how many agents can work, whether human-agent co-prosperity is measurable,
   what a co-growth mechanism looks like, what carries over from human-only
   society and what must be invented — each phrased as a testable hypothesis
   with what next month would count as evidence. Management perspective as
   much as technical. City-building on unbroken ground: expect failures and
   discoveries, and say so.

**Figures.** Visualize the load-bearing quantitative claims as inline mermaid
blocks per `newsletter/docs/ARTICLE-FIGURES.md` — the site renders them as
figures. Aim for 4–8: budget/cap trajectory, roster growth, output mix or tag
frequencies, delivery curve, autonomy share, a pipeline/relay diagram. Rules
that bite: `xychart-beta` is ONE series per chart (bar+line overlay of the
same data is OK), non-ASCII axis labels must be quoted, every chart carries a
`title`; `pie` needs `showData` and at most 5 slices; never specify colors.
The write path stores each fence as a Notion code block (language `mermaid`).

**Consult before you synthesize.** For each domain section, engage the
domain-owner persona and let their view (and their voice, quoted sparingly,
translated to general language) into the letter — at minimum: the PM
(per-agent delivery + priorities), the platform VP (orchestration +
human/agent relationship), QA/SRE (guards), the external-comms VP (media),
the finance VP (budget discipline + macro capital reads), and the
article-cadence owner (corpus through-line). In a Claude Code session, run
them as subagents seeded with their live `system_prompt` from
`GET /agents/{slug}` plus the evidence digest; credit them in the letter.

**Hard bounds:** 15,000–35,000 characters of body prose (~15–20 letter
pages). Every claim traceable to the recall packet; every number in a figure
computed from real data, never estimated. No chapter skipped; if a theme had
a quiet month, say so in two sentences rather than padding. Disclose that the
authors are LLM personas, in the opening.

## The skip path — when NOT to write

- A `Monthly Report`-tagged page already exists in the unified DB **dated
  within the current calendar month** → skip (the report is done; a re-fire
  must not produce a duplicate). Skipping = not calling `post.mjs` (W-4).
  (A deliberate operator-requested revision replaces the page: archive the
  old page first, then publish — never leave two current issues.)
- The window contains fewer than 5 merged PRs and no published articles —
  a dormant month produces a short letter next month, not a padded one now.

## Write — run the script, do NOT hand-edit any file

The write is owned by the **deterministic script**; you produce the judgment,
`post.mjs` owns the structurally-exact write to the unified Articles DB
(dedicated series tag `Monthly Report`, `Type=report`, chunked block append —
a long letter exceeds Notion's 100-block request cap and must never be
silently sliced; mermaid fences land as code blocks the reader renders).

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
