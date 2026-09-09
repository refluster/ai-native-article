// Regression tests for the per-block staleness advisory.
//
// The 2026-07-24 version of this panel checked `series.generated_at`, which
// the endpoint sets to its own clock on every request. The check could
// therefore never fire, and the panel reported "live data as of <now>" every
// morning while the PR roll-up underneath sat frozen at its 2026-07-26
// publish for 45 days (operator report, 2026-09-09).
//
// So these tests assert the property that actually protects the deck: each
// block is measured against ITS OWN writer's timestamp, and a fresh
// `generated_at` cannot mask a stale block.

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

const isoDaysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const dateDaysAgo = (d: number) => isoDaysAgo(d).slice(0, 10);

/** A live series with independently controllable per-block ages. */
function series(opts: { lifecycleDate?: string; prUpdatedAt?: string | null } = {}): PerformanceSeries {
  const { lifecycleDate = dateDaysAgo(0), prUpdatedAt = isoDaysAgo(0) } = opts;
  return {
    scope: 'workforce',
    // Deliberately always current: the endpoint really does behave this way,
    // and no assertion below may depend on it.
    generated_at: new Date().toISOString(),
    window: { start: dateDaysAgo(180), end: lifecycleDate },
    lifecycle: [{ date: lifecycleDate, registered: 2, assigned: 3, delivered: 5 }],
    pr_daily: [{ date: lifecycleDate, prs: 4, autopilot_merged: 3, additions: 120, deletions: 30 }],
    pr_summary: {
      total_prs: 4,
      autopilot_merged: 3,
      autopilot_share: 0.75,
      total_additions: 120,
      total_deletions: 30,
      humans_involved: [],
    },
    pr_contributors: [],
    ...(prUpdatedAt === null ? {} : { pr_updated_at: prUpdatedAt }),
  };
}

afterEach(() => {
  cleanup();
  loadPerformanceMock.mockReset();
});

describe('PerformancePanels — per-block staleness advisory', () => {
  it('shows only the illustrative note for a mock source', async () => {
    loadPerformanceMock.mockResolvedValue({ series: series(), source: 'mock' });
    render(<PerformancePanels scope={WORKFORCE_SCOPE} />);
    expect(await screen.findByText(/illustrative/i)).toBeInTheDocument();
    expect(screen.queryByText(/has not been refreshed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/lifecycle through/i)).not.toBeInTheDocument();
  });

  it('reports both blocks live when both writers ran today', async () => {
    loadPerformanceMock.mockResolvedValue({ series: series(), source: 'live' });
    render(<PerformancePanels scope={WORKFORCE_SCOPE} />);
    expect(await screen.findByText(/lifecycle through/i)).toBeInTheDocument();
    expect(screen.queryByText(/has not been\s+refreshed/i)).not.toBeInTheDocument();
  });

  // THE regression: a frozen PR block behind a fresh response. Under the old
  // generated_at check this rendered as healthy.
  it('flags a frozen PR block even though generated_at is current', async () => {
    loadPerformanceMock.mockResolvedValue({
      series: series({ prUpdatedAt: isoDaysAgo(45) }),
      source: 'live',
    });
    render(<PerformancePanels scope={WORKFORCE_SCOPE} />);
    expect(
      await screen.findByText(/PR automation has not been refreshed in over 30h/i),
    ).toBeInTheDocument();
    // The lifecycle funnel is fine here and must not be blamed for it.
    expect(screen.queryByText(/agent lifecycle and PR automation/i)).not.toBeInTheDocument();
    // …and the frozen block's real publish time is named, not generated_at.
    expect(screen.getByText(/PR roll-up 2026-07-26/)).toBeInTheDocument();
  });

  it('flags a stalled lifecycle reducer from its last daily point', async () => {
    loadPerformanceMock.mockResolvedValue({
      series: series({ lifecycleDate: dateDaysAgo(4) }),
      source: 'live',
    });
    render(<PerformancePanels scope={WORKFORCE_SCOPE} />);
    expect(
      await screen.findByText(/agent lifecycle has not been refreshed in over 30h/i),
    ).toBeInTheDocument();
  });

  // "Never published" is an unknown, and an unknown is never rounded to fresh
  // (the PerfIdleRow consumer contract, applied to the PR block).
  it('treats a PR block that was never published as stale, not as fresh', async () => {
    loadPerformanceMock.mockResolvedValue({
      series: series({ prUpdatedAt: null }),
      source: 'live',
    });
    render(<PerformancePanels scope={WORKFORCE_SCOPE} />);
    expect(
      await screen.findByText(/PR automation has not been refreshed.*never published/i),
    ).toBeInTheDocument();
  });

  // A point dated today is at most ~24h old by construction; it must not trip
  // the 30h threshold just because the day started.
  it('does not flag a lifecycle point dated today', async () => {
    loadPerformanceMock.mockResolvedValue({
      series: series({ lifecycleDate: dateDaysAgo(0) }),
      source: 'live',
    });
    render(<PerformancePanels scope={WORKFORCE_SCOPE} />);
    expect(await screen.findByText(/lifecycle through/i)).toBeInTheDocument();
    expect(screen.queryByText(/agent lifecycle has not been/i)).not.toBeInTheDocument();
  });
});
