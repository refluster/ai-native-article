// Regression test for the panel's date-range header.
//
// `series.window` is the PR roll-up's window whenever a PR block exists
// (composeSeries prefers it over the lifecycle range). While the PR refresh
// was frozen, this panel therefore labelled a funnel whose points ran to
// today with "2026-04-27 → 2026-07-26" — the panel disclaiming its own chart
// (operator screenshot, 2026-09-09). Two blocks written by two different
// daily writers cannot share one honest date label.

import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import AgentLifecyclePanel from './AgentLifecyclePanel';
import type { PerformanceSeries } from '../types/performance';

function series(overrides: Partial<PerformanceSeries> = {}): PerformanceSeries {
  return {
    scope: 'workforce',
    generated_at: '2026-09-09T15:00:00Z',
    // Deliberately stale and deliberately NOT the lifecycle's range: this is
    // the frozen PR block's window, exactly as production served it.
    window: { start: '2026-04-27', end: '2026-07-26' },
    lifecycle: [
      { date: '2026-06-29', registered: 1, assigned: 2, delivered: 28 },
      { date: '2026-09-09', registered: 0, assigned: 1, delivered: 57 },
    ],
    pr_daily: [],
    pr_summary: {
      total_prs: 0,
      autopilot_merged: 0,
      autopilot_share: 0,
      total_additions: 0,
      total_deletions: 0,
      humans_involved: [],
    },
    pr_contributors: [],
    ...overrides,
  };
}

afterEach(cleanup);

describe('AgentLifecyclePanel — date-range header', () => {
  it("labels the panel with the lifecycle's own range, not the PR block's window", () => {
    render(<AgentLifecyclePanel series={series()} />);
    expect(screen.getByText('2026-06-29 → 2026-09-09')).toBeInTheDocument();
    expect(screen.queryByText('2026-04-27 → 2026-07-26')).not.toBeInTheDocument();
  });

  it('renders a placeholder rather than a bogus range when there are no points', () => {
    render(<AgentLifecyclePanel series={series({ lifecycle: [] })} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('2026-04-27 → 2026-07-26')).not.toBeInTheDocument();
  });
});
