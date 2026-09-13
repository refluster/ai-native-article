// Regression test for the churn deck's false zero.
//
// Production 2026-09-13: one shared PAT's hourly REST quota was exhausted, so
// GitHub answered every `/stats/code_frequency` call with a 403. The builder
// did the right thing — it wrote the `code_churn` degraded signal rather than
// claiming a measurement — but the summed total it wrote alongside was 0, and
// the deck printed that 0 in headline type under "CODE CHURN" with the caveat
// relegated to a footnote. A reader saw "+0 lines" where the honest answer was
// "we do not know".
//
// `wf:owen` O3: an unknown is never a measured zero.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import RepoPerformancePanel from './RepoPerformancePanel';
import type { RepoActivityResult } from '../lib/repoActivity';

const loadRepoActivityMock = vi.fn<() => Promise<RepoActivityResult>>();
vi.mock('../lib/repoActivity', async () => {
  const actual = await vi.importActual<typeof import('../lib/repoActivity')>('../lib/repoActivity');
  return { ...actual, loadRepoActivity: () => loadRepoActivityMock() };
});

function result(degraded?: string[]): RepoActivityResult {
  return {
    workforce: {
      scope: 'workforce',
      window: { start: '2026-03-17', end: '2026-09-13', days: 180 },
      issues_daily: [{ date: '2026-09-13', opened: 3, closed: 1 }],
      prs_daily: [{ date: '2026-09-13', opened: 5, closed: 4 }],
      code_churn_weekly: degraded?.includes('code_churn')
        ? []
        : [{ week_start: '2026-09-07', additions: 4321, deletions: 765 }],
      summary: {
        issues_opened: 3,
        issues_closed: 1,
        prs_opened: 5,
        prs_closed: 4,
        total_additions: degraded?.includes('code_churn') ? 0 : 4321,
        total_deletions: degraded?.includes('code_churn') ? 0 : 765,
      },
      ...(degraded?.length ? { degraded_signals: degraded } : {}),
    },
    repos: ['agent-workforce'],
    generatedAt: new Date().toISOString(),
    source: 'live',
  };
}

afterEach(() => {
  cleanup();
  loadRepoActivityMock.mockReset();
});

describe('RepoPerformancePanel — degraded churn', () => {
  it('reports churn as unknown instead of printing the zero the outage produced', async () => {
    loadRepoActivityMock.mockResolvedValue(result(['code_churn']));
    render(<RepoPerformancePanel />);

    expect(await screen.findByText('unknown this run — not zero')).toBeInTheDocument();
    expect(screen.queryByText('+0')).not.toBeInTheDocument();
    // The chart must not plot a flat zero series either — a quiet week and a
    // missing measurement look identical once they are bars.
    expect(screen.getByText(/did not serve churn statistics/i)).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Code line additions vs deletions/i),
    ).not.toBeInTheDocument();
  });

  it('still prints a real measurement when churn is not degraded', async () => {
    loadRepoActivityMock.mockResolvedValue(result());
    render(<RepoPerformancePanel />);

    expect(await screen.findByText('+4,321')).toBeInTheDocument();
    expect(screen.getByText('−765 lines')).toBeInTheDocument();
    expect(screen.queryByText(/did not serve churn statistics/i)).not.toBeInTheDocument();
  });

  it('leaves the other degraded signals reading as undercounts, not unknowns', async () => {
    loadRepoActivityMock.mockResolvedValue(result(['issues_opened']));
    render(<RepoPerformancePanel />);

    expect(await screen.findByText('+4,321')).toBeInTheDocument();
    expect(screen.getByText(/degraded this run: issues_opened/)).toBeInTheDocument();
  });
});
