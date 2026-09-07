// Rendering tests for the project Tools tab.
//
// The registry is populated from workforce/tools/ (Phase 2), so these
// exercise the real index cards, the unknown-tool fallback, and the
// per-project credential fetch. The run panel itself is covered in
// ToolRunner.test.tsx; here we only assert that a tool's detail view
// reaches it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ProjectTools from './ProjectTools';

vi.mock('../lib/credentials', () => ({
  fetchCredentials: vi.fn(),
}));

// The runner is exercised on its own; stubbing it here keeps these tests
// about the tab's own branching rather than about form rendering.
vi.mock('./ToolRunner', () => ({
  default: ({ tool }: { tool: { tool_id: string } }) => (
    <div data-testid="tool-runner">{tool.tool_id}</div>
  ),
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
  it('lists every registered tool on the index', async () => {
    renderTools({ projectId: 'asp-cloud' });
    expect(screen.getByText('Problem Finding')).toBeInTheDocument();
    expect(screen.getByText('User Research')).toBeInTheDocument();
  });

  it('links each card to that tool, keeping a slash-bearing id encoded', () => {
    renderTools({ projectId: 'self/ren' });
    const link = screen.getByText('Problem Finding').closest('a');
    expect(link).toHaveAttribute('href', '/projects/self%2Fren/tools/problem-finding');
  });

  it('renders the run panel on a tool detail view', () => {
    renderTools({ projectId: 'asp-cloud', toolId: 'problem-finding' });
    expect(screen.getByTestId('tool-runner')).toHaveTextContent('problem-finding');
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
      expect(screen.getAllByText('credentials unknown').length).toBeGreaterThan(0);
    });
    // The registry still renders; only the readiness claim is withheld.
    expect(screen.getByText('Problem Finding')).toBeInTheDocument();
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
