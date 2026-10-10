// Web books — long-form Markdown read inside the console's public surface
// at /books, /books/:slug and /books/:slug/:chapterId.
//
// A book is content in the SPA, the same way the public documents are
// (lib/docs.ts): `src/content/books/<slug>/book.json` is the manifest,
// `chapters/NN-<id>.md` the bodies, `figures/*.svg` the inline figures.
// The on-disk contract is book-content-contract v1 (see the spec this
// surface was built from, mirrored in the module comments below).
//
// Bundling: manifests are tiny and eager (the shelf and the cover need
// them on first paint). Chapter bodies (≈120,000 characters per book) and
// figures are lazy `?raw` globs, so each lands in its own chunk and only
// the chapter being read is downloaded. A malformed manifest, or a
// manifest row naming a file that is not on disk, throws at module load
// (C-4): the shelf must never quietly list a book it cannot open.

export interface BookChapterMeta {
  /** URL segment: /books/<slug>/<id>. */
  id: string;
  /** Path relative to the book's directory: `chapters/NN-<id>.md`. */
  file: string;
  title: string;
  /** Short label above the title ("第一篇"). */
  kicker: string;
}

export interface BookPart {
  id: string;
  title: string;
  chapters: readonly BookChapterMeta[];
}

export interface BookMeta {
  slug: string;
  title: string;
  subtitle: string;
  lang: 'ja' | 'en';
  kicker: string;
  description: string;
  /** Persona slugs, rendered as plain text. */
  authors: readonly string[];
  version: string;
  updated: string;
  parts: readonly BookPart[];
}

/** A chapter with its place in the book (reading order). */
export interface FlatChapter extends BookChapterMeta {
  /** 0-based position in reading order. */
  index: number;
  part: { id: string; title: string };
}

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const CHAPTER_FILE_RE = /^chapters\/[^/]+\.md$/;

function str(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Validate one parsed book.json. `where` names the source in the error so
 * a broken content PR points at its own file. Throws on the first defect.
 */
export function validateBook(raw: unknown, where: string): BookMeta {
  const fail = (why: string): never => {
    throw new Error(`books: ${where}: ${why}`);
  };
  if (!raw || typeof raw !== 'object') fail('manifest is not an object');
  const m = raw as Record<string, unknown>;
  for (const key of ['slug', 'title', 'subtitle', 'kicker', 'description', 'version', 'updated'] as const) {
    if (!str(m[key])) fail(`"${key}" must be a non-empty string`);
  }
  if (!ID_RE.test(m.slug as string)) fail(`slug "${String(m.slug)}" is not URL-safe`);
  if (m.lang !== 'ja' && m.lang !== 'en') fail(`lang must be "ja" or "en"`);
  if (!Array.isArray(m.authors) || m.authors.length === 0 || !m.authors.every(str)) {
    fail('authors must be a non-empty array of persona slugs');
  }
  if (!Array.isArray(m.parts) || m.parts.length === 0) fail('parts must be a non-empty array');

  const seen = new Set<string>();
  const parts: BookPart[] = (m.parts as unknown[]).map((p, pi) => {
    const part = (p ?? {}) as Record<string, unknown>;
    if (!str(part.id) || !str(part.title)) fail(`parts[${pi}] needs id and title`);
    if (!Array.isArray(part.chapters) || part.chapters.length === 0) fail(`parts[${pi}] has no chapters`);
    const chapters = (part.chapters as unknown[]).map((c, ci) => {
      const ch = (c ?? {}) as Record<string, unknown>;
      const at = `parts[${pi}].chapters[${ci}]`;
      if (!str(ch.id) || !str(ch.file) || !str(ch.title) || !str(ch.kicker)) {
        fail(`${at} needs id, file, title and kicker`);
      }
      if (!ID_RE.test(ch.id as string)) fail(`${at} id "${String(ch.id)}" is not URL-safe`);
      if (!CHAPTER_FILE_RE.test(ch.file as string)) fail(`${at} file "${String(ch.file)}" must be chapters/<name>.md`);
      if (seen.has(ch.id as string)) fail(`duplicate chapter id "${String(ch.id)}"`);
      seen.add(ch.id as string);
      return { id: ch.id, file: ch.file, title: ch.title, kicker: ch.kicker } as BookChapterMeta;
    });
    return { id: part.id as string, title: part.title as string, chapters };
  });

  return {
    slug: m.slug as string,
    title: m.title as string,
    subtitle: m.subtitle as string,
    lang: m.lang as BookMeta['lang'],
    kicker: m.kicker as string,
    description: m.description as string,
    authors: m.authors as string[],
    version: m.version as string,
    updated: m.updated as string,
    parts,
  };
}

/** `../content/books/<slug>/…` → `<slug>`; null for any other shape. */
function slugOfKey(key: string): string | null {
  const m = /\/content\/books\/([^/]+)\//.exec(key);
  return m ? m[1] : null;
}

/** Glob key for a file inside a book's directory. */
function bookKey(slug: string, rel: string): string {
  return `../content/books/${slug}/${rel}`;
}

/** Build the shelf from the manifest glob: validate every row, require the
 *  directory name to equal the slug, order by slug for a stable shelf. */
export function loadManifests(modules: Record<string, unknown>): BookMeta[] {
  const books = Object.entries(modules).map(([key, raw]) => {
    const book = validateBook(raw, key);
    const dir = slugOfKey(key);
    if (dir !== book.slug) throw new Error(`books: ${key}: slug "${book.slug}" does not match its directory "${dir}"`);
    return book;
  });
  return books.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Every manifest chapter must name a bundled file. Throws naming the
 *  first missing one (a typo in book.json must not ship a dead chapter). */
export function assertChapterFiles(books: readonly BookMeta[], keys: Iterable<string>): void {
  const have = new Set(keys);
  for (const book of books) {
    for (const ch of flattenChapters(book)) {
      const key = bookKey(book.slug, ch.file);
      if (!have.has(key)) throw new Error(`books: "${book.slug}" chapter "${ch.id}" names ${ch.file}, which does not exist`);
    }
  }
}

// ── The bundle ────────────────────────────────────────────────────────────

const MANIFESTS = import.meta.glob('../content/books/*/book.json', { eager: true, import: 'default' });
const CHAPTER_LOADERS = import.meta.glob<string>('../content/books/*/chapters/*.md', {
  query: '?raw',
  import: 'default',
});
const FIGURE_LOADERS = import.meta.glob<string>('../content/books/*/figures/*.svg', {
  query: '?raw',
  import: 'default',
});

/** Every book, ordered by slug. */
export const BOOKS: readonly BookMeta[] = loadManifests(MANIFESTS);
assertChapterFiles(BOOKS, Object.keys(CHAPTER_LOADERS));

export function findBook(slug: string): BookMeta | undefined {
  return BOOKS.find(b => b.slug === slug);
}

export function bookPath(slug: string): string {
  return `/books/${encodeURIComponent(slug)}`;
}

export function chapterPath(slug: string, chapterId: string): string {
  return `${bookPath(slug)}/${encodeURIComponent(chapterId)}`;
}

/** Chapters in reading order, each carrying its part. */
export function flattenChapters(book: BookMeta): FlatChapter[] {
  const out: FlatChapter[] = [];
  for (const part of book.parts) {
    for (const ch of part.chapters) {
      out.push({ ...ch, index: out.length, part: { id: part.id, title: part.title } });
    }
  }
  return out;
}

export function findChapter(book: BookMeta, chapterId: string): FlatChapter | undefined {
  return flattenChapters(book).find(c => c.id === chapterId);
}

/** The chapters either side of `chapterId` in reading order (null at the
 *  ends, or both null for an unknown id). Crosses part boundaries. */
export function neighbours(
  book: BookMeta,
  chapterId: string,
): { prev: FlatChapter | null; next: FlatChapter | null } {
  const flat = flattenChapters(book);
  const i = flat.findIndex(c => c.id === chapterId);
  if (i < 0) return { prev: null, next: null };
  return { prev: flat[i - 1] ?? null, next: flat[i + 1] ?? null };
}

// Loaded bodies are memoised by key so the cover's reading-time pass and
// the chapter view share one download.
const chapterCache = new Map<string, Promise<string>>();

/** A chapter's Markdown. Rejects (never resolves empty) when the file is
 *  missing or blank — the page turns that into a visible error (C-4). */
export function loadChapter(book: BookMeta, chapter: BookChapterMeta): Promise<string> {
  const key = bookKey(book.slug, chapter.file);
  let p = chapterCache.get(key);
  if (!p) {
    const loader = CHAPTER_LOADERS[key];
    p = loader
      ? loader().then(body => {
          if (!body || !body.trim()) throw new Error(`books: chapter "${chapter.id}" (${chapter.file}) is empty`);
          return body;
        })
      : Promise.reject(new Error(`books: chapter "${chapter.id}" (${chapter.file}) is not bundled`));
    // A failed load is not cached, so a retry (a re-mount) tries again.
    p.catch(() => chapterCache.delete(key));
    chapterCache.set(key, p);
  }
  return p;
}

/**
 * Normalise a figure reference written in a chapter to `figures/<name>.svg`.
 * The contract writes `figures/x.svg` (relative to the book); a path
 * relative to the chapter file (`../figures/x.svg`) is accepted too.
 * Anything that leaves `figures/` returns null.
 */
export function figureRelPath(src: string): string | null {
  const rel = src.replace(/^\.\//, '').replace(/^\.\.\//, '');
  return /^figures\/[^/]+\.svg$/.test(rel) ? rel : null;
}

const figureCache = new Map<string, string>();

/** A figure's SVG source, from the lazy glob. */
export async function loadFigure(book: BookMeta, relPath: string): Promise<string> {
  const rel = figureRelPath(relPath);
  if (!rel) throw new Error(`books: figure "${relPath}" must live under figures/ and end in .svg`);
  const key = bookKey(book.slug, rel);
  const hit = figureCache.get(key);
  if (hit !== undefined) return hit;
  const loader = FIGURE_LOADERS[key];
  if (!loader) throw new Error(`books: figure ${rel} does not exist in "${book.slug}"`);
  const svg = await loader();
  figureCache.set(key, svg);
  return svg;
}

/** A figure already loaded (or null). Lets the chapter view render its
 *  figures synchronously once preloaded, so a restored scroll position
 *  is not pushed around by figures arriving late. */
export function peekFigure(book: BookMeta, relPath: string): string | null {
  const rel = figureRelPath(relPath);
  return rel ? (figureCache.get(bookKey(book.slug, rel)) ?? null) : null;
}

/** The `.svg` image sources a chapter references, in order. */
export function figureRefs(markdown: string): string[] {
  const out: string[] = [];
  const re = /!\[[^\]]*\]\(\s*([^)\s]+\.svg)\s*(?:"[^"]*")?\)/g;
  for (let m = re.exec(markdown); m; m = re.exec(markdown)) out.push(m[1]);
  return out;
}

// ── Reading time ─────────────────────────────────────────────────────────

/** Japanese reading speed the contract fixes: characters per minute. */
export const CHARS_PER_MINUTE = 600;

/**
 * Characters a reader actually reads. A rough heuristic, not a parser:
 * fence lines and the fenced blocks' `key:` labels (原文: / 訓読: / title:)
 * go, images go (their alt is a caption, read in a glance), link targets
 * go but link text stays, Markdown punctuation (# * _ ` > | ~ list
 * markers, table rules) goes, and all whitespace goes. Counted by code
 * point so a surrogate pair is one character.
 */
export function visibleChars(markdown: string): number {
  const text = markdown
    .replace(/^\s*(```|~~~).*$/gm, '')
    .replace(/^\s*(原文|訓読|出典|訳|title)\s*[:：]/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, '')
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[#*_`>|~]/g, '')
    .replace(/\s+/g, '');
  return Array.from(text).length;
}

/** Estimated minutes to read a chapter: visible characters ÷ 600, at least 1. */
export function estimateMinutes(markdown: string): number {
  return Math.max(1, Math.round(visibleChars(markdown) / CHARS_PER_MINUTE));
}
