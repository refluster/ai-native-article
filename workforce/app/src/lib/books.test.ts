// lib/books — manifest validation, reading order, reading time, and the
// bundled content holding to book-content-contract v1. The last block is
// a content lint: it runs over every book on disk, so the real manuscript
// is checked the moment it replaces the placeholder chapters.

import { describe, it, expect } from 'vitest';
import {
  BOOKS,
  assertChapterFiles,
  estimateMinutes,
  figureRefs,
  figureRelPath,
  findBook,
  findChapter,
  flattenChapters,
  loadChapter,
  loadFigure,
  loadManifests,
  neighbours,
  validateBook,
  visibleChars,
  type BookMeta,
} from './books';
import { parseConnectBlock, parseNoteBlock, parseQuoteBlock } from './bookBlocks';

function goodManifest(): Record<string, unknown> {
  return {
    slug: 'demo',
    title: 'デモ',
    subtitle: '副題',
    lang: 'ja',
    kicker: 'Web book',
    description: '説明',
    authors: ['ingrid'],
    version: '1.0.0',
    updated: '2026-10-05',
    parts: [
      {
        id: 'front',
        title: 'はじめに',
        chapters: [{ id: 'preface', file: 'chapters/00-preface.md', title: '序', kicker: '序' }],
      },
      {
        id: 'part-1',
        title: '前編',
        chapters: [
          { id: 'one', file: 'chapters/01-one.md', title: '一', kicker: '第一篇' },
          { id: 'two', file: 'chapters/02-two.md', title: '二', kicker: '第二篇' },
        ],
      },
    ],
  };
}

const DEMO: BookMeta = validateBook(goodManifest(), 'demo/book.json');

describe('validateBook', () => {
  it('accepts a well-formed manifest and keeps chapter order', () => {
    expect(DEMO.slug).toBe('demo');
    expect(DEMO.parts.map(p => p.chapters.map(c => c.id))).toEqual([['preface'], ['one', 'two']]);
  });

  it.each([
    ['a missing title', (m: Record<string, unknown>) => delete m.title, /"title"/],
    ['an unknown lang', (m: Record<string, unknown>) => (m.lang = 'fr'), /lang/],
    ['no authors', (m: Record<string, unknown>) => (m.authors = []), /authors/],
    ['no parts', (m: Record<string, unknown>) => (m.parts = []), /parts/],
    ['an unsafe slug', (m: Record<string, unknown>) => (m.slug = 'Sun Zi'), /URL-safe/],
    [
      'a chapter without a file',
      (m: Record<string, unknown>) => delete (m.parts as { chapters: Record<string, unknown>[] }[])[0].chapters[0].file,
      /parts\[0\]\.chapters\[0\]/,
    ],
    [
      'a file outside chapters/',
      (m: Record<string, unknown>) => ((m.parts as { chapters: Record<string, unknown>[] }[])[0].chapters[0].file = 'x.md'),
      /chapters\/<name>\.md/,
    ],
    [
      'a duplicate chapter id',
      (m: Record<string, unknown>) => ((m.parts as { chapters: Record<string, unknown>[] }[])[1].chapters[1].id = 'one'),
      /duplicate chapter id "one"/,
    ],
  ])('rejects %s, naming the source', (_label, mutate, why) => {
    const m = goodManifest();
    mutate(m);
    expect(() => validateBook(m, 'demo/book.json')).toThrow(why);
    expect(() => validateBook(m, 'demo/book.json')).toThrow(/demo\/book\.json/);
  });

  // workforce/scripts/check-book.mjs reads optional per-chapter flags
  // (`short`, `generated`); the reader must not reject them.
  it('tolerates the editorial gate\'s optional chapter flags', () => {
    const m = goodManifest();
    Object.assign((m.parts as { chapters: Record<string, unknown>[] }[])[0].chapters[0], { short: true, generated: 'quotes' });
    expect(validateBook(m, 'demo/book.json').parts[0].chapters[0].id).toBe('preface');
  });

  it('rejects a manifest that is not an object', () => {
    expect(() => validateBook(null, 'x/book.json')).toThrow(/not an object/);
  });
});

describe('loadManifests / assertChapterFiles', () => {
  it('requires the directory to match the slug', () => {
    expect(() => loadManifests({ '../content/books/other/book.json': goodManifest() })).toThrow(/does not match its directory "other"/);
  });

  it('throws naming a chapter file that is not bundled', () => {
    const keys = ['../content/books/demo/chapters/00-preface.md', '../content/books/demo/chapters/01-one.md'];
    expect(() => assertChapterFiles([DEMO], keys)).toThrow(/"two" names chapters\/02-two\.md/);
    expect(() => assertChapterFiles([DEMO], [...keys, '../content/books/demo/chapters/02-two.md'])).not.toThrow();
  });
});

describe('reading order', () => {
  it('flattens parts into one ordered list carrying the part', () => {
    const flat = flattenChapters(DEMO);
    expect(flat.map(c => [c.index, c.id, c.part.id])).toEqual([
      [0, 'preface', 'front'],
      [1, 'one', 'part-1'],
      [2, 'two', 'part-1'],
    ]);
    expect(findChapter(DEMO, 'two')?.part.title).toBe('前編');
  });

  it('finds neighbours across part boundaries and stops at the ends', () => {
    expect(neighbours(DEMO, 'preface')).toMatchObject({ prev: null, next: { id: 'one' } });
    expect(neighbours(DEMO, 'one')).toMatchObject({ prev: { id: 'preface' }, next: { id: 'two' } });
    expect(neighbours(DEMO, 'two')).toMatchObject({ prev: { id: 'one' }, next: null });
    expect(neighbours(DEMO, 'nope')).toEqual({ prev: null, next: null });
  });
});

describe('estimateMinutes', () => {
  it('is characters ÷ 600, rounded, at least one minute', () => {
    expect(estimateMinutes('')).toBe(1);
    expect(estimateMinutes('あ'.repeat(100))).toBe(1);
    expect(estimateMinutes('あ'.repeat(1500))).toBe(3);
    expect(estimateMinutes('あ'.repeat(6000))).toBe(10);
  });

  it('counts what a reader reads, not the markup', () => {
    expect(visibleChars('# 見出し')).toBe(3);
    expect(visibleChars('**強調**と*傍点*')).toBe(5);
    expect(visibleChars('[リンク](https://example.com/very/long)')).toBe(3);
    expect(visibleChars('![図1 長いキャプション](figures/a.svg)')).toBe(0);
    expect(visibleChars('- 一\n- 二\n1. 三')).toBe(3);
    expect(visibleChars('| a | b |\n|---|---|\n| c | d |')).toBe(4);
    expect(visibleChars('```quote\n原文: 兵者\n出典: 始計篇\n```')).toBe(5);
    expect(visibleChars('```connect\ntitle: 題\n本文\n```')).toBe(3);
  });

  it('counts a surrogate pair as one character', () => {
    expect(visibleChars('𠮷野家')).toBe(3);
  });
});

describe('figure references', () => {
  it('extracts .svg image sources only', () => {
    expect(figureRefs('![a](figures/a.svg)\n![b](photo.png)\n![c](../figures/c.svg "t")')).toEqual([
      'figures/a.svg',
      '../figures/c.svg',
    ]);
  });

  it('normalises to figures/<name>.svg and refuses anything else', () => {
    expect(figureRelPath('figures/a.svg')).toBe('figures/a.svg');
    expect(figureRelPath('./figures/a.svg')).toBe('figures/a.svg');
    expect(figureRelPath('../figures/a.svg')).toBe('figures/a.svg');
    expect(figureRelPath('../../secret.svg')).toBeNull();
    expect(figureRelPath('figures/sub/a.svg')).toBeNull();
  });
});

describe('the bundle', () => {
  it('ships the sunzi book', () => {
    const book = findBook('sunzi');
    expect(book?.title).toBe('孫子の兵法');
    expect(flattenChapters(book!).map(c => c.id)).toEqual(['preface', '01-ji']);
    expect(findBook('nope')).toBeUndefined();
  });

  it('rejects a missing figure', async () => {
    await expect(loadFigure(findBook('sunzi')!, 'figures/missing.svg')).rejects.toThrow(/does not exist/);
    await expect(loadFigure(findBook('sunzi')!, '../x.svg')).rejects.toThrow(/under figures\//);
  });
});

// ── Content contract (book-content-contract v1), over every bundled book ──

const FENCE = /^```(\w+)\n([\s\S]*?)^```$/gm;

describe.each(BOOKS.map(b => [b.slug, b] as const))('content contract: %s', (_slug, book) => {
  it.each(flattenChapters(book).map(c => [c.id, c] as const))('chapter %s is well-formed', async (_id, chapter) => {
    const md = await loadChapter(book, chapter);
    expect(md.split('\n')[0]).toMatch(/^# \S/);
    expect(md).not.toMatch(/<\/?[a-z][^>]*>/i); // no raw HTML
    for (const m of md.matchAll(FENCE)) {
      const [, lang, text] = m;
      if (lang === 'quote') expect(parseQuoteBlock(text)).toMatchObject({ ok: true });
      if (lang === 'connect') expect(parseConnectBlock(text)).toMatchObject({ ok: true });
      if (lang === 'note') expect(parseNoteBlock(text)).toMatchObject({ ok: true });
    }
    for (const src of figureRefs(md)) {
      const svg = await loadFigure(book, src);
      const root = /<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
      expect(root, src).toMatch(/\bviewBox="/);
      expect(root, src).not.toMatch(/\s(width|height)="/);
      expect(root, src).toMatch(/\brole="img"/);
      expect(svg, src).toMatch(/<title[^>]*>[^<]+<\/title>/);
      expect(svg, src).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    }
  });
});
