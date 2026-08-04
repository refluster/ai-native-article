# ADR-0005 — Bilingual article editions (ja/en), one row, one URL

- **Status**: Proposed
- **Date**: 2026-08-04
- **Deciders**: operator (refluster), Claude Code session

## Context

`kohuehara.xyz/ai-native-article` publishes Japanese only. The operator wants
the site readable in English as well: the reader's language should follow the
browser by default, be switchable by hand, persist across visits, and every
article — including the ~130 already published — should exist in both languages.
The generation cadences (`workforce/skills/article-level{2,3}`) should emit both
editions from then on, **without** growing a second skill: the research and the
judgment are shared, only the rendering is doubled.

Four decisions had to be made, and they interact:

1. **Where the English text lives.** C-2 makes Notion the source of truth, so
   "translate at build time" or "keep the English in `public/posts/`" are both
   out — a derived export is overwritten on every deploy.
2. **Whether English gets its own URLs.** The corpus is linked from elsewhere
   and AGENTS.md §3 puts "moving a route or breaking a URL" on the human side.
3. **How the reader picks a language**, and what happens on an article that has
   no English edition yet — which is *every* article until the backfill runs.
4. **How the existing corpus gets translated**, given that the repo has had no
   live programmatic LLM call site since the GAS engine was retired.

## Decision

**1. One row, English on an `EN` child page.** An article stays a single row in
the unified Articles DB. Its English edition is a Notion **child page titled
`EN`** under that row, whose body is a fixed shape:

```
# <English title>
> <English abstract>
<English body…>
```

`scripts/lib/notion-i18n.mjs` is the single canonical implementation of that
contract — it builds the blocks, parses them back, and is shared by the two
cadence writers, the fetcher, and the backfill script.

**2. One URL, two editions.** `/article/<slug>` serves whichever edition the
reader's language selects. No `/en/…` routes. `?lang=ja|en` is an explicit,
shareable override, and `hreflang` alternates point at it so crawlers can index
both. The export gains a sibling file, `public/posts/<slug>.en.md`, with the
same slug and the same metadata.

**3. Language resolution**: `?lang=` → `localStorage["kohuehara.lang"]` →
`navigator.languages` (first Japanese-or-English entry) → English. A browser
that asks for neither language gets English, because a reader whose browser
never mentions Japanese is the one who needs the translation. The choice is
resolved synchronously on first paint so no reader sees the wrong language
flash. An article with no English edition renders Japanese **with a visible
notice**, never a 404 and never a silent language switch.

**4. Both editions are mandatory at generation time.** `publish-notion.mjs` in
both cadences requires `--body-en-file`, runs the W-1 guards over *both* bodies
*before* any write, and only then creates the row and its `EN` child page. A
Japanese-only fire is a failed fire (C-4). The pre-existing corpus is translated
by `newsletter/pipeline/backfill-en.mjs`, an operator-run, resumable script that
skips rows that already have an edition.

## Alternatives considered

- **A second Notion row per language, joined by a `Lang` property.** Rejected:
  it doubles every row the L2/L3 pickers walk, splits tag counts and the
  homepage index, duplicates `SourceURLs` (which is the L2 coverage key and the
  L3 reuse-avoidance key), and makes "which of these two rows is the article" a
  question every consumer has to answer forever.
- **New `TitleEn` / `AbstractEn` / `BodyEn` properties on the row.** Rejected:
  Notion rich_text properties cap at 2000 characters, so the body could not live
  there at all; and it would require a live Notion schema migration before any
  of this code could run.
- **Translating at build time in CI, from the Japanese export.** Rejected under
  C-2: the translation would exist only in a derived artefact, could not be
  corrected in Notion, and would be re-paid for (and re-randomised) on every
  one of the three daily deploys.
- **`/en/<slug>` routes.** Rejected: breaks no existing URL only if the
  Japanese ones stay put, at which point the English routes are a second IA to
  maintain for a one-operator site (C-3), and the reader's language and the
  URL can disagree.
- **A separate `article-translate` cadence.** Rejected on the operator's
  explicit instruction and on merit: a translation that is generated separately
  from the article is free to reach different conclusions from it. The two
  editions must come out of one act of judgment.
- **Falling back to hiding untranslated articles from the English index.**
  Rejected: it silently shrinks the corpus for English readers. A visible
  fallback is the C-4-shaped choice.

## Consequences

- Every generation fire now produces two bodies. Cost per article rises; the
  research, source fetch, and judgment do not repeat.
- `publish-notion.mjs` gains exit code `4` — "row created, English edition
  failed". That state is repaired with `backfill-en.mjs --page-id`, never by
  re-running the publish command, which would duplicate the row.
- The R-10 deploy gate now scans `<slug>.en.md` too, at no extra wiring cost: it
  globs `*.md`. A truncated translation blocks the deploy exactly like a
  truncated Japanese body.
- `backfill-en.mjs` is the repo's first live programmatic LLM call site since
  the GAS retirement, and the first use of the **Heavy (16000)** bracket in
  `newsletter/docs/azure-budget-rules.md` — translation output length tracks
  input length, unlike generation.
- Operator surfaces (`/operator`, `/sources`, `/capture`, `/design-*`) stay
  Japanese-only. They are tools for one operator (C-3), not reading
  destinations (ADR-0002).
- The header gains one reader-facing control. That is a public-IA change, which
  AGENTS.md §3 reserves for a human — it is here because the operator asked for
  it by name.
- Two editions can drift if someone edits only one side in Notion. Nothing
  detects that today; it is a candidate for a future `article-health` check.

## Related

- [ADR-0002 — daily-use reader IA](adr-0002-daily-use-reader-ia.md) — why
  operator surfaces are excluded from the reader-facing translation scope.
- [ADR-0003 — flat tag taxonomy](adr-0003-flat-tag-taxonomy.md) — tags stay
  single-sourced on the row; they are not translated.
- [docs/governance.md](../governance.md) — C-1 editorial integrity, C-2 Notion
  as source of truth, C-3 single-operator scale, C-4 fail loud.
- [AGENTS.md](../../AGENTS.md) — zones; §3 on URLs and public IA.
- [newsletter/docs/azure-budget-rules.md](../../newsletter/docs/azure-budget-rules.md)
  — the Heavy bracket used by `backfill-en.mjs`.
- [newsletter/docs/architecture-source-of-truth.md](../../newsletter/docs/architecture-source-of-truth.md)
  — where each copy of an article lives.
