// The book reader: BookMarkdown's block vocabulary and heading anchors,
// then the chapter page (BookChapter) end to end over the bundled sunzi
// fixture — title, resume, keyboard paging and settings. loadFigure is
// mocked so a figure's SVG is a known string; everything else is the real
// lib/books bundle.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('../config/auth', () => ({ AUTH_IS_CONFIGURED: false }));
vi.mock('../lib/auth', () => ({ getCurrentUser: async () => null, signIn: async () => {} }));

const FIGURE_SVG = '<svg viewBox="0 0 10 10" role="img" data-testid="figure-svg"><title>図</title></svg>';
const loadFigure = vi.fn(async (_book: unknown, _src: string) => FIGURE_SVG);
vi.mock('../lib/books', async importOriginal => {
  const real = await importOriginal<typeof import('../lib/books')>();
  return { ...real, loadFigure: (b: unknown, s: string) => loadFigure(b, s), peekFigure: () => null };
});

import BookMarkdown from '../components/book/BookMarkdown';
import BookChapter from './BookChapter';
import { findBook } from '../lib/books';

const SUNZI = findBook('sunzi')!;

const CHAPTER = `# 章の題

## 一節

\`\`\`quote
原文: 兵者、國之大事。
訓読: 兵は国の大事なり。
出典: 始計篇
訳: 戦争は国家の重大事である。
\`\`\`

\`\`\`connect
title: 品質工学
**ばらつき**を数える。
\`\`\`

\`\`\`note
後世の成語。
\`\`\`

### 小節

![図1 五事](figures/01-five-factors.svg)

\`\`\`quote
原文: 出典のない引用
訓読: 出典なし
\`\`\`

#### 細目

最後の段落。[外部](https://example.com) と [次章](/books/sunzi/01-ji)。
`;

function renderMarkdown(markdown = CHAPTER) {
  return render(
    <MemoryRouter>
      <BookMarkdown book={SUNZI} markdown={markdown} kicker="第一篇" />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  loadFigure.mockClear();
});

describe('BookMarkdown', () => {
  it('numbers h1–h4 as h-1..h-n in document order, with the kicker above the title', () => {
    const { container } = renderMarkdown();
    const ids = Array.from(container.querySelectorAll('h1, h2, h3, h4')).map(h => `${h.tagName}#${h.id}`);
    expect(ids).toEqual(['H1#h-1', 'H2#h-2', 'H3#h-3', 'H4#h-4']);
    expect(container.querySelector('.book-chapter-head .book-chapter-kicker')).toHaveTextContent('第一篇');
  });

  it('gives the same ids on every render (a stored anchor survives a reload)', () => {
    const first = Array.from(renderMarkdown().container.querySelectorAll('[id^="h-"]')).map(h => h.textContent);
    cleanup();
    const second = Array.from(renderMarkdown().container.querySelectorAll('[id^="h-"]')).map(h => h.textContent);
    expect(second).toEqual(first);
  });

  it('renders a quote card with 原文, 訓読, 出典 and 訳', () => {
    const { container } = renderMarkdown();
    const card = container.querySelector('figure.book-quote')!;
    expect(card.querySelector('.book-quote-original')).toHaveTextContent('兵者、國之大事。');
    expect(card.querySelector('.book-quote-kundoku')).toHaveTextContent('兵は国の大事なり。');
    expect(card.querySelector('cite.book-quote-source')).toHaveTextContent('始計篇');
    expect(card.querySelector('.book-quote-translation')).toHaveTextContent('戦争は国家の重大事である。');
  });

  it('renders the connect aside with its kicker, title and Markdown body', () => {
    renderMarkdown();
    const aside = screen.getByRole('complementary', { name: '接続: 品質工学' });
    expect(aside).toHaveTextContent('接続');
    expect(aside.querySelector('strong')).toHaveTextContent('ばらつき');
  });

  it('renders the note block', () => {
    renderMarkdown();
    expect(screen.getByRole('note')).toHaveTextContent('後世の成語。');
  });

  it('inlines an .svg figure with its alt as the caption, outside any <p>', async () => {
    const { container } = renderMarkdown();
    expect(await screen.findByTestId('figure-svg')).toBeInTheDocument();
    expect(loadFigure).toHaveBeenCalledWith(SUNZI, 'figures/01-five-factors.svg');
    const figure = container.querySelector('figure.book-figure')!;
    expect(figure.querySelector('figcaption')).toHaveTextContent('図1 五事');
    expect(figure.closest('p')).toBeNull();
  });

  it('shows a malformed quote as a visible error card and keeps rendering the chapter', () => {
    renderMarkdown();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('引用ブロックの形式エラー');
    expect(alert).toHaveTextContent('missing 出典');
    expect(screen.getByText(/最後の段落。/)).toBeInTheDocument();
  });

  it('opens outbound links in a new tab and keeps /books links in the SPA', () => {
    renderMarkdown();
    expect(screen.getByRole('link', { name: '外部' })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: '次章' })).toHaveAttribute('href', '/books/sunzi/01-ji');
    expect(screen.getByRole('link', { name: '次章' })).not.toHaveAttribute('target');
  });

  it('reports a figure that fails to load in place', async () => {
    loadFigure.mockRejectedValueOnce(new Error('books: figure figures/x.svg does not exist in "sunzi"'));
    renderMarkdown('# 題\n\n![図X](figures/x.svg)\n\n本文。');
    expect(await screen.findByRole('alert')).toHaveTextContent('図を読み込めません');
    expect(screen.getByText('本文。')).toBeInTheDocument();
  });
});

// ── The chapter page ─────────────────────────────────────────────────────

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

function mount(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="/books/:slug" element={<div>COVER-MARKER</div>} />
        <Route path="/books/:slug/:chapterId" element={<BookChapter />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('BookChapter', () => {
  const scrollTo = vi.fn();
  beforeEach(() => {
    localStorage.clear();
    scrollTo.mockClear();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  });
  afterEach(() => {
    document.title = '';
  });

  it('renders the chapter in its own chrome and sets the title', async () => {
    const { container } = mount('/books/sunzi/01-ji');
    expect(await screen.findByRole('heading', { level: 1, name: '始計篇 — 戦う前に、数える' })).toBeInTheDocument();
    expect(document.title).toBe('始計篇 — 戦う前に、数える — 孫子の兵法');
    expect(container.querySelector('.book-root.book-theme-paper.book-size-m.book-family-serif')).not.toBeNull();
    expect(container.querySelector('.book-progress')).not.toBeNull();
    expect(container.querySelector('figure.book-quote')).not.toBeNull();
    expect(screen.getByRole('navigation', { name: '前後の章' })).toHaveTextContent('序 — なぜいま孫子か');
  });

  it('stores the position on arrival, and → / ← page through the chapters', async () => {
    mount('/books/sunzi/preface');
    await screen.findByRole('heading', { level: 1, name: '序 — なぜいま孫子か' });
    await waitFor(() => expect(JSON.parse(localStorage.getItem('kohuehara.book.sunzi')!)).toMatchObject({ chapterId: 'preface' }));

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/books/sunzi/01-ji'));
    expect(await screen.findByRole('heading', { level: 1, name: '始計篇 — 戦う前に、数える' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'ArrowRight' }); // last chapter: nowhere to go
    expect(screen.getByTestId('location')).toHaveTextContent('/books/sunzi/01-ji');
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true }); // browser back, not ours
    expect(screen.getByTestId('location')).toHaveTextContent('/books/sunzi/01-ji');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/books/sunzi/preface'));
  });

  it('restores a stored position only when sent with ?resume=1', async () => {
    // An own property shadows Element.prototype's getter; deleting it restores jsdom's.
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => 5768 });
    try {
      localStorage.setItem('kohuehara.book.sunzi', JSON.stringify({ chapterId: '01-ji', anchor: null, ratio: 0.5, at: 1 }));
      mount('/books/sunzi/01-ji?resume=1');
      await screen.findByRole('heading', { level: 1 });
      // jsdom: innerHeight 768 → scrollable 5000 → half way is 2500.
      await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 2500 }));
      cleanup();
      scrollTo.mockClear();
      localStorage.setItem('kohuehara.book.sunzi', JSON.stringify({ chapterId: '01-ji', anchor: null, ratio: 0.5, at: 1 }));
      mount('/books/sunzi/01-ji');
      await screen.findByRole('heading', { level: 1 });
      await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0 }));
      expect(scrollTo).not.toHaveBeenCalledWith({ top: 2500 });
    } finally {
      delete (document.documentElement as unknown as { scrollHeight?: number }).scrollHeight;
    }
  });

  it('applies and remembers reader settings', async () => {
    const { container } = mount('/books/sunzi/preface');
    await screen.findByRole('heading', { level: 1 });
    fireEvent.click(screen.getByRole('button', { name: '表示設定' }));
    fireEvent.click(screen.getByRole('button', { name: '夜' }));
    fireEvent.click(screen.getByRole('button', { name: 'L' }));
    expect(container.querySelector('.book-root.book-theme-night.book-size-l')).not.toBeNull();
    expect(document.documentElement.dataset.bookTheme).toBe('night');
    expect(JSON.parse(localStorage.getItem('kohuehara.book.settings')!)).toEqual({ size: 'l', theme: 'night', family: 'serif' });
  });

  it('opens the table of contents with the current chapter marked', async () => {
    mount('/books/sunzi/01-ji');
    await screen.findByRole('heading', { level: 1 });
    fireEvent.click(screen.getByRole('button', { name: '目次' }));
    const toc = screen.getByRole('navigation', { name: '目次' });
    const current = toc.querySelector('[aria-current="page"]');
    expect(current).toHaveTextContent('始計篇 — 戦う前に、数える');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toc).not.toHaveClass('is-open');
  });

  it('says so for an unknown chapter', () => {
    mount('/books/sunzi/99-nope');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('章 “99-nope” はありません');
  });
});
