// Tests for BindingsEditor — issue GH-736 (Epic-010 Story 6b): the add-binding
// form's project_id field defaults to this agent's own `self/{slug}` project
// (Epic-010 §2/§3's stated default — the runner resolves a task's project_id
// to `self` when a binding doesn't name one) and offers a selector of known
// projects once the list loads, rather than staying blank/free-text-only.
//
// Mocks follow the house pattern (ProjectArchiveButton.test.tsx):
//   - SIGV4_IS_CONFIGURED from ../config/auth (true — the add form only
//     renders when the sigv4 broker is configured).
//   - fetchBindableSkills / patchAgentBindings from ../lib/agents.
//   - fetchProjects from ../lib/projects.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ProjectSummary } from '../types/project';
import type { AgentBinding } from '../types/agent';

vi.mock('../config/auth', () => ({ SIGV4_IS_CONFIGURED: true }));

const fetchBindableSkillsMock = vi.fn();
const patchAgentBindingsMock = vi.fn();
vi.mock('../lib/agents', async () => {
  const actual = await vi.importActual<typeof import('../lib/agents')>('../lib/agents');
  return {
    ...actual,
    fetchBindableSkills: (...args: unknown[]) => fetchBindableSkillsMock(...args),
    patchAgentBindings: (...args: unknown[]) => patchAgentBindingsMock(...args),
  };
});

const fetchProjectsMock = vi.fn();
vi.mock('../lib/projects', async () => {
  const actual = await vi.importActual<typeof import('../lib/projects')>('../lib/projects');
  return {
    ...actual,
    fetchProjects: (...args: unknown[]) => fetchProjectsMock(...args),
  };
});

import BindingsEditor from './BindingsEditor';

function project(id: string, name?: string): ProjectSummary {
  return {
    project_id: id,
    status: 'active',
    owner_agent: '_operator',
    created_at: '2026-05-27T00:00:00.000Z',
    ...(name ? { name } : {}),
  };
}

beforeEach(() => {
  fetchBindableSkillsMock.mockReset().mockResolvedValue(['feed-post', 'daily-research']);
  patchAgentBindingsMock.mockReset();
  fetchProjectsMock.mockReset().mockResolvedValue([
    project('self/ren'),
    project('agent-workforce', 'Workforce (internal)'),
    project('asp-cloud', 'ASP Cloud'),
  ]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function openAddForm() {
  fireEvent.click(screen.getByRole('button', { name: /BIND SKILL/i }));
}

describe('BindingsEditor — add-binding project_id (issue GH-736)', () => {
  it('defaults the project selector to this agent\'s own self/{slug} project', async () => {
    render(<BindingsEditor slug="ren" bindings={[]} onUpdated={() => {}} />);
    openAddForm();

    await waitFor(() => expect(fetchProjectsMock).toHaveBeenCalledWith({ includeSelf: true }));
    const select = await screen.findByRole('combobox', { name: /project id/i });
    expect((select as HTMLSelectElement).value).toBe('self/ren');
  });

  it('lists the fetched projects as options, self included', async () => {
    render(<BindingsEditor slug="ren" bindings={[]} onUpdated={() => {}} />);
    openAddForm();

    const select = await screen.findByRole('combobox', { name: /project id/i });
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toEqual(
      expect.arrayContaining(['self/ren', 'agent-workforce', 'asp-cloud']),
    );
  });

  it('falls back to a free-text project id input when the project list fails to load', async () => {
    fetchProjectsMock.mockRejectedValueOnce(new Error('agents-api 500'));
    render(<BindingsEditor slug="ren" bindings={[]} onUpdated={() => {}} />);
    openAddForm();

    await waitFor(() => expect(fetchProjectsMock).toHaveBeenCalled());
    const input = await screen.findByLabelText(/project id/i);
    expect(input.tagName).toBe('INPUT');
    expect((input as HTMLInputElement).value).toBe('self/ren');
  });

  it('binding with the default selection sends project_id=self/{slug} to the API', async () => {
    patchAgentBindingsMock.mockResolvedValueOnce([] as AgentBinding[]);
    render(<BindingsEditor slug="ren" bindings={[]} onUpdated={() => {}} />);
    openAddForm();

    // Skill select is populated from fetchBindableSkills.
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /skill to bind/i })).toBeInTheDocument(),
    );
    await screen.findByRole('combobox', { name: /project id/i });

    fireEvent.click(screen.getByRole('button', { name: /^BIND$/i }));

    await waitFor(() => expect(patchAgentBindingsMock).toHaveBeenCalledTimes(1));
    const [, sentBindings] = patchAgentBindingsMock.mock.calls[0] as [string, AgentBinding[]];
    expect(sentBindings).toHaveLength(1);
    expect(sentBindings[0]!.project_id).toBe('self/ren');
  });

  it('picking a different project from the selector is sent on bind', async () => {
    patchAgentBindingsMock.mockResolvedValueOnce([] as AgentBinding[]);
    render(<BindingsEditor slug="ren" bindings={[]} onUpdated={() => {}} />);
    openAddForm();

    const projectSelect = await screen.findByRole('combobox', { name: /project id/i });
    fireEvent.change(projectSelect, { target: { value: 'asp-cloud' } });
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /skill to bind/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /^BIND$/i }));

    await waitFor(() => expect(patchAgentBindingsMock).toHaveBeenCalledTimes(1));
    const [, sentBindings] = patchAgentBindingsMock.mock.calls[0] as [string, AgentBinding[]];
    expect(sentBindings[0]!.project_id).toBe('asp-cloud');
  });
});
