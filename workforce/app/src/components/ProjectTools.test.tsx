// Rendering tests for the project Tools tab.
//
// Phase 1 ships an empty registry, so the reachable paths are the empty
// index and the unknown-tool fallback — both of which must be honest
// rather than blank. The per-tool card paths light up in Phase 2, when
// the registry gains entries; their gating logic is covered in
// lib/tools.test.ts today.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ProjectTools from './ProjectTools';

vi.mock('../lib/credentials', () => ({
  fetchCredentials: vi.fn(),
}));

import { fetchCredentials } from '../lib/credentials';
const mockedFetch = vi.mocked(fetchCredentials);

function renderTools(props: { projectId: string; toolId?: string }) {
  return render(
    <MemoryRouter>
      <ProjectTools {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedFetch.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProjectTools', () => {
  it('names the empty registry rather than rendering a blank panel', async () => {
    renderTools({ projectId: 'asp-cloud' });
    expect(screen.getByText('NONE REGISTERED YET')).toBeInTheDocument();
    expect(
      screen.getByText(/No tools are registered on this project yet/),
    ).toBeInTheDocument();
  });

  it('reports an unregistered tool id instead of rendering nothing', async () => {
    renderTools({ projectId: 'asp-cloud', toolId: 'not-a-tool' });
    expect(screen.getByText('NOT FOUND')).toBeInTheDocument();
    expect(screen.getByText(/not-a-tool/)).toBeInTheDocument();
  });

  it('survives a failed credential fetch without surfacing an error page', async () => {
    // The failure must not take the tab down — the registry still renders.
    // (That a failed fetch never renders a tool as *provisioned* is
    // enforced by the CredentialState union: 'unknown' carries no rows.)
    mockedFetch.mockRejectedValueOnce(new Error('agents-api 500'));
    renderTools({ projectId: 'asp-cloud' });
    await waitFor(() => {
      expect(screen.getByText('NONE REGISTERED YET')).toBeInTheDocument();
    });
  });

  it('re-reads credentials when the project changes', async () => {
    const { rerender } = renderTools({ projectId: 'asp-cloud' });
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));
    rerender(
      <MemoryRouter>
        <ProjectTools projectId="self/ren" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2));
    expect(mockedFetch.mock.calls[1][0]).toBe('self/ren');
  });
});
