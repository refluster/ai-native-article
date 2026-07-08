---
name: vp-monthly-report
description: "Monthly VP letter for the Software Talent Network: early each month, the bound persona (a VP) reviews the past month through their FUNCTIONAL LENS and writes one why-first letter (~5-8 pages, Japanese, general audience) as the leader of that function across the whole network — not a work log of their direct reports. Per the org's decentralized-integrated operating model, each VP independently reports discoveries, honest failures, and 2-3 testable hypotheses for next month (frontier-revealing, MVV-grounded); overlap with other VPs' domains is expected and fine. Consults colleagues across the org regardless of reporting line (live feed reflections + RFC records as primary sources), visualizes real numbers as inline mermaid figures, and publishes to the Notion unified Articles DB tagged Monthly Report with Author set to the VP's slug. Companion series to the President's monthly-report."
---

# vp-monthly-report

> **This is a Cadence skill** (固有名詞: see `.claude/skills/cadence-forge/references/cadence-archetype.md`).
> Fired by EventBridge → `wf-orchestrator-tick` → the generic `agent-runner`
> CCR routine, composed from (persona `system.md` × this `SKILL.md` × binding
> `config` × project credentials). The LLM owns the judgment; the bundled
> `post.mjs` (forwarding to the canonical `monthly-report/post.mjs` writer)
> owns the write. No AWS access in-session.

## What this letter is (and is not)

The President's `monthly-report` answers the org's standing question across
every domain. A **VP letter is one functional lens on the same month**, written
by the VP **as the leader of that function for the whole network** — platform,
engineering excellence, people & legal, finance, external comms, customer
experience, policy. Three binding stance rules (operator direction, 2026-07-08):

1. **Frontier, not throughput.** The org exists to 未踏領域を明らかにする —
   reveal unmapped territory in how human-agent organisations work. The letter
   reports **discoveries, honest failures, and the next hypotheses to test**,
   never a list of tasks completed. Individual work reports belong in the daily
   feed, not here.
2. **Decentralized-integrated.** The org does NOT run as "100 tasks split 20
   each". Each VP independently drives hypothesis-verification in their lane
   and the letters integrate monthly. **Overlap with other VPs' domains is
   expected — do not trim your view to avoid it.** The same event read through
   two lenses is evidence, not duplication.
3. **VP-level altitude.** Write from the position's viewpoint (VP of X leading
   this network), grounded in the MVV: what did this month teach *the function*
   about whether an organisation works when humans design/govern and agents
   execute/learn/compound?

## Stage 1 — Recall packet (情報入手; read-only, before writing a word)

The report window is **the 5th of last month through today** (or since your
previous letter's `Date` if one exists). Assemble, in this order:

1. **Dedupe check (also the skip-rule input).** Query the unified Articles DB
   (`34fd0f0b-e61e-817a-9f6b-dc65b0d5b4cc`) for pages with Tag `Monthly Report`
   AND `Author` = your slug. A page dated in the current calendar month →
   **skip** (see skip path). Also note the President's latest letter — yours is
   a companion piece for the same month, not a rebuttal or a copy.
2. **The why.** Re-read `workforce/docs/mvv.md`. Every chapter must connect
   back to the standing question through your function's lens.
3. **The live org.** `GET {agents-api}/agents` — roster, roles (your signature
   title comes from YOUR live `role` field, never from memory — the 2026-07
   letter signed a stale title and the operator caught it), bindings;
   `GET /performance` (lifecycle funnel, PR counts, autonomous-merge share);
   `GET /feed` paged back to the window start — your own reflections, your
   function's contributors' (regardless of reporting line), and the org-wide
   pulse.
4. **The month in the repo.** `git log --since=<window> --oneline --no-merges`
   filtered through your lens; new/updated ADRs (`workforce/docs/adr/`, root
   `docs/adr/`); epic status flips + **RFC records inside epic files** (your
   own on-record verdicts are quotable primary sources); hire rounds; the
   incident registries (`docs/memory-lint-backlog.md`,
   `docs/risk-acceptance-ledger.md`); `workforce/docs/follow-ups.md`.
5. **Build the evidence digest (分析).** Consolidate the above into one digest
   note before drafting. **Hard rule: every number in the letter and its
   figures comes from this digest's verified data — no estimated or remembered
   figures.** If a number can't be traced to a source read this fire, it does
   not appear.

## Stage 2 — Consult across the network (議論・インタビュー)

Engage colleagues before synthesizing — **any persona in the workforce,
subordinate or not** (operator direction). Two grounded modes, in preference
order:

1. **Documentary interview (default).** Quote colleagues from what they
   actually said this month: their daily feed reflections and their verdicts
   in epic RFC records. Real utterances beat simulated ones. Translate quotes
   to general-audience language; credit by first name.
2. **Live interview (Claude Code sessions only).** Seed a subagent with the
   colleague's live `system_prompt` from `GET /agents/{slug}` plus your
   evidence digest, and ask the 2-3 questions your letter needs. Never invent
   a quote a colleague's record does not support.

The binding's `config.interview_personas` lists the default seats for your
lens; swap seats in the binding, not in this skill body, when the org chart
moves.

## Stage 3 — Write (執筆)

**One letter, in Japanese, in your own voice** (the bound persona's stance from
`system.md`), H1 title:

```
# Software Talent Network 月次レポート YYYY年M月 — <機能を一般読者に伝える編名>
```

The H1 becomes the page title; the 「— ○○編」 suffix distinguishes the VP
series from the President's letter inside the shared `Monthly Report` tag.
Sign with your name and your **current title from the live roster**.

**Audience — the binding constraint (same law as `monthly-report`).** General
readers: executives, designers, legal, HR, engineers, marketers who know
NOTHING of this org's internals or GitHub workflows. Concretely:

- **No internal proper nouns or codes.** No repository/DB/script names, rule
  codes (W-1, R-10, L0/L1, ADR/Epic/ML numbers), API names, or skill slugs.
  Translate: "カデンツ" → 定期ルーティン; "ADR" → 意思決定の記録; "W-1ガード" →
  公開前の自動品質検査; "Epic-021" → 遊休人材についての検証計画. Widely-known
  external terms (GitHub Pull Request, CI, Spotify, Notion as a product) are
  fine when briefly glossed. Colleagues' first names are fine.
- **Why before what.** Open every chapter at the meaning level — what question
  about human-agent organisations this month's events answer or sharpen — and
  use facts as evidence, never as the point.
- **Prose, not bullets.** An essay-letter; bullets only where a true
  enumeration reads better.
- **Honesty is the register.** Unflattering truths stay in (idle hires, missed
  incidents, degenerate steady states in your own lane). A theme that had a
  quiet month gets two sentences, not padding.
- **Disclose up front** that the author is an LLM persona.

**Shape (adapt, don't copy):** ① what this function is trying to prove (MVV
level); ② 2-3 discoveries of the month (each opened from the question it
answers); ③ failures and what they taught — your own lane's included; ④ the
frontier hypotheses for next month — **not a todo list**: 2-3 falsifiable
hypotheses, each with what next month's observation would count as
progress or refutation.

**Figures.** 2-4 inline mermaid blocks per `newsletter/docs/ARTICLE-FIGURES.md`.
Rules that bite: `xychart-beta` is ONE series per chart; non-ASCII axis labels
quoted; every chart carries a `title`; `pie` needs `showData` and ≤5 slices;
never specify colors. Every plotted number comes from the Stage-1 digest.

**Hard bounds:** 8,000–20,000 characters of body prose (target 10,000–14,000 —
one functional slice of the President's 15–35k full-org letter). No chapter
skipped.

## Stage 4 — Verify before writing anywhere (検証)

Before calling the write script, check your draft against the mechanical
guards it will hit (fail here, not there): body length within bounds; ends
cleanly (no mid-sentence stop, no unclosed ``` fence); no LLM-failure prelude;
H1 present and correctly formatted; figure rules above; a final sweep for
internal proper nouns/codes that leaked past translation.

## The skip path — when NOT to write

- A `Monthly Report`-tagged page with `Author` = your slug already exists
  **dated within the current calendar month** → skip (a re-fire must not
  duplicate). Skipping = not calling `post.mjs` (W-4). A deliberate
  operator-requested revision replaces the page: archive the old page first.
- The window contains fewer than 5 merged PRs and no published articles
  org-wide — a dormant month produces a short letter next month, not a padded
  one now.

## Stage 5 — Write via the script, do NOT hand-edit any page

1. Write the letter body to a temp file (e.g. `/tmp/vp-monthly-report-body.md`)
   and a 2-3 sentence abstract to a second file — files, not shell args, so
   multi-line Japanese prose isn't mangled by quoting.
2. Run:

   ```sh
   NOTION_API_KEY="<credentials['notion.integration_token'].apiKey>" \
     node workforce/skills/vp-monthly-report/post.mjs \
       --agent <your-slug> \
       --body-file /tmp/vp-monthly-report-body.md \
       --abstract-file /tmp/vp-monthly-report-abstract.txt
   ```

3. Report the exit code: `0` created (all blocks landed); `2` W-1 guard or
   auth rejected — read stderr, fix the body, do not retry blindly; `1`/`3`
   bad args / API error. A `3` after page creation means the page is
   INCOMPLETE — say so and escalate rather than leaving it.

The credential comes from your task's injected
`credentials["notion.integration_token"]` — never read it from anywhere else,
never hard-code it.

## When NOT to use this skill

- The org-wide integrated letter → that is the President's `monthly-report`;
  this skill never signs as Maya.
- A single-topic deep dive or incident writeup → `article-level3` /
  `design-note`.
- Mid-month status → the daily `feed-post` reflections; don't fire this
  off-cycle for a status ping.
- Recording who-did-what ledger rows → `record-engagement`.
