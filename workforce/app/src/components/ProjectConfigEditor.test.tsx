// Tests for ProjectConfigEditor — the ADR-0029 console write surface.
//
// The component's job is to turn a form into one well-shaped PATCH body and
// to survive the API rejecting it. The API is the validation authority, so
// these tests assert the wire shape and the failure behaviour, not a
// re-implementation of the server's rules.
//
// Mocks:
//   - SIGV4_IS_CONFIGURED (default true; one test flips it to exercise the
//     disabled affordance).
//   - patchProjectConfig from ../lib/projects.
//   - loadWorkforceManifest from ../lib/agents (the owner picker's roster).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ProjectDetail } from '../types/project';

let mockConfigured = true;
vi.mock('../config/auth', () => ({
  get SIGV4_IS_CONFIGURED() {
    return mockConfigured;
  },
}));

const patchMock = vi.fn();
vi.mock('../lib/projects', async () => {
  const actual = await vi.importActual<typeof import('../lib/projects')>('../lib/projects');
  return {
    ...actual,
    patchProjectConfig: (...args: unknown[]) => patchMock(...args),
  };
});

vi.mock('../lib/agents', () => ({
  loadWorkforceManifest: async () => ({ agents: [{ slug: 'ren' }, { slug: 'nadia' }] }),
}));

import ProjectConfigEditor from './ProjectConfigEditor';

const project: ProjectDetail = {
  project_id: 'acme',
  status: 'active',
  owner_agent: '_operator',
  created_at: '2026-05-27T00:00:00.000Z',
  github_owner: 'refluster',
  github_repo: 'ai-native-article',
  governance_docs: ['AGENTS.md'],
  credential_types: ['github.token'],
};

function renderEditor(over: Partial<ProjectDetail> = {}, onSaved = vi.fn()) {
  render(<ProjectConfigEditor project={{ ...project, ...over }} onSaved={onSaved} />);
  return onSaved;
}

beforeEach(() => {
  mockConfigured = true;
  patchMock.mockReset();
  patchMock.mockResolvedValue({ ...project, owner_agent: 'ren' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProjectConfigEditor', () => {
  it('shows the stored config read-only until EDIT is pressed', () => {
    renderEditor();
    expect(screen.getByText('AGENTS.md')).toBeInTheDocument();
    expect(screen.getByText('github.token')).toBeInTheDocument();
    expect(screen.queryByText('SAVE')).not.toBeInTheDocument();
  });

  it('renders a dash for a project that declares nothing', () => {
    renderEditor({ governance_docs: [], credential_types: [], github_owner: undefined, github_repo: undefined });
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('links the repo out to GitHub in the read view', () => {
    renderEditor();
    const link = screen.getByRole('link', { name: 'refluster/ai-native-article' });
    expect(link).toHaveAttribute('href', 'https://github.com/refluster/ai-native-article');
  });

  it('disables editing when the sigv4 broker is not configured', () => {
    mockConfigured = false;
    renderEditor();
    expect(screen.getByRole('button', { name: /EDIT/ })).toBeDisabled();
  });

  it('sends one patch carrying every field, with lists split by line', async () => {
    const onSaved = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: /EDIT/ }));

    fireEvent.change(screen.getByLabelText('GOVERNANCE_DOCS'), {
      target: { value: 'AGENTS.md\n  docs/governance.md  \n\n' },
    });
    fireEvent.click(screen.getByRole('button', { name: /SAVE/ }));

    await waitFor(() => expect(patchMock).toHaveBeenCalledTimes(1));
    expect(patchMock).toHaveBeenCalledWith('acme', {
      owner_agent: '_operator',
      github: { owner: 'refluster', repo: 'ai-native-article' },
      // blank lines dropped, surrounding whitespace trimmed
      governance_docs: ['AGENTS.md', 'docs/governance.md'],
      credential_types: ['github.token'],
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('sends github: null when the repo field is cleared', async () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: /EDIT/ }));
    fireEvent.change(screen.getByLabelText('GITHUB REPO'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: /SAVE/ }));

    await waitFor(() => expect(patchMock).toHaveBeenCalledTimes(1));
    expect(patchMock.mock.calls[0]![1]).toMatchObject({ github: null });
  });

  it('blocks the save on a malformed repo rather than sending a half pair', async () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: /EDIT/ }));
    fireEvent.change(screen.getByLabelText('GITHUB REPO'), { target: { value: 'no-slash' } });

    expect(screen.getByText('repo must read owner/name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /SAVE/ })).toBeDisabled();
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('offers the agent roster plus _operator as owners', async () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: /EDIT/ }));
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'ren' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('option', { name: '_operator' })).toBeInTheDocument();
  });

  it('keeps an owner that predates the roster selectable', async () => {
    renderEditor({ owner_agent: 'elena' });
    fireEvent.click(screen.getByRole('button', { name: /EDIT/ }));
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'elena' })).toBeInTheDocument(),
    );
  });

  it('stays in edit mode with the values intact when the API rejects the patch', async () => {
    // The API validates the whole patch before writing any of it, so nothing
    // was applied — dropping the operator back to the read view would hide
    // both the error and the edits they still need to correct.
    patchMock.mockRejectedValue(new Error('PATCH /projects failed (400): invalid_credential_types'));
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: /EDIT/ }));
    fireEvent.change(screen.getByLabelText('CREDENTIAL_TYPES'), { target: { value: 'nope.nope' } });
    fireEvent.click(screen.getByRole('button', { name: /SAVE/ }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('invalid_credential_types');
    expect(screen.getByLabelText('CREDENTIAL_TYPES')).toHaveValue('nope.nope');
    expect(screen.getByRole('button', { name: /SAVE/ })).toBeInTheDocument();
  });
});
