// /docs/:slug renders the bundled document and keeps navigation inside the
// SPA. AuthBoundary is not involved (the route is public); PublicShell's
// session hook is neutralised by mocking the auth config.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('../config/auth', () => ({ AUTH_IS_CONFIGURED: false }));
vi.mock('../lib/auth', () => ({ getCurrentUser: async () => null, signIn: async () => {} }));

import Doc, { currentSectionId } from './Doc';
import { RESEARCH_LANGUAGE_STORAGE_KEY } from '../config/research';

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search + loc.hash}</div>;
}

/** Mounts the route and waits for the edition's body to arrive. */
async function mountLoaded(path: string) {
  const r = mount(path);
  await waitFor(() => expect(r.container.querySelector('article.docs-prose')).not.toBeNull());
  return r;
}

function mount(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="/docs" element={<div>DOCS-INDEX-MARKER</div>} />
        <Route path="/docs/:slug" element={<Doc />} />
      </Routes>
    </MemoryRouter>,
  );
}

// jsdom implements neither scroll call; the page only needs them to exist.
beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
});

// jsdom's navigator lists en-US, so with nothing stored a page resolves
// to the English edition; the storage key is cleared between tests.
afterEach(() => {
  cleanup();
  document.title = '';
  window.localStorage.removeItem(RESEARCH_LANGUAGE_STORAGE_KEY);
});

describe('Doc', () => {
  it('renders the whitepaper body, its title and the breadcrumb', async () => {
    await mountLoaded('/docs/whitepaper');
    // The cover title is "Software<br>Talent Network"; jsdom joins the
    // two text nodes without a space.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Software\s*Talent Network/);
    expect(screen.getByText('Capability as an internal asset, held per execution')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(/Docs\s*\/\s*Technical whitepaper/);
    expect(document.title).toBe('Technical whitepaper — Software Talent Network');
  });

  it('serves the edition the URL names and marks the body with it', async () => {
    const { container } = await mountLoaded('/docs/founding-story?lang=ja');
    expect(container.querySelector('article.docs-prose')?.getAttribute('lang')).toBe('ja');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/人間ひとり、\s*AI 58体/);
    expect(document.title).toBe('創業ストーリー — Software Talent Network');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(/Docs\s*\/\s*創業ストーリー/);
    cleanup();
    await mountLoaded('/docs/founding-story?lang=en');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/One human,\s*58 AIs/);
    expect(document.title).toBe('Founding story — Software Talent Network');
  });

  it('lets a shared ?lang= win over the stored choice without overwriting it', async () => {
    window.localStorage.setItem(RESEARCH_LANGUAGE_STORAGE_KEY, 'ja');
    const { container } = await mountLoaded('/docs/founding-story?lang=en');
    expect(container.querySelector('article.docs-prose')?.getAttribute('lang')).toBe('en');
    expect(window.localStorage.getItem(RESEARCH_LANGUAGE_STORAGE_KEY)).toBe('ja');
  });

  it('falls back to the stored choice, then the browser, then English; ignores a bad value', async () => {
    const langOf = async (path: string) => {
      const l = (await mountLoaded(path)).container.querySelector('article')?.getAttribute('lang');
      cleanup();
      return l;
    };
    window.localStorage.setItem(RESEARCH_LANGUAGE_STORAGE_KEY, 'ja');
    expect(await langOf('/docs/whitepaper')).toBe('ja');
    // A bad value is ignored: the stored choice still wins, not the query's "EN".
    expect(await langOf('/docs/whitepaper?lang=EN')).toBe('ja');
    window.localStorage.removeItem(RESEARCH_LANGUAGE_STORAGE_KEY);
    expect(await langOf('/docs/whitepaper')).toBe('en'); // jsdom: navigator.languages = en-US
    const languages = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR', 'fr']);
    expect(await langOf('/docs/whitepaper')).toBe('en'); // neither language named → ADR-0005 fallback
    expect(await langOf('/docs/founding-story')).toBe('en');
    languages.mockRestore();
  });

  it('switches edition from the breadcrumb row, writing ?lang= and the stored choice', async () => {
    const { container } = await mountLoaded('/docs/manifesto?lang=ja');
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const group = within(nav).getByRole('group', { name: 'Document edition' });
    expect(within(group).getByRole('button', { name: 'JA' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(group).getByRole('button', { name: 'EN' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/docs/manifesto?lang=en'));
    await waitFor(() => expect(container.querySelector('article')?.getAttribute('lang')).toBe('en'));
    expect(screen.getByText('Assemble the right professionals.')).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem(RESEARCH_LANGUAGE_STORAGE_KEY)).toBe('en');
  });

  it('returns to the section being read after a switch, never to the top', async () => {
    await mountLoaded('/docs/whitepaper?lang=en');
    const s4 = document.getElementById('s4')!;
    // Sections s1–s4 have scrolled past the viewport top; s5 onward are below.
    for (const section of document.querySelectorAll<HTMLElement>('article section[id]')) {
      const past = Number(section.id.slice(1)) <= 4;
      section.getBoundingClientRect = () => ({ top: past ? -100 : 500 }) as DOMRect;
    }
    const intoView = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const scrollTo = vi.mocked(window.scrollTo);
    scrollTo.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'JA' }));
    await waitFor(() => expect(document.querySelector('article')?.getAttribute('lang')).toBe('ja'));
    // The Japanese body replaced the English one; the element with id s4 is new.
    expect(document.getElementById('s4')).not.toBe(s4);
    await waitFor(() => expect(intoView).toHaveBeenCalled());
    expect(intoView.mock.contexts).toContain(document.getElementById('s4'));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('carries ?lang= onto every Docs link it renders, and keeps #hash order', async () => {
    const { container } = await mountLoaded('/docs/founding-story?lang=en');
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/docs?lang=en');
    const more = screen.getByRole('region', { name: 'Continue reading' });
    for (const link of within(more).getAllByRole('link')) {
      expect(link.getAttribute('href')).toMatch(/^\/docs(\/[a-z-]+)?\?lang=en$/);
    }
    const inBody = container.querySelector('article a[href="/docs/whitepaper"]') as HTMLAnchorElement;
    fireEvent.click(inBody);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/docs/whitepaper?lang=en'));
  });

  it('carries nothing when the URL names no edition', () => {
    mount('/docs/founding-story');
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/docs');
    const more = screen.getByRole('region', { name: 'Continue reading' });
    for (const link of within(more).getAllByRole('link')) expect(link.getAttribute('href')).not.toContain('lang=');
  });

  it('localizes the cards under the body and marks them lang="ja" only in the Japanese edition', () => {
    mount('/docs/manifesto?lang=ja'); // the cards come from the manifest, not the body: no wait
    const more = screen.getByRole('region', { name: 'Continue reading' });
    expect(more).toHaveTextContent('創業ストーリー');
    expect(more).toHaveTextContent('人間ひとり、AI 58体');
    const cards = (region: HTMLElement) => within(region).getAllByRole('link').filter(a => /^\/docs\//.test(a.getAttribute('href') ?? ''));
    expect(cards(more)).toHaveLength(5);
    for (const link of cards(more)) expect(link.getAttribute('lang')).toBe('ja');
    cleanup();
    mount('/docs/manifesto?lang=en');
    const moreEn = screen.getByRole('region', { name: 'Continue reading' });
    expect(moreEn).toHaveTextContent('One human, 58 AIs');
    for (const link of cards(moreEn)) expect(link.getAttribute('lang')).toBeNull();
  });

  it('keeps the chrome identical in both editions', () => {
    const chrome = (path: string) => {
      mount(path);
      const text = [
        screen.getByRole('navigation', { name: 'Breadcrumb' }).querySelector('a')?.textContent,
        screen.getByRole('heading', { level: 2, name: 'Continue reading' }).textContent,
        screen.getByRole('link', { name: '← All docs' }).textContent,
      ];
      cleanup();
      return text;
    };
    expect(chrome('/docs/whitepaper?lang=ja')).toEqual(chrome('/docs/whitepaper?lang=en'));
  });

  it('offers the other two documents under the body', () => {
    mount('/docs/manifesto');
    const more = screen.getByRole('region', { name: 'Continue reading' });
    expect(more).toHaveTextContent('Technical whitepaper');
    expect(more).toHaveTextContent('Founding story');
    expect(more).not.toHaveTextContent('Assemble, deliver, disband');
  });

  // The founding story's footnotes link the whitepaper as /docs/whitepaper.
  // A plain anchor in injected HTML would reload the page; the click is
  // intercepted and routed instead.
  it('routes an in-body link to another document through the router', async () => {
    const { container } = await mountLoaded('/docs/founding-story');
    const link = container.querySelector('article a[href="/docs/whitepaper"]') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    fireEvent.click(link);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/docs/whitepaper'));
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Technical whitepaper');
  });

  // The page stays mounted across documents, and the next body arrives
  // later than the route change: the section a cross-document link names
  // must be revealed in the body that arrives, not looked for in the one
  // being left (which scrolled to the top instead — cycle-2 D5).
  it('reveals the section an in-body link to another document names, once that body arrives', async () => {
    const { container } = await mountLoaded('/docs/capabilities?lang=en');
    const link = container.querySelector('article a[href="/docs/whitepaper#s10"]') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    const intoView = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const scrollTo = vi.mocked(window.scrollTo);
    scrollTo.mockClear();
    fireEvent.click(link);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/docs/whitepaper?lang=en#s10'));
    await waitFor(() => expect(container.querySelector('article h1')).toHaveTextContent(/Software\s*Talent Network/));
    await waitFor(() => expect(intoView).toHaveBeenCalled());
    expect(intoView.mock.contexts).toContain(document.getElementById('s10'));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('forwards the pre-SPA .html spellings, keeping ?lang= and #hash', async () => {
    mount('/docs/manifesto.html');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/docs/manifesto'));
    expect(await screen.findByText('Assemble the right professionals.')).toBeInTheDocument();
    cleanup();
    mount('/docs/founding-story.html?lang=en#s3');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/docs/founding-story?lang=en#s3'));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/One human/));
  });

  it('offers no toggle on the not-found card but still carries ?lang= home', () => {
    mount('/docs/roadmap?lang=en');
    expect(screen.queryByRole('group', { name: 'Document edition' })).toBeNull();
    expect(screen.getByRole('link', { name: '← All docs' })).toHaveAttribute('href', '/docs?lang=en');
  });

  it('forwards /docs/index.html to the index', async () => {
    mount('/docs/index.html');
    expect(await screen.findByText('DOCS-INDEX-MARKER')).toBeInTheDocument();
  });

  it('fails loudly when an edition body cannot be loaded (C-4)', async () => {
    const bodies = await import('../lib/docs-bodies');
    const load = vi.spyOn(bodies, 'loadDocBody').mockRejectedValueOnce(new Error('chunk gone after a deploy'));
    const { container } = mount('/docs/whitepaper?lang=en');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load this edition');
    expect(alert).toHaveTextContent('chunk gone after a deploy');
    expect(container.querySelector('article.docs-prose')).toBeNull();
    load.mockRestore();
  });

  it('says so for a document that does not exist', () => {
    mount('/docs/roadmap');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('There is no document called “roadmap”.');
  });
});

describe('currentSectionId', () => {
  it('is the last section whose top has passed the viewport edge', () => {
    const sections = [
      { id: 's1', top: -900 },
      { id: 's2', top: -300 },
      { id: 's3', top: 10 },
      { id: 's4', top: 400 },
    ];
    expect(currentSectionId(sections)).toBe('s3');
    expect(currentSectionId(sections, 0)).toBe('s2');
    expect(currentSectionId([{ id: 's1', top: 200 }])).toBeNull();
    expect(currentSectionId([])).toBeNull();
  });
});
