// Research surface — where the workforce console reads the article corpus.
//
// The articles shown under /research are the SAME corpus the reader site
// publishes at https://kohuehara.xyz/ai-native-article/. They are
// Notion-authored (C-2) and exported to gh-pages by
// deploy-article-site.yml; that export is the one derived copy (W-2: no
// second source of truth), so this console reads it at runtime over CORS
// (GitHub Pages answers `access-control-allow-origin: *`) instead of
// bundling or re-exporting the posts into its own S3 origin. Both surfaces
// therefore show identical content at all times; only the chrome differs.
//
// `VITE_RESEARCH_CORPUS_BASE` lets a dev build point at a local
// `newsletter/app` dev server (`http://localhost:5173/ai-native-article/posts/`)
// or a preview deploy. It is a URL prefix ending in `/`.

const env = import.meta.env.VITE_RESEARCH_CORPUS_BASE ?? '';

/** Prefix under which `manifest.json`, `<slug>.md`, `<slug>.en.md` and
 *  `images/` are served. Always ends with `/`. */
export const RESEARCH_CORPUS_BASE: string =
  env.length > 0
    ? env.endsWith('/')
      ? env
      : `${env}/`
    : 'https://kohuehara.xyz/ai-native-article/posts/';

/** The reader site's article URL prefix. Every /research/:slug page links
 *  back here as the canonical edition while both surfaces publish. */
export const RESEARCH_CANONICAL_ARTICLE_BASE = 'https://kohuehara.xyz/ai-native-article/article/';

/** Manifest entries per index page. */
export const RESEARCH_PAGE_SIZE = 12;

/** Tags shown before the "all tags" toggle on the index. */
export const RESEARCH_TOP_TAGS = 8;

/** localStorage key for the reader's edition choice. Same key name the
 *  reader site uses (`newsletter/app/src/i18n/language.ts`) — storage is
 *  per-origin so nothing is shared, but one name keeps the two readers'
 *  behaviour easy to reason about. */
export const RESEARCH_LANGUAGE_STORAGE_KEY = 'kohuehara.lang';
