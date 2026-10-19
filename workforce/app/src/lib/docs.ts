// Public documents — the capabilities account, the whitepaper, the founding
// story, the manifesto, the book production process and the asp-cloud
// development review, rendered by the SPA at /docs/:slug in two editions
// (Japanese and English).
//
// The documents are HTML fragments under src/content/docs/ (one `<section>`
// sequence each, nothing else) painted through the `.docs-prose`
// stylesheet in index.css. They used to be standalone pages under
// public/docs/ with their own typography and chrome; moving the body into
// the SPA and the styling into tokens is what makes Docs, Research and
// the landing page one site.
//
// Every document exists in both languages: `<slug>.ja.html` and
// `<slug>.en.html`, one written first (`original`) and the other a
// translation of it. Which edition a reader sees is resolved exactly as the
// Research surface resolves an article edition — `?lang=` → localStorage →
// browser preference → `ja` (lib/research.ts resolveLanguage, ADR-0005) —
// so the same JA / EN pill switches both surfaces. The slug is the
// document's identity; the edition is never a route.
//
// `manifest.json` beside the fragments is the one place a document's
// metadata lives: this module reads it for the SPA, and
// workforce/scripts/build-board-knowledge.mjs reads the same file to build
// the Q&A boards' knowledge pack (ADR-0034) from the original edition, so
// a new document is added in one place and reaches both.
//
// This module is metadata only (the landing page and the Docs index need
// nothing more). The bodies — ~1 MB of HTML across both editions — live in
// docs-bodies.ts, which only pages/Doc.tsx imports, and that page is
// lazy-loaded from App.tsx so the console's main bundle does not carry them.

import manifest from '../content/docs/manifest.json';
import { isResearchLanguage, type ResearchLanguage } from './research';

/** The two editions every public document has. Same type as the Research
 *  surface's, on purpose: one reader preference drives both. */
export type DocLanguage = ResearchLanguage;

export const DOC_LANGUAGES: readonly DocLanguage[] = ['ja', 'en'];

/** One edition of a document: its body file and the words the cards and
 *  the breadcrumb show for it. */
export interface PublicDocEdition {
  file: string;
  /** Mono label above the title on cards ("Technical whitepaper"). */
  kicker: string;
  /** Title as shown on cards — the document's claim, not its type. */
  title: string;
  description: string;
  /** Call-to-action line on the Docs index card. */
  cta: string;
  /** Title used for `document.title` and by the boards knowledge pack. */
  packTitle: string;
}

export interface PublicDocMeta {
  slug: string;
  /** The language the document was written in; the other edition is a
   *  translation. The boards knowledge pack reads this edition. */
  original: DocLanguage;
  /** `narrow` (820px, the manifesto's air) or `wide` (the shell column). */
  measure: 'narrow' | 'wide';
  editions: Record<DocLanguage, PublicDocEdition>;
}

function isLang(v: unknown): v is DocLanguage {
  return v === 'en' || v === 'ja';
}
function isMeasure(v: unknown): v is PublicDocMeta['measure'] {
  return v === 'narrow' || v === 'wide';
}
function isEdition(v: unknown): v is PublicDocEdition {
  const e = v as Partial<PublicDocEdition> | null;
  return Boolean(e && e.file && e.kicker && e.title && e.description && e.cta && e.packTitle);
}

/** Every public document, in index order. A malformed manifest row — or a
 *  row missing either edition — is a build defect and throws at module
 *  load (C-4): the Docs index must never quietly list fewer documents, and
 *  a reader must never be handed a document that has no body in the
 *  edition they chose. */
export const PUBLIC_DOCS: readonly PublicDocMeta[] = (manifest as unknown[]).map(raw => {
  const m = raw as Partial<PublicDocMeta>;
  if (
    !m.slug ||
    !isLang(m.original) ||
    !isMeasure(m.measure) ||
    !m.editions ||
    !DOC_LANGUAGES.every(lang => isEdition(m.editions?.[lang]))
  ) {
    throw new Error(`docs manifest: malformed row ${JSON.stringify(raw)}`);
  }
  return m as PublicDocMeta;
});

export function findDoc(slug: string): PublicDocMeta | undefined {
  return PUBLIC_DOCS.find(d => d.slug === slug);
}

/** The edition of a document in the reader's language. Every document has
 *  both, so this never falls back. */
export function docEdition(doc: PublicDocMeta, lang: DocLanguage): PublicDocEdition {
  return doc.editions[lang];
}

/**
 * The `?lang=` to carry from the current URL onto the next Docs link, or
 * '' when the URL names no edition. A shared link with `?lang=en` must
 * keep its edition across cards, breadcrumbs and in-body links — without
 * this the next page would fall back to the receiver's stored choice and
 * the edition would change under them (the design note's most likely
 * failure). Nothing is carried when the URL carries nothing: the stored
 * or browser preference then resolves each page the same way.
 */
export function editionQuery(search: string): string {
  const lang = new URLSearchParams(search).get('lang');
  return isResearchLanguage(lang) ? `?lang=${lang}` : '';
}

/** Add the current URL's `?lang=` to an in-app target that does not name
 *  one itself. The target may carry its own query and `#hash`. */
export function withEdition(to: string, search: string): string {
  const carry = editionQuery(search);
  if (!carry) return to;
  const hashAt = to.indexOf('#');
  const hash = hashAt === -1 ? '' : to.slice(hashAt);
  const beforeHash = hashAt === -1 ? to : to.slice(0, hashAt);
  const queryAt = beforeHash.indexOf('?');
  const path = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  const params = new URLSearchParams(queryAt === -1 ? '' : beforeHash.slice(queryAt + 1));
  if (!params.has('lang')) params.set('lang', carry.slice('?lang='.length));
  const query = params.toString();
  return `${path}${query ? `?${query}` : ''}${hash}`;
}

/** Console route for a document, carrying the current URL's edition. */
export function docPath(slug: string, search = ''): string {
  return withEdition(`/docs/${encodeURIComponent(slug)}`, search);
}

/** The Docs index, carrying the current URL's edition. */
export function docsIndexPath(search = ''): string {
  return withEdition('/docs', search);
}

/**
 * Where a pre-SPA docs URL should go. The documents were S3 objects at
 * `/docs/<name>.html` (and `/docs/index.html`); those links exist in
 * bookmarks, posts and the founding story's own footnotes, so the router
 * forwards them rather than 404ing, keeping the query (`?lang=`) and the
 * `#hash` so a shared `…/founding-story.html?lang=en#s3` lands on that
 * edition and section. Returns null for a slug that is not a legacy
 * spelling.
 */
export function legacyDocRedirect(slug: string, search = '', hash = ''): string | null {
  if (!slug.endsWith('.html')) return null;
  const bare = slug.slice(0, -'.html'.length);
  const path = bare === 'index' || bare === '' ? '/docs' : `/docs/${encodeURIComponent(bare)}`;
  return `${path}${search}${hash}`;
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
