// RTL tests for the CredentialVault component. Backend boundaries are
// mocked at lib/credentials so we exercise the component's local state
// machine + render branches without touching real HTTP or SigV4.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  CredentialMetadata,
  DeleteCredentialResponse,
  PutCredentialResponse,
} from '../types/project';

vi.mock('../lib/credentials', async () => {
  // Pull the canonical CREDENTIAL_TYPES + credentialsApiConfigured stubs
  // from a slim factory; fetchCredentials / putCredential / deleteCredential
  // are vi.fn()s the tests can configure per-case.
  return {
    CREDENTIAL_TYPES: [
      'anthropic.api_key',
      'discord.bot_token',
      'github.token',
      'notion.integration_token',
      'voyage.api_key',
    ] as const,
    credentialsApiConfigured: vi.fn(() => true),
    fetchCredentials: vi.fn(),
    putCredential: vi.fn(),
    deleteCredential: vi.fn(),
  };
});

vi.mock('../config/api', () => ({
  WORKFORCE_AGENTS_API_BASE: 'https://agents.example/api',
  WORKFORCE_CREDENTIALS_API_BASE: 'https://creds.example/api',
}));

import CredentialVault from './CredentialVault';
import {
  credentialsApiConfigured,
  deleteCredential,
  fetchCredentials,
  putCredential,
} from '../lib/credentials';

const mockedFetch = vi.mocked(fetchCredentials);
const mockedPut = vi.mocked(putCredential);
const mockedDelete = vi.mocked(deleteCredential);
const mockedConfigured = vi.mocked(credentialsApiConfigured);

function makeRow(type: string, overrides: Partial<CredentialMetadata> = {}): CredentialMetadata {
  return {
    credential_type: type,
    name: `wf/foo/${type}`,
    secret_arn: `arn:aws:secretsmanager:us-east-1:1:secret:wf/foo/${type}`,
    last_changed_at: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

function makePutResponse(
  type: string,
  outcome: 'created' | 'rotated',
): PutCredentialResponse {
  return {
    project_id: 'foo',
    credential_type: type,
    name: `wf/foo/${type}`,
    secret_arn: `arn:aws:secretsmanager:us-east-1:1:secret:wf/foo/${type}`,
    outcome,
    last_changed_at: '2026-05-28T12:00:00Z',
  };
}

function makeDeleteResponse(type: string): DeleteCredentialResponse {
  return {
    project_id: 'foo',
    credential_type: type,
    name: `wf/foo/${type}`,
    secret_arn: `arn:aws:secretsmanager:us-east-1:1:secret:wf/foo/${type}`,
    deletion_date: '2026-06-04T00:00:00Z',
    recovery_window_days: 7,
  };
}

beforeEach(() => {
  mockedFetch.mockReset();
  mockedPut.mockReset();
  mockedDelete.mockReset();
  mockedConfigured.mockReset();
  mockedConfigured.mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ─── loading branch ───────────────────────────────────────────────────

describe('loading branch', () => {
  it('renders the loading indicator while fetchCredentials is pending', async () => {
    let resolve: (items: CredentialMetadata[]) => void = () => {};
    mockedFetch.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    render(<CredentialVault projectId="foo" />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();

    await act(async () => {
      resolve([]);
    });
    await waitFor(() => {
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    });
  });
});

// ─── error branch (initial fetch) ─────────────────────────────────────

describe('error branch (initial fetch)', () => {
  it('renders error message and refetch button when fetchCredentials rejects', async () => {
    mockedFetch.mockRejectedValueOnce(new Error('agents-api 500'));
    render(<CredentialVault projectId="foo" />);

    await waitFor(() => {
      expect(
        screen.getByText('Failed to load credentials.'),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/agents-api 500/)).toBeInTheDocument();
    // Re-fetch buttons (both header + inline) are labeled REFETCH.
    const refetchButtons = screen.getAllByRole('button', { name: 'REFETCH' });
    expect(refetchButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('clicking refetch retriggers fetchCredentials', async () => {
    mockedFetch.mockRejectedValueOnce(new Error('agents-api 500'));
    render(<CredentialVault projectId="foo" />);

    await waitFor(() => {
      expect(
        screen.getByText('Failed to load credentials.'),
      ).toBeInTheDocument();
    });

    mockedFetch.mockResolvedValueOnce([]);
    const user = userEvent.setup();
    const refetchButtons = screen.getAllByRole('button', { name: 'REFETCH' });
    await user.click(refetchButtons[refetchButtons.length - 1]);

    await waitFor(() => {
      expect(mockedFetch).toHaveBeenCalledTimes(2);
    });
  });
});

// ─── empty / unprovisioned ────────────────────────────────────────────

describe('empty / unprovisioned-only', () => {
  it('renders all 5 types with CREATE buttons when LIST returns []', async () => {
    mockedFetch.mockResolvedValueOnce([]);
    render(<CredentialVault projectId="foo" />);

    await waitFor(() => {
      expect(screen.getByText('0 / 5 provisioned')).toBeInTheDocument();
    });
    const createButtons = screen.getAllByRole('button', { name: 'CREATE' });
    expect(createButtons).toHaveLength(5);
    expect(
      screen.getByText(
        'No credentials registered yet. Use “CREATE” on each type below.',
      ),
    ).toBeInTheDocument();
  });
});

// ─── provisioned rows ─────────────────────────────────────────────────

describe('provisioned rows', () => {
  it('renders provisioned rows with last_changed_at + ROTATE + DELETE', async () => {
    mockedFetch.mockResolvedValueOnce([
      makeRow('github.token', { last_changed_at: '2026-05-01T00:00:00Z' }),
    ]);
    render(<CredentialVault projectId="foo" />);

    await waitFor(() => {
      expect(screen.getByText('1 / 5 provisioned')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'ROTATE' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'DELETE' })).toBeInTheDocument();
    expect(screen.getByText(/changed 2026-05-01/i)).toBeInTheDocument();
  });

  it('renders mixed provisioned/unprovisioned list', async () => {
    mockedFetch.mockResolvedValueOnce([
      makeRow('github.token'),
      makeRow('notion.integration_token'),
    ]);
    render(<CredentialVault projectId="foo" />);

    await waitFor(() => {
      expect(screen.getByText('2 / 5 provisioned')).toBeInTheDocument();
    });
    expect(screen.getAllByRole('button', { name: 'ROTATE' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'CREATE' })).toHaveLength(3);
  });
});

// ─── rotate modal ─────────────────────────────────────────────────────

describe('rotate modal', () => {
  it('opens with type-shape hint when ROTATE clicked on provisioned row', async () => {
    mockedFetch.mockResolvedValueOnce([makeRow('github.token')]);
    render(<CredentialVault projectId="foo" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'ROTATE' })).toBeInTheDocument();
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'ROTATE' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/ROTATE — github\.token/)).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByPlaceholderText(/ghp_/)).toBeInTheDocument();
  });

  it('disables submit until password non-empty AND confirm-text === ROTATE', async () => {
    mockedFetch.mockResolvedValueOnce([makeRow('github.token')]);
    render(<CredentialVault projectId="foo" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'ROTATE' })).toBeInTheDocument();
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'ROTATE' }));

    const submit = screen.getByRole('button', { name: 'Execute rotate' });
    expect(submit).toBeDisabled();

    const dialog = screen.getByRole('dialog');
    const tokenInput = within(dialog).getByPlaceholderText(/ghp_/);
    await user.type(tokenInput, 'ghp_xxx');
    expect(submit).toBeDisabled();

    // The second input in the dialog is the confirmation field.
    // password inputs aren't role=textbox; the only role=textbox is the confirm field.
    const inputs = within(dialog).getAllByRole('textbox');
    const confirmInput = inputs[0];
    await user.type(confirmInput, 'ROTATE');
    expect(submit).toBeEnabled();
  });
});

// ─── create modal ─────────────────────────────────────────────────────

describe('create modal', () => {
  it('renders ONE input for notion.integration_token (apiKey only; db ids are skill constants)', async () => {
    mockedFetch.mockResolvedValueOnce([]);
    render(<CredentialVault projectId="foo" />);

    await waitFor(() => {
      expect(
        screen.getAllByRole('button', { name: 'CREATE' }).length,
      ).toBeGreaterThanOrEqual(5);
    });
    const user = userEvent.setup();
    // Notion is the 4th CREATE in declaration order (index 3).
    const createButtons = screen.getAllByRole('button', { name: 'CREATE' });
    await user.click(createButtons[3]);

    expect(screen.getByText(/CREATE — notion\.integration_token/)).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByPlaceholderText(/secret_/)).toBeInTheDocument();
    // databaseId is no longer collected — the skill embeds the db ids as
    // non-secret constants (see SHAPE_HINTS), so only apiKey is entered.
    expect(within(dialog).queryByPlaceholderText(/32-char hex/)).not.toBeInTheDocument();
  });

  it('builds {value:{token}} for github via the create modal', async () => {
    mockedFetch.mockResolvedValueOnce([]);
    mockedPut.mockResolvedValue(makePutResponse('github.token', 'created'));
    render(<CredentialVault projectId="foo" />);

    await waitFor(() => {
      expect(
        screen.getAllByRole('button', { name: 'CREATE' }).length,
      ).toBeGreaterThanOrEqual(5);
    });
    const user = userEvent.setup();
    const createButtons = screen.getAllByRole('button', { name: 'CREATE' });
    // GitHub is the 3rd CREATE (index 2).
    await user.click(createButtons[2]);

    const dialog = screen.getByRole('dialog');
    const tokenInput = within(dialog).getByPlaceholderText(/ghp_/);
    await user.type(tokenInput, 'ghp_xxx');

    await user.click(within(dialog).getByRole('button', { name: 'Execute create' }));

    await waitFor(() => {
      expect(mockedPut).toHaveBeenCalledWith(
        'foo',
        'github.token',
        { token: 'ghp_xxx' },
      );
    });
  });
});

// ─── delete confirm ───────────────────────────────────────────────────

describe('delete confirm', () => {
  it('renders the 7-day recovery window copy', async () => {
    mockedFetch.mockResolvedValueOnce([makeRow('github.token')]);
    render(<CredentialVault projectId="foo" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'DELETE' })).toBeInTheDocument();
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'DELETE' }));

    expect(screen.getByText('Confirm deletion')).toBeInTheDocument();
    expect(
      screen.getByText(/recovery window keeps it recoverable for 7 days/),
    ).toBeInTheDocument();
  });

  it('flips row to DELETED badge after confirm (optimistic)', async () => {
    mockedFetch.mockResolvedValueOnce([makeRow('github.token')]);
    mockedDelete.mockResolvedValue(makeDeleteResponse('github.token'));
    render(<CredentialVault projectId="foo" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'DELETE' })).toBeInTheDocument();
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'DELETE' }));
    await user.click(screen.getByRole('button', { name: 'Execute delete' }));

    await waitFor(() => {
      expect(screen.getByText(/DELETED — /)).toBeInTheDocument();
    });
  });
});

// ─── optimistic update + error ────────────────────────────────────────

describe('optimistic update + error', () => {
  it('PUT success: bumps last_changed_at immediately + replaces with server response', async () => {
    mockedFetch.mockResolvedValueOnce([
      makeRow('github.token', { last_changed_at: '2026-05-01T00:00:00Z' }),
    ]);
    mockedPut.mockResolvedValue(makePutResponse('github.token', 'rotated'));
    render(<CredentialVault projectId="foo" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'ROTATE' })).toBeInTheDocument();
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'ROTATE' }));

    const dialog = screen.getByRole('dialog');
    const tokenInput = within(dialog).getByPlaceholderText(/ghp_/);
    await user.type(tokenInput, 'ghp_xxx');
    const confirmInput = within(dialog).getAllByRole('textbox')[0];
    await user.type(confirmInput, 'ROTATE');
    await user.click(
      within(dialog).getByRole('button', { name: 'Execute rotate' }),
    );

    // Success banner appears immediately.
    expect(screen.getByText('Rotated')).toBeInTheDocument();
    await waitFor(() => {
      // Server response timestamp surfaces after the PUT resolves.
      expect(screen.getByText(/changed 2026-05-28/)).toBeInTheDocument();
    });
  });

  it('PUT failure: reverts last_changed_at + renders API ERROR banner', async () => {
    mockedFetch.mockResolvedValueOnce([
      makeRow('github.token', { last_changed_at: '2026-05-01T00:00:00Z' }),
    ]);
    mockedPut.mockRejectedValue(new Error('credentials-api 409 · ResourceExistsException'));
    render(<CredentialVault projectId="foo" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'ROTATE' })).toBeInTheDocument();
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'ROTATE' }));

    const dialog = screen.getByRole('dialog');
    const tokenInput = within(dialog).getByPlaceholderText(/ghp_/);
    await user.type(tokenInput, 'ghp_xxx');
    const confirmInput = within(dialog).getAllByRole('textbox')[0];
    await user.type(confirmInput, 'ROTATE');
    await user.click(
      within(dialog).getByRole('button', { name: 'Execute rotate' }),
    );

    await waitFor(() => {
      expect(screen.getByText(/API ERROR/)).toBeInTheDocument();
    });
    expect(screen.getByText(/ResourceExistsException/)).toBeInTheDocument();
    // Snapshot date is restored.
    expect(screen.getByText(/changed 2026-05-01/)).toBeInTheDocument();
  });
});

// ─── config branch ────────────────────────────────────────────────────

describe('config branch', () => {
  it('renders advisory when credentialsApiConfigured() returns false', async () => {
    mockedConfigured.mockReturnValue(false);
    mockedFetch.mockResolvedValueOnce([]);
    render(<CredentialVault projectId="foo" />);

    await waitFor(() => {
      expect(
        screen.getByText(/credentials write disabled/),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/VITE_WORKFORCE_CREDENTIALS_API_BASE/),
    ).toBeInTheDocument();
  });
});
