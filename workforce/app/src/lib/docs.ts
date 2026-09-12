// Public documents — the whitepaper, the founding story and the manifesto,
// rendered by the SPA at /docs/:slug.
//
// The documents are HTML fragments under src/content/docs/ (one `<section>`
// sequence each, nothing else) painted through the `.docs-prose`
// stylesheet in index.css. They used to be standalone pages under
// public/docs/ with their own typography and chrome; moving the body into
// the SPA and the styling into tokens is what makes Docs, Research and
// the landing page one site.
//
// `manifest.json` beside the fragments is the one place a document's
// metadata lives: this module reads it for the SPA, and
// workforce/scripts/build-board-knowledge.mjs reads the same file to build
// the Q&A boards' knowledge pack (ADR-0034), so a new document is added in
// one place and reaches both.
//
// This module is metadata only (the landing page and the Docs index need
// nothing more). The bodies — ~170 KB of HTML — live in docs-bodies.ts,
// which only pages/Doc.tsx imports, and that page is lazy-loaded from
// App.tsx so the console's main bundle does not carry them.

import manifest from '../content/docs/manifest.json';

export interface PublicDocMeta {
  slug: string;
  file: string;
  lang: 'en' | 'ja';
  /** Mono label above the title on cards ("Technical whitepaper"). */
  kicker: string;
  /** Title as shown on cards — the document's claim, not its type. */
  title: string;
  description: string;
  /** Call-to-action line on the Docs index card. */
  cta: string;
  /** Title used for `document.title` and by the boards knowledge pack. */
  packTitle: string;
  /** `narrow` (820px, the manifesto's air) or `wide` (the shell column). */
  measure: 'narrow' | 'wide';
}

function isLang(v: unknown): v is PublicDocMeta['lang'] {
  return v === 'en' || v === 'ja';
}
function isMeasure(v: unknown): v is PublicDocMeta['measure'] {
  return v === 'narrow' || v === 'wide';
}

/** Every public document, in index order. A malformed manifest row is a
 *  build defect and throws at module load (C-4): the Docs index must never
 *  quietly list fewer documents. */
export const PUBLIC_DOCS: readonly PublicDocMeta[] = (manifest as unknown[]).map(raw => {
  const m = raw as Partial<PublicDocMeta>;
  if (
    !m.slug ||
    !m.file ||
    !isLang(m.lang) ||
    !isMeasure(m.measure) ||
    !m.kicker ||
    !m.title ||
    !m.description ||
    !m.cta ||
    !m.packTitle
  ) {
    throw new Error(`docs manifest: malformed row ${JSON.stringify(raw)}`);
  }
  return m as PublicDocMeta;
});

export function findDoc(slug: string): PublicDocMeta | undefined {
  return PUBLIC_DOCS.find(d => d.slug === slug);
}

export function docPath(slug: string): string {
  return `/docs/${encodeURIComponent(slug)}`;
}

/**
 * Where a pre-SPA docs URL should go. The documents were S3 objects at
 * `/docs/<name>.html` (and `/docs/index.html`); those links exist in
 * bookmarks, posts and the founding story's own footnotes, so the router
 * forwards them rather than 404ing. Returns null for a slug that is not a
 * legacy spelling.
 */
export function legacyDocRedirect(slug: string): string | null {
  if (!slug.endsWith('.html')) return null;
  const bare = slug.slice(0, -'.html'.length);
  return bare === 'index' || bare === '' ? '/docs' : docPath(bare);
}

/**
 * For a click inside an injected document body: the in-app path to
 * navigate to, or null when the browser should handle the click itself
 * (another origin, a new tab, a download, a modifier key, or a same-page
 * `#anchor` — the table of contents relies on native hash scrolling).
 */
export function internalNavigationTarget(
  anchor: Pick<HTMLAnchorElement, 'href' | 'target' | 'hasAttribute'>,
  current: { origin: string; pathname: string },
  modifiers: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number },
): string | null {
  if (modifiers.button !== 0 || modifiers.metaKey || modifiers.ctrlKey || modifiers.shiftKey || modifiers.altKey) return null;
  if (anchor.target && anchor.target !== '_self') return null;
  if (anchor.hasAttribute('download')) return null;
  let url: URL;
  try {
    url = new URL(anchor.href, current.origin);
  } catch {
    return null;
  }
  if (url.origin !== current.origin) return null;
  if (url.pathname === current.pathname && url.hash) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
