# ADR-0003 — Flat tag taxonomy (replacing the A–E hierarchy)

- **Status**: Proposed
- **Date**: 2026-06-29
- **Deciders**: operator (refluster)
- **Supersedes**: the A–E category model referenced in ADR-0002 (analysis-default IA); ADR-0002's other decisions stand.

## Context

The reader site classified each article with a **single, lettered, hierarchical
category** — `A: AI Hyper-productivity` … `E: Rethinking SDLC` — optionally
plus a free-form `× theme`. Two problems, confirmed against the live corpus
(129 articles):

1. **The lettered prefix leaks and confuses.** The `E:` etc. is stored in the
   data and surfaced to readers ("E: RETHINKING SDLC"). It encodes a hierarchy
   position that means nothing to a reader. ADR-0002 added a render-time
   `displayTag()` strip; this ADR removes the cause.
2. **The model is wrong for the domain.** A 5-bucket hierarchy is too coarse and
   too rigid for a field that shifts quickly. The escape valve — the free-form
   `× theme` — is **noise**: of 38 analyses, nearly every theme string is unique
   (`半導体製造基盤 × AIインフラ戦略`, `組織変革 × 技術革新`, …), plus junk
   (`TEST CAT`, `Macrohard`, bare `A`/`D`). A tag that appears on exactly one
   article gives zero many-to-many value and a useless sidebar.

The A–E names were also **duplicated across five files** (the two
`publish-notion.mjs` writers, `pick-l2-sources.mjs`, `normalize-categories.mjs`,
and the `fetchers/notion.mjs` exporter), so the taxonomy had no single home.

## Decision

Replace the single hierarchical category with a **flat, curated, Japanese
tag vocabulary**. Tags are **many-to-many**: one article carries ~3–5 tags;
one tag spans many articles.

1. **One source of truth.** The vocabulary lives in
   [`scripts/lib/tags.mjs`](../../scripts/lib/tags.mjs) (`TAGS`), importable by
   both the newsletter pipeline and the workforce write-scripts. Editing the
   list is a Zone A editorial decision and amends this ADR.
2. **The vocabulary (14 tags).** AI生産性 / エージェントAI / 検証と信頼 /
   開発プロセス / 開発者ツール / 役割の融合 / 新しい職種 / スキルと学習 /
   組織変革 / 雇用と労働市場 / 大手テック動向 / AIインフラ / 製造業のAI /
   AI戦略. Flat, no letters, reader-facing labels verbatim.
3. **Storage is unchanged.** `CategoriesMulti` (multi_select) is already the
   many-to-many field; it now holds vocabulary tags only. The single `Category`
   field is demoted to the article's primary tag (first of `CategoriesMulti`).
4. **Generation picks tags from the vocabulary.** The article-level2/level3
   cadences select 3–5 tags against `TAGS` (validated at the write boundary by
   `validateTags`) instead of deriving an A–E bucket + free-form theme. These
   are per-skill, Zone A `SKILL.md` changes (W-5 / Rule 11: one skill per PR).
5. **The existing corpus is re-tagged (backfill).** Existing rows are
   re-classified into the vocabulary and their `CategoriesMulti` overwritten in
   Notion (the source of truth, C-2), then a deploy regenerates the manifest.

## Alternatives considered

- **Keep A–E, drop only the letters.** Rejected: the hierarchy itself is the
  mismatch; a flat set degrades gracefully as the field moves.
- **Free-form / emergent tags (generator invents tags).** Rejected on the
  evidence above — it is exactly what produced the all-unique `× theme` noise.
  Curation is what makes the many-to-many real.
- **Hybrid (fixed core + free tags).** Rejected for v1 as added rule-complexity
  with little gain; revisit if a recurring topic has no home in the 14.

## Consequences

- The sidebar becomes genuinely useful: tags recur, counts mean something,
  filtering surfaces real clusters.
- `displayTag()` becomes a no-op once the data is clean; it stays as a
  defensive guard for any legacy/un-backfilled row (fail-soft, not loud — the
  data is non-authoritative cosmetics).
- Migration is staged: (a) this ADR + the `tags.mjs` module; (b) per-skill
  generation PRs (Zone A); (c) the operator-run Notion backfill. Until (b)+(c)
  land, new articles still carry the old buckets and `displayTag` keeps them
  presentable.
- The backfill mutates authoritative Notion data — it runs from an environment
  with `NOTION_API_KEY` (a remote session is egress-blocked → 403), and is
  reversible only by re-running a re-tag, so it is operator-gated.

## Related

- [ADR-0002](adr-0002-daily-use-reader-ia.md) — analysis-default daily-use IA (this refines its tag model).
- [`newsletter/docs/DESIGN.md` §7](../../newsletter/docs/DESIGN.md) — IA record.
- `workforce/docs/governance.md` §3 (SKILL.md = Zone A) / W-5 — gates the generation PRs.
- docs/governance.md §2 — C-2 (Notion is source of truth), C-3 (single-operator simplicity).
