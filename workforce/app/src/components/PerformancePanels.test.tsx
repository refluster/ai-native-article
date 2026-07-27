// Regression tests for the generated_at / staleness advisory added in
// response to a pr-autopilot cycle-1 finding (`wf:tomas`, 2026-07-24):
// reaxis() relabels a live series' dates without touching `generated_at`, so
// this panel must surface that field directly rather than let a re-mapped
// axis look current when the underlying live snapshot is actually stale.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import PerformancePanels from './PerformancePanels';
import { WORKFORCE_SCOPE } from '../lib/performance';
import type { PerformanceSeries } from '../types/performance';
import type { PerformanceResult } from '../lib/performance';

const loadPerformanceMock = vi.fn<(scope: unknown) => Promise<PerformanceResult>>();
vi.mock('../lib/performance', async () => {
  const actual = await vi.importActual<typeof import('../lib/performance')>('../lib/performance');
  return { ...actual, loadPerformance: (scope: unknown) => loadPerformanceMock(scope) };
});

function series(generated_at: string): PerformanceSeries {
  return {
    scope: 'workforce',
    generated_at,
    window: { start: '2026-06-01', end: '2026-06-02' },
    lifecycle: [{ date: '2026-06-02', registered: 2, assigned: 3, delivered: 5 }],
    pr_daily: [{ date: '2026-06-02', prs: 4, autopilot_merged: 3, additions: 120, deletions: 30 }],
    pr_summary: {
      total_prs: 4,
      autopilot_merged: 3,
      autopilot_share: 0.75,
      total_additions: 120,
      total_deletions: 30,
      humans_involved: [],
    },
    pr_contributors: [],
  };
}

afterEach(() => {
  cleanup();
  loadPerformanceMock.mockReset();
});

describe('PerformancePanels — generated_at / staleness advisory', () => {
  it('shows only the illustrative note for a mock source, no generated_at line', async () => {
    loadPerformanceMock.mockResolvedValue({ series: series(new Date().toISOString()), source: 'mock' });
    render(<PerformancePanels scope={WORKFORCE_SCOPE} />);
    expect(await screen.findByText(/illustrative/i)).toBeInTheDocument();
    expect(screen.queryByText(/live data/i)).not.toBeInTheDocument();
  });

  it('shows a plain "live data as of" note for a fresh live source', async () => {
    loadPerformanceMock.mockResolvedValue({ series: series(new Date().toISOString()), source: 'live' });
    render(<PerformancePanels scope={WORKFORCE_SCOPE} />);
    expect(await screen.findByText(/live data as of/i)).toBeInTheDocument();
    expect(screen.queryByText(/backend refresh may be behind/i)).not.toBeInTheDocument();
  });

  it('flags a live source whose generated_at is stale (>26h old)', async () => {
    const staleIso = new Date(Date.now() - 30 * 3_600_000).toISOString();
    loadPerformanceMock.mockResolvedValue({ series: series(staleIso), source: 'live' });
    render(<PerformancePanels scope={WORKFORCE_SCOPE} />);
    expect(await screen.findByText(/backend refresh may be behind/i)).toBeInTheDocument();
  });
});
