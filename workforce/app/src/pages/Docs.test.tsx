// /docs lists every document in the reader's edition, with the JA / EN
// pill in the hero. AuthBoundary is not involved (the route is public).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('../config/auth', () => ({ AUTH_IS_CONFIGURED: false }));
vi.mock('../lib/auth', () => ({ getCurrentUser: async () => null, signIn: async () => {} }));

import Docs from './Docs';
import Landing from './Landing';
import { PUBLIC_DOCS } from '../lib/docs';
import { RESEARCH_LANGUAGE_STORAGE_KEY } from '../config/research';

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

function mount(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/docs" element={<Docs />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(RESEARCH_LANGUAGE_STORAGE_KEY);
});

/** The document cards: every link into /docs/<slug>. */
function docCards() {
  return screen.getAllByRole('link').filter(a => /^\/docs\/[a-z-]+/.test(a.getAttribute('href') ?? ''));
}

describe('Docs index', () => {
  it('lists every document in the edition the URL names, cards marked lang="ja" only for Japanese', () => {
    mount('/docs?lang=ja');
    const cards = docCards();
    expect(cards).toHaveLength(PUBLIC_DOCS.length);
    expect(screen.getByText('人間ひとり、AI 58体')).toBeInTheDocument();
    expect(screen.getByText('創業ストーリーを読む →')).toBeInTheDocument();
    for (const card of cards) {
      expect(card.getAttribute('lang')).toBe('ja');
      expect(card.getAttribute('href')).toMatch(/\?lang=ja$/);
    }
    cleanup();
    mount('/docs?lang=en');
    expect(screen.getByText('One human, 58 AIs')).toBeInTheDocument();
    expect(screen.getByText('Read the founding story →')).toBeInTheDocument();
    for (const card of docCards()) {
      expect(card.getAttribute('lang')).toBeNull();
      expect(card.getAttribute('href')).toMatch(/\?lang=en$/);
    }
  });

  it('keeps the hero chrome English in both editions and puts the toggle beside the title', async () => {
    mount('/docs?lang=ja');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Docs');
    expect(screen.getByText('Documentation')).toBeInTheDocument();
    expect(screen.getByText(/Each is published in Japanese and English\./)).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Document edition' });
    expect(within(group).getByRole('button', { name: '日本語' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(group).getByRole('button', { name: 'English' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/docs?lang=en'));
    expect(screen.getByText('One human, 58 AIs')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Docs');
    expect(window.localStorage.getItem(RESEARCH_LANGUAGE_STORAGE_KEY)).toBe('en');
  });

  it('resolves the edition from the stored choice when the URL names none, carrying nothing', () => {
    window.localStorage.setItem(RESEARCH_LANGUAGE_STORAGE_KEY, 'ja');
    mount('/docs');
    expect(screen.getByText('人間ひとり、AI 58体')).toBeInTheDocument();
    for (const card of docCards()) expect(card.getAttribute('href')).not.toContain('lang=');
  });
});

describe('Docs index fallback', () => {
  it('shows English to a reader whose browser names neither language', () => {
    const languages = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR']);
    mount('/docs');
    expect(screen.getByText('One human, 58 AIs')).toBeInTheDocument();
    languages.mockRestore();
  });
});

describe('Landing document cards', () => {
  it('follow the resolved edition and offer no toggle', () => {
    window.localStorage.setItem(RESEARCH_LANGUAGE_STORAGE_KEY, 'ja');
    mount('/');
    expect(screen.queryByRole('group', { name: /edition/ })).toBeNull();
    expect(screen.getByText('人間ひとり、AI 58体')).toBeInTheDocument();
    for (const card of docCards()) expect(card.getAttribute('lang')).toBe('ja');
    cleanup();
    window.localStorage.setItem(RESEARCH_LANGUAGE_STORAGE_KEY, 'en');
    mount('/');
    expect(screen.getByText('One human, 58 AIs')).toBeInTheDocument();
    for (const card of docCards()) expect(card.getAttribute('lang')).toBeNull();
  });
});
