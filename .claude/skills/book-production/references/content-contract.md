# Book content contract (v1) — what a book is, on disk

A **book** lives inside the workforce console SPA so that a content change redeploys the console
(`.github/workflows/deploy-workforce-console.yml` triggers on `workforce/app/**`):

```
workforce/app/src/content/books/<slug>/
  book.json              # manifest (see below)
  chapters/NN-<id>.md    # one Markdown file per chapter, NN = two-digit order
  figures/<name>.svg     # inline SVG figures referenced from chapters
```

Agents reference the Markdown directly (`workforce/app/src/content/books/sunzi/chapters/03-mou-gong.md`).

## book.json

```json
{
  "slug": "sunzi",
  "title": "孫子の兵法",
  "subtitle": "不確実性を減らし、勝算を高める古典を原文から読む",
  "lang": "ja",
  "kicker": "Web book · 日本語",
  "description": "一段落の紹介文（棚カードに出る）。",
  "authors": ["ingrid", "sora", "..."],
  "version": "1.0.0",
  "updated": "2026-10-05",
  "parts": [
    {
      "id": "front",
      "title": "はじめに",
      "chapters": [
        { "id": "preface", "file": "chapters/00-preface.md", "title": "序 — なぜいま孫子か", "kicker": "序" }
      ]
    },
    {
      "id": "part-1",
      "title": "前編 原文を読む",
      "chapters": [
        { "id": "01-ji", "file": "chapters/01-ji.md", "title": "始計篇 — 戦う前に、数える", "kicker": "第一篇" }
      ]
    }
  ]
}
```

Rules: every `chapters[].file` must exist (build-time throw, C-4). `id` is the URL segment
(`/books/sunzi/01-ji`). Chapter order = array order. Reading time is computed from the body
(Japanese: characters ÷ 600 per minute), not stored.

## Chapter Markdown

- First line is `# <chapter title>` (H1). Sections use `##`, sub-sections `###`. Headings receive stable
  ids (`h-<n>` in document order) so a reading position can anchor to the nearest heading.
- Ordinary GFM: paragraphs, emphasis, lists, tables, blockquotes, `---` rules, links.
- **No raw HTML.** The renderer does not enable rehype-raw. Use the fenced blocks below instead.

### Fenced blocks (the book's vocabulary)

1. **Original quotation** — the load-bearing block. Renders as a quote card: 原文 (large, traditional
   Chinese), 訓読 (書き下し), 出典 chip, and 訳.

   ````
   ```quote
   原文: 百戰百勝、非善之善者也。不戰而屈人之兵、善之善者也。
   訓読: 百戦百勝は善の善なる者に非ず。戦わずして人の兵を屈するは、善の善なる者なり。
   出典: 謀攻篇
   訳: 百回戦って百回勝つのは、最善ではない。戦わずに敵を屈服させるのが最善である。
   ```
   ````

   Keys are exactly `原文`, `訓読`, `出典`, `訳` (訳 optional; others required). One `key: value` per line.
   Every `原文` MUST appear verbatim in the book's canonical quote register (`quotes.md`) — a lint checks it.

2. **Connection aside** (異分野への接続 — 点と点をつなぐ). Renders as an aside card with a kicker
   「接続」 and the title.

   ````
   ```connect
   title: 航空機設計の「安全余裕」
   body...
   (Markdown allowed inside: paragraphs, emphasis, lists)
   ```
   ````

3. **Note** (補注・用語・史実の注意). Renders as a small-type note block.

   ````
   ```note
   「兵は拙速を貴ぶ」は後世の成語。原文は「兵聞拙速、未睹巧之久也」。
   ```
   ````

4. **Figure** — an inline SVG. Standard image syntax whose `src` ends with `.svg` and points into
   `figures/`:

   ```
   ![図1 五事七計 — 勝算を数える五つの軸](figures/01-five-factors.svg)
   ```

   The alt text is the caption. The SVG is inlined (so it themes with the page via CSS variables).

### SVG figure rules

- `viewBox` set, no fixed `width`/`height` attributes (the reader scales it to the measure; max width 100%).
- Paint with CSS variables only: `var(--book-ink)` (text, strokes), `var(--book-ink-2)` (secondary),
  `var(--book-accent)` (emphasis), `var(--book-line)` (hairlines), `var(--book-panel)` (fills),
  `var(--book-bg)` (background). Use `currentColor` for text where convenient. No raw hex in the SVG
  (not linted, but it would break the night theme).
- Fonts: `font-family: inherit`. Minimum font-size 12 (viewBox units ≈ px at 100% width of 680).
- Keep each figure legible at 360px wide: ≤ 7 labelled elements, or use a vertical layout.
- Text inside the SVG is Japanese; keep labels ≤ 12 characters; put long explanations in the caption.
- Add `role="img"` and `<title>` with the figure's title.

## Reader behaviour the content can rely on

- `/books` — shelf (every book.json). `/books/<slug>` — cover, table of contents with per-chapter read
  state, 「続きから読む」 when a position is stored. `/books/<slug>/<chapterId>` — the chapter.
- Reading position (chapter + nearest heading + scroll ratio) is saved per device in `localStorage`
  (`kohuehara.book.<slug>`) and restored by 「続きから読む」; chapter read-ratio per chapter in
  `kohuehara.book.<slug>.read`. Reader settings (font size S/M/L, theme paper/sepia/night, family
  serif/sans) in `kohuehara.book.settings`. No server state (C-3).
- Keyboard: `←`/`→` previous/next chapter. The top bar hides while scrolling down and returns on
  scroll up; a thin progress bar shows position inside the chapter.
