# Public documents in the SPA — design and data notes

- **Status**: Implemented 2026-09-12 (this PR); design rules in
  [`../../DESIGN.md` §Public surfaces](../../DESIGN.md#public-surfaces-landing--docs--research)
- **Routes**: `/docs` (index), `/docs/:slug` (whitepaper · founding-story ·
  manifesto) — public, outside `AuthBoundary`, linked from the public header
  beside **Research**
- **Sibling note**: [`research-surface.md`](research-surface.md) — the other
  public reading surface, same shell

## What changed

The three public documents used to be standalone pages under
`workforce/app/public/docs/*.html`, each carrying its own `<head>`, font
stack (Familjen Grotesk / Source Sans 3 / IBM Plex Mono), colour variables,
dark theme and site bar — a second design system living next to the
console's *Cognitive Network* one, reached by a full page load from the SPA.
`/docs/index.html` was a fourth hand-written page listing the three.

They are now **content in the SPA**:

| Path | Role |
|---|---|
| `src/content/docs/<slug>.html` | the document body — the page's former `<main>` minus its footer: a sequence of `<section>`s, the first one `.cover`. Nothing else: no head, no styles, no chrome |
| `src/content/docs/manifest.json` | slug, language, kicker, card title/description/CTA, knowledge-pack title, measure. **The one place a document is registered** |
| `src/lib/docs.ts` | reads the manifest, bundles the bodies (`?raw`), throws at load if a row has no body (C-4); the legacy-URL and in-body-link helpers |
| `src/pages/Docs.tsx` | the index — `PageHero` + one `LinkCard` per manifest row |
| `src/pages/Doc.tsx` | one document — breadcrumb, the body injected as-is, a *Continue reading* pair of cards |
| `src/index.css` `.docs-prose` | the documents' class vocabulary (`cover`, `eyebrow`, `lede`, `card`, `layer`, `st`, `toc`, `voice`, …) painted with the public site's tokens |
| `public/docs/*.svg` | the founding story's two large figures stay static assets |

`workforce/scripts/build-board-knowledge.mjs` (the Q&A boards' knowledge
pack, ADR-0034) reads the same fragments and manifest, so adding a document
is one manifest row + one fragment and it reaches the index, the landing
page, the doc pages and the boards together.

## Why fragments, not JSX

The bodies are 1,700 lines of hand-written HTML with inline SVG figures,
tables and persona quotes, edited by content PRs (`content: 創業ストーリーに
「紙に描いた三枚」を追加`). Keeping them as HTML keeps those PRs a plain
text edit; converting to JSX would have meant rewriting every attribute,
splitting the SVG `<style>` blocks, and putting raw hex from the figures
under the R-2 token lint. A fragment is content; the design lives in one
stylesheet keyed on the vocabulary the documents already use.

The fragment is repo-authored and bundled at build time — the same trust
as any component — so `dangerouslySetInnerHTML` is the right tool, not a
risk. The SVG figures paint with `var(--accent)` / `var(--panel)` /
`var(--line)`; `.docs-prose` defines those names from the wf-* tokens.

## Navigation

- **Legacy URLs forward.** `/docs/index.html` → `/docs`,
  `/docs/<name>.html` → `/docs/<name>`. The S3 objects are gone (the deploy
  syncs `dist/` with `--delete`), so those requests hit CloudFront's 404
  fallback, load the SPA, and `pages/Doc.tsx` issues a replace-navigation.
  Bookmarks, older posts and the founding story's own footnotes keep working.
- **In-body links stay in the SPA.** A click on an anchor inside the body is
  routed through `navigate()` when it is same-origin, left-button,
  unmodified and not a same-page `#anchor` (`lib/docs.ts
  internalNavigationTarget`). The tables of contents rely on native hash
  scrolling; a deep link like `/docs/whitepaper#s7` scrolls to the section
  on mount.
- **Header/footer**: `PublicShell` carries **Docs** and **Research** as
  router links; the shell's footer has no rule above it.

## Not done here, on purpose

- **No dark theme.** The static pages had one; the console has none
  (DESIGN.md §Research "What is not here"). One design, one theme.
- **Indexability is unchanged for the SPA** — the console's `index.html`
  carries `noindex,nofollow`, which the docs now inherit (the static pages
  did not carry it). The reader site owns search presence; if the
  documents should be indexable, that is a one-line `index.html` decision
  for the operator, not a reason to keep a second design system.
- **Per-document `<title>` only** (set from the manifest); no OG tags, for
  the same reason as Research.
