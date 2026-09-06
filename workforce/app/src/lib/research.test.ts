// Unit tests for the research corpus helpers. The manifest JSON is the
// contract with the reader site; these pin the parts of it this console
// interprets (frontmatter grammar, tag fallbacks, asset resolution, the
// analysis ⇄ explanation cross-link index, edition resolution).

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildSourceIndex,
  canonicalArticleUrl,
  displayTag,
  fetchResearchBody,
  inferType,
  localizedAbstract,
  localizedTitle,
  lookupSource,
  normalizeUrl,
  parseFrontmatter,
  parseAuthorSlugs,
  resolveCorpusUrl,
  resolveLanguage,
  sortNewestFirst,
  tagsOf,
  type ResearchArticleMeta,
} from './research';

const row = (over: Partial<ResearchArticleMeta>): ResearchArticleMeta => ({
  slug: 'x',
  title: 'T',
  date: '2026-01-01',
  abstract: 'A',
  ...over,
});

describe('manifest helpers', () => {
  it('defaults a typeless row to analysis', () => {
    expect(inferType({})).toBe('analysis');
    expect(inferType({ type: 'explanation' })).toBe('explanation');
  });

  it('strips the retired A–E bucket prefix for display only', () => {
    expect(displayTag('C: New Roles / FDE')).toBe('New Roles / FDE');
    expect(displayTag('A：AI Hyper-productivity')).toBe('AI Hyper-productivity');
    expect(displayTag('生成AI活用 × 組織変革')).toBe('生成AI活用 × 組織変革');
  });

  it('reads tags, then the deprecated categoriesMulti, then category', () => {
    expect(tagsOf({ tags: ['a'], categoriesMulti: ['b'], category: 'c' })).toEqual(['a']);
    expect(tagsOf({ categoriesMulti: ['b'], category: 'c' })).toEqual(['b']);
    expect(tagsOf({ tags: [], category: 'c' })).toEqual(['c']);
    expect(tagsOf({})).toEqual([]);
  });

  it('serves the English title/abstract only when present, else Japanese', () => {
    const a = row({ title: 'ja', titleEn: 'en', abstract: 'ja-abs' });
    expect(localizedTitle(a, 'en')).toBe('en');
    expect(localizedTitle(a, 'ja')).toBe('ja');
    expect(localizedAbstract(a, 'en')).toBe('ja-abs');
  });

  it('sorts newest first with a stable slug tiebreak', () => {
    const sorted = sortNewestFirst([
      row({ slug: 'b', date: '2026-01-01' }),
      row({ slug: 'c', date: '2026-03-01' }),
      row({ slug: 'a', date: '2026-01-01' }),
    ]);
    expect(sorted.map(r => r.slug)).toEqual(['c', 'a', 'b']);
  });

  it('splits comma-separated author slugs', () => {
    expect(parseAuthorSlugs('priya, celeste ,dario')).toEqual(['priya', 'celeste', 'dario']);
    expect(parseAuthorSlugs(undefined)).toEqual([]);
  });

  it('links to the canonical reader edition', () => {
    expect(canonicalArticleUrl('c9197f05fbf0')).toBe(
      'https://kohuehara.xyz/ai-native-article/article/c9197f05fbf0',
    );
    expect(canonicalArticleUrl('c9197f05fbf0', 'en')).toMatch(/\?lang=en$/);
  });
});

describe('resolveCorpusUrl', () => {
  const base = 'https://corpus.example/posts/';
  it('re-roots reader-site hero paths onto the corpus origin', () => {
    expect(resolveCorpusUrl('/ai-native-article/posts/images/x.jpg', base)).toBe(`${base}images/x.jpg`);
    expect(resolveCorpusUrl('posts/images/x.jpg', base)).toBe(`${base}images/x.jpg`);
    expect(resolveCorpusUrl('images/x.jpg', base)).toBe(`${base}images/x.jpg`);
    expect(resolveCorpusUrl('./images/x.jpg', base)).toBe(`${base}images/x.jpg`);
  });
  it('leaves absolute and data URLs alone', () => {
    expect(resolveCorpusUrl('https://cdn.example/a.png', base)).toBe('https://cdn.example/a.png');
    expect(resolveCorpusUrl('//cdn.example/a.png', base)).toBe('//cdn.example/a.png');
    expect(resolveCorpusUrl('data:image/png;base64,AAAA', base)).toBe('data:image/png;base64,AAAA');
  });
});

describe('parseFrontmatter', () => {
  it('reads one-line keys and keeps the body', () => {
    const raw = '---\ntitle: "Hello"\ntype: "analysis"\ndate: "2026-05-03"\n---\n\n# Body\n';
    const { meta, content } = parseFrontmatter(raw);
    expect(meta).toEqual({ title: 'Hello', type: 'analysis', date: '2026-05-03' });
    expect(content).toBe('# Body');
  });

  it('tolerates the exporter’s multi-line quoted abstract', () => {
    const raw = [
      '---',
      'title: "T"',
      'abstract: "**要旨：line one**',
      '',
      '## 導入',
      '',
      'second paragraph"',
      'notionId: "355d0f0b"',
      'sourceUrls: "https://a.example, https://b.example"',
      '---',
      'body',
    ].join('\n');
    const { meta, content } = parseFrontmatter(raw);
    expect(meta.title).toBe('T');
    expect(meta.notionId).toBe('355d0f0b');
    expect(meta.sourceUrls).toBe('https://a.example, https://b.example');
    // Continuation lines of the abstract must not be mistaken for keys.
    expect(meta).not.toHaveProperty('## 導入');
    expect(content).toBe('body');
  });

  it('returns the whole text when there is no block', () => {
    expect(parseFrontmatter('plain')).toEqual({ meta: {}, content: 'plain' });
  });
});

describe('source index', () => {
  it('normalises tracking params, case and trailing slashes', () => {
    expect(normalizeUrl('https://Example.com/a/?utm_source=x&ref=y#frag')).toBe('https://example.com/a');
    expect(normalizeUrl('https://example.com/a?q=1')).toBe('https://example.com/a?q=1');
  });

  it('pairs each analysis source with its explanation, and vice versa', () => {
    const src = 'https://example.com/post';
    const explanation = row({ slug: 'e1', type: 'explanation', sourceUrls: `${src}?utm_medium=mail` });
    const analysis = row({ slug: 'a1', type: 'analysis', sourceUrls: `${src}, https://other.example/x` });
    const index = buildSourceIndex([explanation, analysis]);
    const entry = lookupSource(index, src);
    expect(entry?.explanation?.slug).toBe('e1');
    expect(entry?.analyses.map(a => a.slug)).toEqual(['a1']);
    expect(lookupSource(index, 'https://other.example/x')?.explanation).toBeUndefined();
  });
});

describe('resolveLanguage', () => {
  const store = (v: string | null) => ({ getItem: () => v });
  it('prefers ?lang=, then storage, then the browser, then ja', () => {
    expect(resolveLanguage('?lang=en', store('ja'), ['ja'])).toBe('en');
    expect(resolveLanguage('', store('en'), ['ja'])).toBe('en');
    expect(resolveLanguage('', store(null), ['fr-FR', 'en-GB'])).toBe('en');
    expect(resolveLanguage('', store(null), ['de'])).toBe('ja');
    expect(resolveLanguage('?lang=zz', undefined, [])).toBe('ja');
  });
  it('survives a storage that throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('private mode');
      },
    };
    expect(resolveLanguage('', throwing, ['en'])).toBe('en');
  });
});

describe('fetchResearchBody', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to Japanese when the EN edition is missing, and says so', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('.en.md')) return new Response('nope', { status: 404 });
      return new Response('---\ntitle: "JA"\n---\nbody', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const out = await fetchResearchBody('abc', 'en');
    expect(out.servedLanguage).toBe('ja');
    expect(out.meta.title).toBe('JA');
    expect(out.content).toBe('body');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('serves the EN edition when it exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('---\ntitle: "EN"\n---\nen body', { status: 200 })),
    );
    const out = await fetchResearchBody('abc', 'en');
    expect(out.servedLanguage).toBe('en');
    expect(out.meta.title).toBe('EN');
  });

  it('throws on a missing Japanese body (a real 404)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    await expect(fetchResearchBody('missing', 'ja')).rejects.toThrow(/404/);
  });
});
