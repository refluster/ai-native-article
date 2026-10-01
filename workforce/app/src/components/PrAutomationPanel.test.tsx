// pr-autopilot review (farah, QA/SRE lens), PR 729.
//
// build-pr-metrics-github.mjs now drops a merged PR whose detail GitHub
// refused (a spent REST quota, most likely) instead of entering it at
// additions:0, and marks the roll-up `pr_summary.degraded_signals: ["pr_detail"]`.
// That signal reached the DynamoDB row and the API response — composeSeries
// passes `pr_summary` through wholesale — but nothing on this panel rendered
// it: the sibling RepoPerformancePanel already surfaces its own degraded churn
// signal, so the PR-count signal dying silently at the client was the one
// asymmetry left. This is the regression test for the advisory that fixes it.

import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import PrAutomationPanel from './PrAutomationPanel';
import type { PerformanceSeries } from '../types/performance';

afterEach(() => {
  cleanup();
});

function series(degraded?: string[]): PerformanceSeries {
  return {
    scope: 'workforce',
    generated_at: new Date().toISOString(),
    window: { start: '2026-03-17', end: '2026-09-13' },
    lifecycle: [],
    pr_daily: [{ date: '2026-09-13', prs: 4, autopilot_merged: 3, additions: 120, deletions: 30 }],
    pr_summary: {
      total_prs: 4,
      autopilot_merged: 3,
      autopilot_share: 0.75,
      total_additions: 120,
      total_deletions: 30,
      humans_involved: [],
      ...(degraded?.length ? { degraded_signals: degraded } : {}),
    },
    pr_contributors: [],
  };
}

describe('PrAutomationPanel — degraded PR count', () => {
  it('surfaces a dropped-PR signal instead of letting it die at the client', () => {
    render(<PrAutomationPanel series={series(['pr_detail'])} />);
    expect(screen.getByText(/degraded this run: pr_detail/)).toBeInTheDocument();
  });

  it('renders no advisory on a clean run', () => {
    render(<PrAutomationPanel series={series()} />);
    expect(screen.queryByText(/degraded this run/)).not.toBeInTheDocument();
  });
});
