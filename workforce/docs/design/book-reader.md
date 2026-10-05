# The web book reader (`/books`) — design and data notes

- **Status**: Implemented 2026-10-05 (tracker #799; reader PR and process PR land separately)
- **Routes**: `/books` (shelf), `/books/:slug` (cover · table of contents · 続きから読む),
  `/books/:slug/:chapterId` (the reading view) — public, outside `AuthBoundary`, linked from the
  public header as **Books** beside Docs and Research
- **Process**: how a book is produced is the public document
  [`/docs/book-production`](../../app/src/content/docs/book-production.html) and the session skill
  [`.claude/skills/book-production`](../../../.claude/skills/book-production/SKILL.md)
- **Sibling notes**: [`public-docs.md`](public-docs.md) (the `/docs` fragments),
  [`research-surface.md`](research-surface.md) (the article reader)

## What a book is

A book is **repo-authored Markdown** under `workforce/app/src/content/books/<slug>/` — a
`book.json` manifest (parts → chapters), one Markdown file per chapter, a `quotes.md` register of
every classical quotation, and inline SVG figures. It sits inside the console app so that a content
change redeploys the console, and so that chapters and figures are bundled lazily by Vite
(`import.meta.glob` with `?raw`) — the console's main bundle pays nothing for a 110,000-character
book. Agents reference the chapters by path later; that is why the body is Markdown, not HTML.

The book is **not** an article: C-2 (Notion is the source of truth) governs the article corpus.
A book's source of truth is the repo. The PR body says so.

## The gate

`workforce/scripts/check-book.mjs` runs from the console's `prebuild`, so `npm run build` (CI) and
the deploy refuse a broken book — the book-side twin of the article pipeline's W-1: manifest
shape, every chapter present with one `# ` title and no raw HTML, every ```quote block carrying
原文/訓読/出典 with its 原文 **verbatim** in `quotes.md`, every figure present and painted with CSS
variables only, ≥ 2,000 visible characters per chapter unless marked `short`, and the generated
名言集 appendix in sync with the register (`build-book-quotes-appendix.mjs`).

## Reading for hours

The reader's design is the one decision this note records that `DESIGN.md` does not yet:

- **Measure 38em** (≈ 38 全角 per line, the 文庫 line; WCAG 1.4.8 says ≤ 40 for CJK), line-height
  1.95, justified, 18px default with S/M/L (16/18/20).
- **Serif default** (明朝: Hiragino Mincho → Yu Mincho → Noto Serif JP), sans as an option — a book
  reads as a book, not as a console panel. Geist stays in the chrome.
- **Three themes scoped to the book**: paper (default, light background — positive polarity reads
  better at every age), sepia, night. They are CSS variables on `.book-root`, defined in
  `index.css` with the other hex, and figures paint with the same variables so they re-theme. The
  console itself keeps its one theme (DESIGN.md §Research "What is not here"); the book surface is
  the deliberate exception, because its use is hours-long reading rather than operation.
- **Chrome that gets out of the way**: a 48px bar that hides on scroll-down and returns on
  scroll-up, a 2px progress bar, prev/next cards in the footer, a TOC drawer, keyboard ←/→.
- **Resume**: position (chapter + nearest heading id + scroll ratio) and per-chapter read ratio in
  `localStorage` (`kohuehara.book.<slug>`, `…​.read`), settings in `kohuehara.book.settings`. Every
  access is try/catch'd; the page reads fine without storage. This is per-device state, like the
  stored language choice (`kohuehara.lang`) — not per-reader server state, so C-3 is untouched.

## Not done here, on purpose

- No vertical writing, no paged (横送り) mode — a later option for the 原文 blocks only.
- No analytics beyond the route page view; no comments; no accounts.
- `DESIGN.md` is Zone A and is not edited by the reader PR; the §Public surfaces paragraph that
  should eventually name the book surface is the operator's to add, with this note as its source.
