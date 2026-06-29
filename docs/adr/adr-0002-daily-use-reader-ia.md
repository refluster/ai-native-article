# ADR-0002 — Daily-use reader IA: analysis-default, flat tags, operator split

- **Status**: Proposed
- **Date**: 2026-06-29
- **Deciders**: operator (refluster), with design ideation by the Celeste / Nadia / Aoi / Mateo / Yuki personas

## Context

The `kohuehara.xyz` reader SPA (`newsletter/app`) had accumulated, on a single
homepage, every axis the pipeline could express: both article *types* (L2
explanation and L3 analysis) behind tabs, a time-period filter (7d / 30d / 90d
/ all), an A–E *hierarchical* category taxonomy split into "canonical buckets"
vs "free-form themes", and operator tooling links (design system, design guide,
workforce console, capture) in the public header/footer.

For a site whose purpose is **daily reading**, this was over-built:

- The **analysis** article is the product surface (GROWTH.md §3 sets its
  higher quality bar; it already links its source explanations and the original
  web pages in its SOURCES USED section). The **explanation** is a fact-check
  drawer, not a daily-read destination — yet both competed for the homepage.
- A **single-category, lettered hierarchy** (`"C: New Roles / FDE"`) does not
  fit a domain whose fields shift quickly; the leading letter carried no
  meaning for readers and actively confused them.
- The **time-period filter** went effectively unused.
- The right rail's **MUST READS** had no height cap or overflow rule, so it was
  cut off mid-content with no scroll affordance.
- **Operator links** in the public chrome blurred the read/operate boundary
  (AGENTS.md §3: "Navigation is a promise to readers").

No prior ADR governed the reader information architecture; the IA lived
implicitly in `Home.tsx` and the AGENTS.md decision matrix. This ADR fills that
gap and records the deliberate simplification.

## Decision

Re-shape the reader IA around daily use:

1. **Analysis is the default and only homepage list.** The type tabs are
   removed. Explanations remain fully reachable at their `/article/:slug` URLs
   and via each analysis's SOURCES USED section — the intentional "back
   drawer." No `分析` / `解説` label is shown in the list (analysis is the
   norm, not a special case).
2. **Flat tags replace the category hierarchy.** One article carries multiple
   tags (target 3–5). The A–E bucket/theme split and the leading-letter prefix
   are dropped. As an interim until the data source is rewritten, the prefix is
   stripped at render time via `displayTag()`; the canonical fix lands in the
   generation cadences + `normalize-categories.mjs` (scope B, workforce-owned).
3. **Remove the time-period filter.** Replaced by client-side pagination
   (`?page=N`, 12/page) over a date-grouped (TODAY / THIS WEEK / THIS MONTH /
   `YYYY.MM`) list, with an incremental title/tag search box and a top-5 tag
   rail (expandable).
4. **Fix the sidebar overflow.** The sticky rail gets `max-h` + `overflow-y-auto`.
5. **Split operator tooling off the reader path.** Design system, design guide,
   capture, workforce console, and original sources move to a new `/operator`
   page, linked discreetly from the footer. The public header carries only
   INDEX. **No routes are deleted** — existing URLs/bookmarks keep resolving.

This is a Zone A change (public IA + homepage editorial judgment, AGENTS.md §3);
it is made under direct operator direction.

## Alternatives considered

- **Keep both types with analysis-first sort.** Rejected: still presents the
  explanation as a daily-read peer and keeps the type tab clutter.
- **Keep the A–E hierarchy, drop only the letters.** Rejected: the hierarchy
  itself is the mismatch for a fast-moving domain; flat tags degrade gracefully
  as fields change.
- **Infinite scroll / "load more" instead of pagination.** Rejected in favor of
  pagination for shareable `?page=` URLs and a sense of archive depth; revisit
  if the corpus grows enough to make page counts unwieldy.
- **Per-reader read/unread marking** (a brainstorm idea). Rejected for now: it
  pushes mutable per-reader state to the edge, against the C-3 single-operator
  simplicity constraint.

## Consequences

- The homepage is materially simpler and tuned for return visits.
- GA4 loses `type_filter_click` / `range_filter_click` / `featured_click`
  signal and gains `page_change`; `category_click` now carries a tag. The
  GROWTH.md outer-loop dashboards must be reconciled to the new event set.
- Until scope B lands, analyses surface only their existing 2 tags (A–E bucket
  + × theme, prefix stripped); the 3–5-tag target is realized when the
  workforce generation prompts (Zone A) and `normalize-categories.mjs` are
  updated and the corpus is re-published.
- `displayTag()` is a render-time guard, not a data fix — the data still holds
  prefixed names until the source rewrite. C-2 (Notion is source of truth) is
  respected: the durable fix is at the source, tracked as scope B.

## Related

- AGENTS.md §3 (public IA / homepage editorial = human-owned)
- `newsletter/docs/DESIGN.md` §7 (Information Architecture)
- `newsletter/docs/GROWTH.md` §2–§3 (L2/L3 model, analytics event catalogue)
- docs/governance.md §2 (C-1…C-4 invariants)
