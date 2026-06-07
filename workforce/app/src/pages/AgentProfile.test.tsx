import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MembershipsPanel } from './AgentProfile';
import type { AgentMembership } from '../types/project';

function renderPanel(memberships: AgentMembership[]) {
  return render(
    <MemoryRouter>
      <MembershipsPanel memberships={memberships} />
    </MemoryRouter>,
  );
}

describe('MembershipsPanel', () => {
  afterEach(() => cleanup());

  it('renders valid memberships, surfacing self/ rows last', () => {
    renderPanel([
      { project_id: 'self/maya', joined_at: '2026-05-01T00:00:00Z' },
      { project_id: 'workforce-meta', joined_at: '2026-05-02T00:00:00Z' },
    ]);
    expect(screen.getByText('self/maya')).toBeInTheDocument();
    expect(screen.getByText('workforce-meta')).toBeInTheDocument();
    expect(screen.getByText('2 MEMBERSHIPS')).toBeInTheDocument();
  });

  // Regression: a single malformed membership row (missing project_id) used to
  // throw `Cannot read properties of undefined (reading 'startsWith')` inside
  // the .sort()/.map() callbacks, unmounting the whole agent page (blank
  // screen). The panel must drop bad rows instead of crashing (C-1/C-4).
  it('does not crash when a membership row is missing project_id', () => {
    const rows = [
      { project_id: 'workforce-meta', joined_at: '2026-05-02T00:00:00Z' },
      // malformed legacy row / API shape drift
      { joined_at: '2026-05-03T00:00:00Z' } as unknown as AgentMembership,
    ];
    expect(() => renderPanel(rows)).not.toThrow();
    expect(screen.getByText('workforce-meta')).toBeInTheDocument();
    // only the one valid row counts
    expect(screen.getByText('1 MEMBERSHIPS')).toBeInTheDocument();
  });

  it('tolerates a missing joined_at without crashing', () => {
    renderPanel([
      { project_id: 'workforce-meta' } as unknown as AgentMembership,
    ]);
    expect(screen.getByText('workforce-meta')).toBeInTheDocument();
    expect(screen.getByText(/joined —/)).toBeInTheDocument();
  });
});
