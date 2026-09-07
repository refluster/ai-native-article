// Research corpus — the article set the reader site publishes, read by
// this console at runtime (see config/research.ts for why it is fetched
// cross-origin rather than bundled).
//
// The shapes here mirror newsletter/app/src/types/article.ts and the
// helpers in newsletter/app/src/lib/{article-types,source-links,byline}.ts.
// They are duplicated rather than imported because the two SPAs are
// separate workspaces that build for different origins (same precedent as
// MermaidBlock and types/project.ts); the manifest JSON is the contract.

import {
  RESEARCH_CANONICAL_ARTICLE_BASE,
  RESEARCH_CORPUS_BASE,
  RESEARCH_LANGUAGE_STORAGE_KEY,
} from '../config/research';

// ─── types ────────────────────────────────────────────────────────────

export type ResearchType = 'explanation' | 'analysis';

export type ResearchLanguage = 'ja' | 'en';

/** One row of `posts/manifest.json`. Field notes live on the reader side
 *  (newsletter/app/src/types/article.ts); optional fields are optional
 *  there for the same rollout reasons. */
export interface ResearchArticleMeta {
  slug: string;
  title: string;
  type?: ResearchType;
  category?: string;
  tags?: string[];
  /** @deprecated pre-rename name of `tags`; read fallback only. */
  categoriesMulti?: string[];
  date: string;
  abstract: string;
  titleEn?: string;
  abstractEn?: string;
  hasEn?: boolean;
  image?: string;
  /** Comma-separated source URLs: one for an explanation, many for an analysis. */
  sourceUrls?: string;
  /** Persona slug(s), comma-separated; `anonymous` for unnamed narrators. */
  author?: string;
  spotifyUrl?: string;
}

/** Frontmatter of a fetched `<slug>.md` / `<slug>.en.md`. */
export interface ResearchFrontmatter extends Partial<ResearchArticleMeta> {
  notionId?: string;
  lang?: string;
}

export interface ResearchArticleBody {
  meta: ResearchFrontmatter;
  content: string;
  /** Edition actually served — `ja` when English was asked for but the
   *  article has no EN child page yet (ADR-0005 rollout). */
  servedLanguage: ResearchLanguage;
}

// ─── manifest helpers ─────────────────────────────────────────────────

/** Older manifest rows predate the L2/L3 split; they were all analyses. */
export function inferType(meta: Pick<ResearchArticleMeta, 'type'>): ResearchType {
  return meta.type ?? 'analysis';
}

export function isResearchType(v: unknown): v is ResearchType {
  return v === 'explanation' || v === 'analysis';
}

/** Strip the retired `A:`–`E:` bucket prefix a few older tags still carry. */
export function displayTag(name: string): string {
  return name.replace(/^[A-E][:：]\s*/, '');
}

/** Raw tag names (filter keys). `tags` → `categoriesMulti` → `category`. */
export function tagsOf(a: Pick<ResearchArticleMeta, 'tags' | 'categoriesMulti' | 'category'>): string[] {
  const t = a.tags ?? a.categoriesMulti;
  if (t && t.length > 0) return t;
  return a.category ? [a.category] : [];
}

export function localizedTitle(a: Pick<ResearchArticleMeta, 'title' | 'titleEn'>, lang: ResearchLanguage): string {
  if (lang === 'en' && a.titleEn) return a.titleEn;
  return a.title;
}

export function localizedAbstract(
  a: Pick<ResearchArticleMeta, 'abstract' | 'abstractEn'>,
  lang: ResearchLanguage,
): string {
  if (lang === 'en' && a.abstractEn) return a.abstractEn;
  return a.abstract;
}

/** Newest first; ties broken by slug so pagination is stable. */
export function sortNewestFirst(rows: ResearchArticleMeta[]): ResearchArticleMeta[] {
  return [...rows].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.slug.localeCompare(b.slug));
}

/** The Notion Author column is free text; multi-author rows are
 *  comma-separated slugs ("priya, celeste"). */
export function parseAuthorSlugs(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/** Console route for an article. */
export function researchPath(slug: string): string {
  return `/research/${encodeURIComponent(slug)}`;
}

/** The reader site's URL for the same article (the canonical edition). */
export function canonicalArticleUrl(slug: string, lang?: ResearchLanguage): string {
  const base = `${RESEARCH_CANONICAL_ARTICLE_BASE}${encodeURIComponent(slug)}`;
  return lang ? `${base}?lang=${lang}` : base;
}

/**
 * Resolve a corpus-relative asset reference to an absolute URL.
 *
 * Bodies and `image` fields are written for the reader site, where the
 * posts live under its own origin: hero paths look like
 * `/ai-native-article/posts/images/x.jpg` or `posts/images/x.jpg`, and
 * inline markdown images may be `images/x.jpg`. All of those have to point
 * at the corpus origin here, not at this console's S3 bucket. Absolute
 * URLs and data: URIs pass through untouched.
 */
export function resolveCorpusUrl(ref: string, base: string = RESEARCH_CORPUS_BASE): string {
  const trimmed = ref.trim();
  if (trimmed === '') return trimmed;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(trimmed)) return trimmed;
  const idx = trimmed.indexOf('/posts/');
  if (idx !== -1) return `${base}${trimmed.slice(idx + '/posts/'.length)}`;
  if (trimmed.startsWith('posts/')) return `${base}${trimmed.slice('posts/'.length)}`;
  return `${base}${trimmed.replace(/^\.?\/+/, '')}`;
}

// ─── frontmatter ──────────────────────────────────────────────────────

/**
 * Split the L4 export's frontmatter block from the markdown body.
 *
 * The exporter writes one `key: "value"` per line, except `abstract`,
 * whose quoted value can span lines (it is the first paragraphs of the
 * body). Same grammar the reader uses (newsletter/app/src/pages/Article.tsx);
 * a body without a block is returned whole with empty meta.
 */
export function parseFrontmatter(raw: string): { meta: ResearchFrontmatter; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) continue;
    meta[key] = line.slice(idx + 1).trim().replace(/^"(.*)"$/, '$1');
  }
  return { meta: meta as ResearchFrontmatter, content: match[2].trim() };
}

// ─── source index (analysis ⇄ explanation cross-links) ────────────────

export interface SourceEntry {
  url: string;
  rawUrl: string;
  explanation?: ResearchArticleMeta;
  analyses: ResearchArticleMeta[];
}

export type SourceIndex = Map<string, SourceEntry>;

const TRACKING_PREFIXES = ['utm_', 'syn-'];
const TRACKING_EXACT = new Set(['fbclid', 'gclid', 'ref', 'mc_cid', 'mc_eid']);

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    const u = new URL(trimmed);
    u.hash = '';
    u.host = u.host.toLowerCase();
    for (const key of [...u.searchParams.keys()]) {
      const k = key.toLowerCase();
      if (TRACKING_EXACT.has(k) || TRACKING_PREFIXES.some(p => k.startsWith(p))) u.searchParams.delete(key);
    }
    let out = u.toString();
    if (out.endsWith('/') && u.pathname !== '/') out = out.slice(0, -1);
    return out;
  } catch {
    return trimmed.toLowerCase().replace(/#.*$/, '').replace(/\/+$/, '');
  }
}

export function parseSourceUrls(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\n]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Index every source URL in the manifest: which explanation covers it and
 * which analyses cite it. An analysis page lists its sources with a link
 * to the explanation (the fact-check "back drawer"); an explanation page
 * lists the analyses that used it.
 */
export function buildSourceIndex(rows: ResearchArticleMeta[]): SourceIndex {
  const index: SourceIndex = new Map();
  const ensure = (raw: string): SourceEntry => {
    const key = normalizeUrl(raw);
    let entry = index.get(key);
    if (!entry) {
      entry = { url: key, rawUrl: raw, analyses: [] };
      index.set(key, entry);
    }
    return entry;
  };
  for (const row of rows) {
    const urls = parseSourceUrls(row.sourceUrls);
    if (urls.length === 0) continue;
    if (inferType(row) === 'explanation') {
      const entry = ensure(urls[0]);
      if (!entry.explanation) entry.explanation = row;
    } else {
      for (const u of urls) ensure(u).analyses.push(row);
    }
  }
  return index;
}

export function lookupSource(index: SourceIndex, raw: string): SourceEntry | undefined {
  return index.get(normalizeUrl(raw));
}

// ─── language ─────────────────────────────────────────────────────────

export function isResearchLanguage(v: unknown): v is ResearchLanguage {
  return v === 'ja' || v === 'en';
}

/**
 * Which edition to show. `?lang=` wins (shareable), then the stored
 * choice, then the browser's preference list, then Japanese — the corpus
 * is written Japanese-first, and 'ja' is also what the reader site
 * defaults to. Never a route: the slug is the article's identity on both
 * surfaces.
 */
export function resolveLanguage(
  search: string,
  storage: Pick<Storage, 'getItem'> | undefined,
  navigatorLanguages: readonly string[],
): ResearchLanguage {
  const fromQuery = new URLSearchParams(search).get('lang');
  if (isResearchLanguage(fromQuery)) return fromQuery;
  try {
    const stored = storage?.getItem(RESEARCH_LANGUAGE_STORAGE_KEY);
    if (isResearchLanguage(stored)) return stored;
  } catch {
    /* Safari private mode throws on access — treat as unset */
  }
  for (const tag of navigatorLanguages) {
    const primary = tag.toLowerCase().split('-')[0];
    if (primary === 'ja' || primary === 'en') return primary;
  }
  return 'ja';
}

export function storeLanguage(lang: ResearchLanguage, storage: Pick<Storage, 'setItem'> | undefined): void {
  try {
    storage?.setItem(RESEARCH_LANGUAGE_STORAGE_KEY, lang);
  } catch {
    /* storage unavailable — the choice still applies for this page */
  }
}

// ─── fetchers ─────────────────────────────────────────────────────────

let manifestCache: Promise<ResearchArticleMeta[]> | null = null;

/** The whole corpus index, newest first. Memoised per page load; a failed
 *  load clears the cache so the next navigation retries (C-4). */
export function fetchResearchManifest(): Promise<ResearchArticleMeta[]> {
  if (!manifestCache) {
    manifestCache = fetch(`${RESEARCH_CORPUS_BASE}manifest.json`)
      .then(res => {
        if (!res.ok) throw new Error(`research manifest: HTTP ${res.status}`);
        return res.json() as Promise<ResearchArticleMeta[]>;
      })
      .then(rows => {
        if (!Array.isArray(rows)) throw new Error('research manifest: not an array');
        return sortNewestFirst(rows);
      })
      .catch(err => {
        manifestCache = null;
        throw err;
      });
  }
  return manifestCache;
}

/**
 * One article body in the requested edition. `<slug>.en.md` exists only
 * for rows with an EN child page, so a 404 on the English file is the
 * ordinary "not translated yet" case: fall back to Japanese and report
 * which edition was served so the page can say so. A missing Japanese
 * file is a real 404.
 */
export async function fetchResearchBody(slug: string, lang: ResearchLanguage): Promise<ResearchArticleBody> {
  const safe = encodeURIComponent(slug);
  if (lang === 'en') {
    const en = await fetch(`${RESEARCH_CORPUS_BASE}${safe}.en.md`);
    if (en.ok) {
      const { meta, content } = parseFrontmatter(await en.text());
      return { meta, content, servedLanguage: 'en' };
    }
  }
  const ja = await fetch(`${RESEARCH_CORPUS_BASE}${safe}.md`);
  if (!ja.ok) throw new Error(`research body: HTTP ${ja.status}`);
  const { meta, content } = parseFrontmatter(await ja.text());
  return { meta, content, servedLanguage: 'ja' };
}
