---
name: book-production
description: >-
  Produce a 文庫-length web book (≈100–130k Japanese characters) with the agent workforce, the way a
  publisher does — ten gated stages (企画 → リサーチパック → 台割 → 執筆 → 構成編集 → 原稿整理 →
  校閲 → 図版・組版 → 校正 → 校了・公開) run from one operator session, each work package cut out to
  an Opus sub-agent that role-plays the responsible persona. Writes Markdown chapters under
  workforce/app/src/content/books/<slug>/ (the console's /books reader renders them), keeps every
  classical quotation in a machine-checked register (quotes.md ↔ check-book.mjs), lands the book as a
  draft PR for pr-autopilot, and records each persona's engagement. Use for "本を作って", "write a
  book on X with the workforce", "turn this corpus into a readable book", "another book like the
  Sunzi one". Not for single articles (article-level2/3) or research reports (research-study).
---

# book-production

A **book** is the longest artefact this workforce ships. One LLM pass produces a plausible book that
fails exactly where a reader notices: a misquoted classic, a chapter that repeats the last one, a
stub where a section should be, a line of analogies that do not actually share a mechanism. The
stages below exist so each of those defects is caught by a named gate before the next stage pays
for it. The design is lifted from publishing practice (企画会議・台割・校閲・校正・校了, and the
English developmental → line → copy edit → fact-check chain); the human-facing explainer is the
console page **`/docs/book-production`** (`workforce/app/src/content/docs/book-production.html`).

> **Execution shape.** Operator-invoked, session-driven (like `research-study`): the stages run in
> ONE Claude Code session, each work package (WP) cut out to a sub-agent (`model: opus`) that
> role-plays the Responsible persona. The side effects are a draft PR (R-N9 — never a push to
> `main`) merged by `pr-autopilot`, and engagement rows. Nothing here needs AWS or a cadence; turning
> stages into chained Cadences is a later step that would need a `QUEUES` row per hand-off (R-N11).

## What a book is, on disk (read `references/content-contract.md`)

```
workforce/app/src/content/books/<slug>/
  book.json          # manifest — parts → chapters (id, file, title, kicker, short?, generated?)
  quotes.md          # the quote register — the ONLY source a chapter may quote a classic from
  chapters/NN-id.md  # one Markdown file per chapter; fenced blocks: quote | connect | note
  figures/*.svg      # inline SVG painted with var(--book-*) only
```

Why inside `workforce/app/`: a content change must redeploy the console
(`deploy-workforce-console.yml` watches `workforce/app/**`), and the reader (`/books`,
`/books/:slug`, `/books/:slug/:chapter`; `src/lib/books.ts`, `components/book/*`) bundles chapters
lazily from there. Agents reference the Markdown by path later. Notion is NOT the source of truth
for a book (C-2 governs *articles*); the repo Markdown is — say so in the PR body.

**The gate** is `node workforce/scripts/check-book.mjs [slug]`, run by the console's `prebuild`
(so `npm run build` and the deploy refuse a broken book, C-4): manifest shape, every chapter file
present, exactly one `# ` title, no raw HTML, every ```quote carrying 原文/訓読/出典 **with 原文
verbatim in quotes.md**, ```connect with a `title:`, figures present and hex-free, ≥ 2,000
visible characters unless `"short": true`, and the generated 名言集 appendix in sync
(`build-book-quotes-appendix.mjs <slug>`). Extend it rather than adding a parallel checker.

## Seats (lens → persona). Resolve per book from `GET /agents`; a paused/archived persona is replaced by the nearest lens, never invented

| Stage | Responsible | Accountable | Consulted |
|---|---|---|---|
| S0 企画 | ingrid (企画書), nadia (後編の価値仮説), dmitri (需要・類書) | **ingrid** = 編集長 for the whole book | maya, celeste, nico, mateo, petra |
| S1 リサーチパック | sora (底本・原文・訓読 v1・名言候補), bruno (先行書・流布状況), zoe (用語集), idris (権利メモ), astrid (出典作法) | beatriz | rafael (異同の反証), mira |
| S2 台割 | ingrid (章構成), camille (台割表・進行), elena (一貫性) | ingrid | nadia, mira, kai, aoi (図版枠) |
| S3 執筆 前編 | sora (原文・訓読・訳), rhys (解説の語り), zoe (語注) | ingrid | beatriz, kai |
| S3 執筆 後編 | nadia (統括), tomas, clara, linnea, bruno, beatriz | ingrid | maya, rafael |
| S4 構成編集 | ingrid (editorial letter), elena, mira (初学者の通読) | ingrid | maya, nadia, rafael |
| R 再編ループ | ingrid (判断), camille (台割 v(n+1)) | ingrid | elena, nadia |
| S5 原稿整理 | kai (表記・声), mira (可読性), zoe (初出定義), owen (lint) | ingrid | clara |
| S6 校閲 | rafael (事実・引用・反証), astrid (出典・開示), idris (権利), beatriz (原文照合 — sora とは独立) | astrid | sora, ingrid |
| S7 図版・組版 | aoi (SVG・読者 IA), ren (reader), freya (UX), owen (ビルド gate), imogen (先行公開) | aoi | farah, kai, mira |
| S8 校正 | mira (初校通読), farah (表示・端末差), kai (再校表記), zoe (索引), owen (差分 gate) | ingrid | 担当執筆者 |
| S9 校了・公開 | ingrid (校了票), camille, ren (公開), petra (切り戻し) | ingrid | astrid, idris, owen, farah |
| 公開後 | celeste, imogen, nico, dmitri (読了率), rhys (ポッドキャスト化) | celeste | ingrid, linnea |

Independence rule: nobody fact-checks their own chapter. The persona who transcribed the source
text (sora) is checked by someone else (beatriz, rafael).

## The ten stages — run in order, gate before moving on

Every stage leaves a file; every gate is either a script or a read-and-confirm the 編集長 records in
the PR body. Work in the scratchpad until S7; copy into `workforce/app/src/content/books/<slug>/`
only what the reader needs (manifest, quotes.md, chapters, figures). Keep research packs, briefs,
review ledgers under `workforce/books/<slug>/production/` if they should be kept, or in the PR body
otherwise.

| # | Stage | Do | Artefact | Gate |
|---|---|---|---|---|
| S0 | 企画 | Operator's brief → one-page proposal: reader (棚と人), why this book, part structure, total budget in characters, what makes the reader say it was worth it, the persona seats, the PR plan. Open the tracker issue + sub-issues (labels `project:` `layer:L3` `type:`). | `proposal.md`, issues | **G0** proposal has every field; operator intent restated in one sentence |
| S1 | リサーチパック | Sub-agent (sora): source text per unit (for a classic: each 篇, full original from a public-domain edition; summaries; structure beats), `quotes.md` register (60–90 entries: id, 篇, 原文, 訓読, よみ, 現代語訳, 含意, 誤解注意), background note. Clean-room: own 訓読 following conventional readings, own 現代語訳; never a modern translator's wording. | `research/*.md`, `quotes.md` | **G1** every quote has 原文/訓読/篇; register parses (`parseQuoteRegister`); sources listed are URLs actually fetched |
| S2 | 台割 | 編集長 writes the outline: chapter list with id, file, title, character budget, the **connection map** (which outside domain each chapter connects to — one domain per book, no repeats), figure list, and the style guide (`references/style-guide-ja.md` is the base). Then one **brief per chapter** (thesis, beats, the quote ids to use in order, the two connections, the figure spec, the bridge to the next chapter). | `outline.md`, `briefs/NN.md`, `style-guide.md` | **G2** budgets sum to 100–130k; every source unit is assigned to a chapter; no connection domain repeats; every brief names its quote ids |
| S3 | 執筆 | One Opus sub-agent per chapter, in parallel batches of 4–6, each given ONLY: its brief, the style guide, the content contract, `quotes.md`, and the previous chapter's closing paragraph (for the bridge). Writers may not invent quotations: they copy 原文 from the register. Figures: one design sub-agent (aoi) draws all SVGs from the figure specs. | `chapters/*.md`, `figures/*.svg` | **G3** `check-book.mjs` clean on the draft; each chapter within ±15% of budget; no W-1 artefacts (cut-off, filler, English leakage) |
| S4 | 構成編集 | 編集長 sub-agent reads the whole manuscript: duplicated explanations, missing bridges, a Part II chapter that merely restates Part I ("so what" test by nadia), a chapter whose connections don't share a mechanism. Writes the editorial letter. | `editorial-letter.md` | **G4** letter lists per-chapter verdicts (keep / revise / restructure) |
| R | 再編ループ | If G4 says restructure: revise the outline to v(n+1), send only the affected chapters back to S3. Max 2 loops; a third is an S0 problem — report to the operator. | `restructure-log.md` | back to G2 |
| S5 | 原稿整理 | Line/copy pass per chapter (kai, mira): sentence length (warn > 60, fail > 100 outside quote blocks), 表記統一, first-use definitions of terms, です・ます consistency, cliché removal. | revised chapters, `style-sheet.md` | **G5** `check-book.mjs` clean; no sentence > 100 chars in prose |
| S6 | 校閲 | rafael: attempt to refute every factual claim (dates, names, textual variants, "Napoleon read it" legends → 伝説); astrid: citations and the AI-authorship disclosure; idris: no borrowed translation; beatriz: every quote card's 訓読/訳 against the 原文. Findings in a queries ledger; every query resolved. | `queries.md` | **G6** zero open queries; register unchanged or re-verified |
| S7 | 図版・組版 | Reader build: `npm run build:workforce`, `npm run lint:tokens`, `cd workforce/app && npx vitest run`; figures legible at 360px; `/books/<slug>` cover, TOC, resume position. Regenerate the appendix: `node workforce/scripts/build-book-quotes-appendix.mjs <slug>`. | built app | **G7** build + lint + tests green; `check-book.mjs` clean |
| S8 | 校正 | Proof pass on the rendered pages (mira reads, farah checks layout on phone/laptop widths, kai checks 表記). Three rounds max; the third only confirms the diff of the second. | `proof-N.md` | **G8** round 3 adds ≤ 5 corrections |
| S9 | 校了・公開 | Sign-off in the PR body (ingrid, astrid, idris, owen). Draft PR (`L3(workforce): …` or `content: …`; template sections; cite this skill), **no L0/L1 path** touched (`docs/governance.md §4.4` list), `subscribe_pr_activity`, then let `pr-autopilot` route → ≥3 lenses → merge. Answer findings by pushing fixes to the head branch. After merge: `deploy-workforce-console.yml` green, then `curl -I https://workforce.kohuehara.xyz/books/<slug>` and open one chapter. | PR, deploy | **G9** merged + live |
| — | 公開後 | `log-workforce-engagements` for every persona that did a WP (one row per persona per WP kind, title-first summary, PR URL). Retrospective: which gate caught what; feed it back into this file. | engagements, `retro.md` | — |

## Sub-agent briefs — the shape that works

- One WP per agent, `model: opus`, `general-purpose`. Name the persona and role in the first line.
  Give the agent **only** the inputs its stage needs (a writer gets its brief + style guide + contract
  + register; not the other chapters) — this is what keeps 20 chapters from converging on one voice
  and one set of examples. Ask for the file path to write to, in the scratchpad, never the repo.
- Writers: state the character budget and the exact fenced-block syntax; demand that every
  ```quote 原文 be copy-pasted from `quotes.md`; forbid raw HTML; require the chapter to end on the
  bridge sentence to the next chapter.
- Reviewers: ask for a ledger (file:line, claim, verdict, fix), not prose. Give the red team the
  register and the background note so it can refute against sources, not vibes.
- Run `check-book.mjs` yourself after copying each batch in — it is faster than any review pass and
  catches the two expensive defects (misquote, stub) immediately.

## Governance

- Zone B code (reader) + Zone C content (chapters) land in one PR only when the content is complete;
  never ship an empty book behind a working reader (C-1/C-4).
- Do not edit `workforce/DESIGN.md`, workflows, ADRs or `CLAUDE.md` from this skill — those are
  Zone A. If the book needs a design decision recorded, write a design note under
  `workforce/docs/design/` and say in the PR body which Zone A doc should eventually absorb it.
- The reader stores position/settings in `localStorage` only. No server state, no accounts (C-3).
- Cost: a 20-chapter book is ~25 Opus sub-agent runs. Say so in S0 against W-3.

## Precedent

Book #1 — 『孫子の兵法』(`sunzi`), 2026-10-05: 13 篇 + 序・導入・前編まとめ・後編 5 章・終章・付録
名言集, ≈110k characters, 20 figures; tracker refluster/ai-native-article#799. Its retrospective is
the calibration set for this body.
