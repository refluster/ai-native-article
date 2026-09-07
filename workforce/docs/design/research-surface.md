# Research surface — design and data notes

- **Status**: Implemented 2026-09-06 (this PR); design rules in
  [`../../DESIGN.md` §Research](../../DESIGN.md#research-the-reading-surface)
- **Routes**: `/research` (index), `/research/:slug` (article) — public,
  outside `AuthBoundary`, linked from the landing header beside **Docs**
- **Reader IA**: [`docs/adr/adr-0002-daily-use-reader-ia.md`](../../../docs/adr/adr-0002-daily-use-reader-ia.md)
  (analysis-default list, flat tags, explanations as the back drawer);
  editions per [`docs/adr/adr-0005-bilingual-article-editions.md`](../../../docs/adr/adr-0005-bilingual-article-editions.md)

## Why the console reads the reader site's export

The articles are authored in Notion (root **C-2**) and exported to
gh-pages on every run of `deploy-article-site.yml`. That export —
`posts/manifest.json`, `<slug>.md`, `<slug>.en.md`, `images/` — is the one
derived copy. Copying it again into this console's S3 origin would create
a second export with its own staleness (the two deploys have different
triggers and crons), which **W-2** forbids. So the console fetches the
gh-pages export at runtime over CORS: GitHub Pages answers every request
with `access-control-allow-origin: *`, and the manifest is ~40 KB.

Consequences, stated:

- **Identical content, always.** Whatever a reader sees at
  `kohuehara.xyz/ai-native-article/article/<slug>` is what `/research/<slug>`
  renders. A Notion edit reaches both at the same moment (the next
  article-site deploy).
- **The reader site is a runtime dependency.** If gh-pages is down or
  serving a broken build (an R-17 failure), `/research` shows a loud error
  card naming the corpus origin, never a stale copy (W-4 / C-4). The rest
  of the console is unaffected.
- **No new deploy trigger.** `deploy-workforce-console.yml` is unchanged;
  the console does not need to rebuild when an article lands.
- **Canonical URL stays on the reader site** while both surfaces publish.
  Every article page links it; `/research` sets no `<link rel=canonical>`
  of its own because the SPA's `index.html` is shared by every route.

`VITE_RESEARCH_CORPUS_BASE` (see `src/config/research.ts`) points a dev
build at a local corpus, e.g. the newsletter dev server
(`http://localhost:5173/ai-native-article/posts/`) or any static server
that sends the CORS header.

## Files

| Path | Role |
|---|---|
| `src/config/research.ts` | corpus base, canonical article base, page size, storage key |
| `src/lib/research.ts` | manifest/body fetchers, frontmatter grammar, tag + edition helpers, the analysis ⇄ explanation source index (ported from the reader's `source-links.ts`) |
| `src/lib/useResearchLanguage.ts` | `?lang=` → localStorage → browser → `ja` |
| `src/components/PublicShell.tsx` | header/footer for public pages (landing + research) and the sign-in state hook |
| `src/components/research/ResearchCard.tsx` | index card |
| `src/components/research/LanguageToggle.tsx` | JA / EN pill |
| `src/components/research/AuthorByline.tsx` | Sigil portrait + name + role from the live roster |
| `src/pages/Research.tsx`, `src/pages/ResearchArticle.tsx` | the two routes |
| `src/index.css` `.research-prose` | long-form typography, applied through `wf-*` tokens |

## Not done here, on purpose

- **GlobalNav** (the signed-in header) does not carry Research. Nine
  destinations already overflowed a phone header once; a public surface
  is reachable from the landing page and the footer. Revisit if operators
  ask for it.
- **Per-article SEO** (`<title>` is set; no OG/canonical tags). The SPA
  shell is shared and the reader site already owns search presence.
- **Reading analytics** beyond the console's page-view tracking. The
  reader site keeps the scroll-depth funnel GROWTH.md measures.
