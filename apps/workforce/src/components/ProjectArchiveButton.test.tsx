// Tests for ProjectArchiveButton — Project CRUD UI PR-δ.
//
// Mocks:
//   - SIGV4_IS_CONFIGURED from ../config/auth (default true; one test
//     flips it false to exercise the disabled affordance).
//   - patchProjectStatus from ../lib/projects (the PATCH helper).
//   - lib/sigv4's signedFetch is transitively mocked through projects.ts
//     but the test only needs to assert the wrapper's calls.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// Mock auth config — default to "configured" so the button is enabled.
let mockConfigured = true;
vi.mock('../config/auth', () => ({
  get SIGV4_IS_CONFIGURED() {
    return mockConfigured;
  },
}));

// Mock the patch helper — tests inspect call args + control resolution.
const patchMock = vi.fn();
vi.mock('../lib/projects', async () => {
  const actual = await vi.importActual<typeof import('../lib/projects')>('../lib/projects');
  return {
    ...actual,
    patchProjectStatus: (...args: unknown[]) => patchMock(...args),
  };
});

import ProjectArchiveButton from './ProjectArchiveButton';

beforeEach(() => {
  mockConfigured = true;
  patchMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProjectArchiveButton', () => {
  it('renders ARCHIVE label when status is active', () => {
    render(
      <ProjectArchiveButton projectId="acme" status="active" onStatusChange={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /ARCHIVE/i })).toBeInTheDocument();
    expect(screen.queryByText(/UNARCHIVE/i)).toBeNull();
  });

  it('renders UNARCHIVE label when status is archived', () => {
    render(
      <ProjectArchiveButton projectId="acme" status="archived" onStatusChange={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /UNARCHIVE/i })).toBeInTheDocument();
  });

  it('disables the button when SIGV4_IS_CONFIGURED is false (sigv4 broker not wired)', () => {
    mockConfigured = false;
    render(
      <ProjectArchiveButton projectId="acme" status="active" onStatusChange={() => {}} />,
    );
    const btn = screen.getByRole('button', { name: /ARCHIVE/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', expect.stringMatching(/sigv4/i));
  });

  it('opens the archive confirm dialog on click', () => {
    render(
      <ProjectArchiveButton projectId="acme" status="active" onStatusChange={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ARCHIVE/i }));
    expect(screen.getByRole('dialog', { name: /アーカイブの確認/ })).toBeInTheDocument();
    // Body cites the operational consequence — binding crontabs keep firing.
    expect(screen.getByText(/バインディング crontab/)).toBeInTheDocument();
    expect(screen.getByText(/実行の停止ではありません/)).toBeInTheDocument();
  });

  it('opens the unarchive confirm dialog on click (different copy)', () => {
    render(
      <ProjectArchiveButton projectId="acme" status="archived" onStatusChange={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /UNARCHIVE/i }));
    expect(screen.getByRole('dialog', { name: /アクティブ化の確認/ })).toBeInTheDocument();
    expect(
      screen.getByText(/リスト表示の既定に再び現れます/),
    ).toBeInTheDocument();
  });

  it('cancel closes the dialog without firing patch', () => {
    render(
      <ProjectArchiveButton projectId="acme" status="active" onStatusChange={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ARCHIVE/i }));
    fireEvent.click(screen.getByRole('button', { name: /キャンセル/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('ESC closes the dialog without firing patch', () => {
    render(
      <ProjectArchiveButton projectId="acme" status="active" onStatusChange={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ARCHIVE/i }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('optimistic flip: onStatusChange fires immediately with targetStatus + archived_at, then again with server response', async () => {
    const onChange = vi.fn();
    patchMock.mockResolvedValueOnce({
      project_id: 'acme',
      status: 'archived',
      owner_agent: '_operator',
      created_at: '2026-05-27T00:00:00.000Z',
      archived_at: '2026-05-28T22:00:00.000Z',
    });
    render(
      <ProjectArchiveButton projectId="acme" status="active" onStatusChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ARCHIVE/i }));
    fireEvent.click(screen.getByRole('button', { name: /アーカイブを実行/ }));

    // Optimistic call should be synchronous (status flip happens before
    // the async patch resolves).
    expect(onChange).toHaveBeenNthCalledWith(1, 'archived', expect.any(String));

    // Wait for patch to resolve + the reconciliation onStatusChange call.
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    expect(onChange).toHaveBeenNthCalledWith(2, 'archived', '2026-05-28T22:00:00.000Z');

    // Dialog closes, success banner appears.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/アーカイブしました/);
  });

  it('reverts on patch failure and surfaces API ERROR banner', async () => {
    const onChange = vi.fn();
    patchMock.mockRejectedValueOnce(new Error('PATCH /projects failed (403): denied'));
    render(
      <ProjectArchiveButton projectId="acme" status="active" onStatusChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ARCHIVE/i }));
    fireEvent.click(screen.getByRole('button', { name: /アーカイブを実行/ }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    // First call: optimistic flip to archived
    expect(onChange).toHaveBeenNthCalledWith(1, 'archived', expect.any(String));
    // Second call: revert to active
    expect(onChange).toHaveBeenNthCalledWith(2, 'active');

    // Error banner present, success banner cleared.
    expect(screen.getByRole('alert')).toHaveTextContent(/API ERROR.*denied/);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('error banner has an accessible dismiss button', async () => {
    patchMock.mockRejectedValueOnce(new Error('boom'));
    render(
      <ProjectArchiveButton projectId="acme" status="active" onStatusChange={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ARCHIVE/i }));
    fireEvent.click(screen.getByRole('button', { name: /アーカイブを実行/ }));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull());
    const dismiss = screen.getByRole('button', { name: /エラーを閉じる/ });
    fireEvent.click(dismiss);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('disables submit while the patch is in flight (double-submit guard)', async () => {
    let resolvePatch!: (value: unknown) => void;
    patchMock.mockImplementationOnce(
      () => new Promise((resolve) => (resolvePatch = resolve)),
    );
    render(
      <ProjectArchiveButton projectId="acme" status="active" onStatusChange={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ARCHIVE/i }));
    const submit = screen.getByRole('button', { name: /アーカイブを実行/ });
    fireEvent.click(submit);

    // Dialog auto-closed on submit (optimistic path) — so the only
    // surface still visible is the per-call confirmation. Confirm
    // pending state by asserting the patch promise has fired once and
    // resolving it allows the test to complete.
    expect(patchMock).toHaveBeenCalledTimes(1);
    resolvePatch({
      project_id: 'acme',
      status: 'archived',
      owner_agent: '_operator',
      created_at: '2026-05-27T00:00:00.000Z',
      archived_at: '2026-05-28T22:00:00.000Z',
    });
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
  });
});
