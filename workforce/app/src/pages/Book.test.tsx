// /books/:slug — the cover: table of contents with reading times and read
// state, and 続きから読む only when a position is stored.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../config/auth', () => ({ AUTH_IS_CONFIGURED: false }));
vi.mock('../lib/auth', () => ({ getCurrentUser: async () => null, signIn: async () => {} }));

import Book from './Book';

function mount(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/books/:slug" element={<Book />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  document.title = '';
});

describe('Book cover', () => {
  it('offers はじめから読む with no stored position, and lists every chapter by part', async () => {
    mount('/books/sunzi');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('孫子の兵法');
    expect(screen.getByRole('link', { name: 'はじめから読む' })).toHaveAttribute('href', '/books/sunzi/preface');
    expect(screen.queryByRole('link', { name: '続きから読む' })).not.toBeInTheDocument();
    expect(screen.getByText(/^by ingrid · sora/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '前編 原文を読む' })).toBeInTheDocument();
    // Reading times arrive once the chapter chunks load.
    expect(await screen.findByText(/23章 · 約\d+時間/)).toBeInTheDocument();
    expect(document.title).toMatch(/^孫子の兵法 — /);
  });

  it('offers 続きから読む with the chapter and percentage when a position is stored', () => {
    localStorage.setItem('kohuehara.book.sunzi', JSON.stringify({ chapterId: '01-ji', anchor: 'h-3', ratio: 0.42, at: 1 }));
    localStorage.setItem('kohuehara.book.sunzi.read', JSON.stringify({ preface: 1, '01-ji': 0.42 }));
    mount('/books/sunzi');
    expect(screen.getByRole('link', { name: '続きから読む' })).toHaveAttribute('href', '/books/sunzi/01-ji?resume=1');
    expect(screen.getByText('42%')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('読了')).toBeInTheDocument();
    expect(within(rows[2]).getByText('読書中 42%')).toBeInTheDocument();
  });

  it('ignores a stored position for a chapter that no longer exists', () => {
    localStorage.setItem('kohuehara.book.sunzi', JSON.stringify({ chapterId: 'gone', anchor: null, ratio: 0.5, at: 1 }));
    mount('/books/sunzi');
    expect(screen.getByRole('link', { name: 'はじめから読む' })).toBeInTheDocument();
  });

  it('says so for a book that does not exist', () => {
    mount('/books/nope');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('There is no book called “nope”.');
  });
});
