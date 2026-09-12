// /docs/:slug renders the bundled document and keeps navigation inside the
// SPA. AuthBoundary is not involved (the route is public); PublicShell's
// session hook is neutralised by mocking the auth config.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('../config/auth', () => ({ AUTH_IS_CONFIGURED: false }));
vi.mock('../lib/auth', () => ({ getCurrentUser: async () => null, signIn: async () => {} }));

import Doc from './Doc';

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.hash}</div>;
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

afterEach(() => {
  cleanup();
  document.title = '';
});

describe('Doc', () => {
  it('renders the whitepaper body, its title and the breadcrumb', () => {
    mount('/docs/whitepaper');
    // The cover title is "Software<br>Talent Network"; jsdom joins the
    // two text nodes without a space.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Software\s*Talent Network/);
    expect(screen.getByText('Capability as an internal asset, held per execution')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(/Docs\s*\/\s*Technical whitepaper/);
    expect(document.title).toBe('Technical whitepaper — Software Talent Network');
  });

  it('sets lang on the body for the Japanese founding story', () => {
    const { container } = mount('/docs/founding-story');
    expect(container.querySelector('article.docs-prose')?.getAttribute('lang')).toBe('ja');
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
    const { container } = mount('/docs/founding-story');
    const link = container.querySelector('article a[href="/docs/whitepaper"]') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    fireEvent.click(link);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/docs/whitepaper'));
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Technical whitepaper');
  });

  it('forwards the pre-SPA .html spellings', async () => {
    mount('/docs/manifesto.html');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/docs/manifesto'));
    expect(screen.getByText('Assemble the right professionals.')).toBeInTheDocument();
  });

  it('forwards /docs/index.html to the index', async () => {
    mount('/docs/index.html');
    expect(await screen.findByText('DOCS-INDEX-MARKER')).toBeInTheDocument();
  });

  it('says so for a document that does not exist', () => {
    mount('/docs/roadmap');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('There is no document called “roadmap”.');
  });
});
