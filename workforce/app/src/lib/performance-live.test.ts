// Unit test for the LIVE branch of loadPerformance() — separate file from
// performance.test.ts because WORKFORCE_AGENTS_API_BASE is mocked at module
// load time and the two branches (configured vs unconfigured) can't share a
// mock within one file.
//
// This file used to assert the OPPOSITE of what it asserts now, and the
// reversal is the point.
//
// 2026-07-24: the live endpoint served a window frozen at its last backfill
// (the daily PR refresh was unwired), which read as "the graph's dates never
// update". The fix re-axised the live series to a window ending today.
//
// 2026-09-09: that fix is what let the PR block sit unchanged from 2026-07-26
// for 45 days without anyone noticing — the axis advanced every morning over
// numbers that never moved, so the deck looked alive (operator report). The
// refresh now has a scheduled owner that cannot quietly stop being scheduled
// (.github/workflows/workforce-performance-refresh.yml), so a live series is
// plotted on the dates the backend actually published, and staleness is
// reported rather than papered over. Re-axising stays on the mock path, where
// there are no real dates to misrepresent.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/api', () => ({
  WORKFORCE_AGENTS_API_BASE: 'https://api.example.test',
}));

import { loadPerformance, WORKFORCE_SCOPE } from './performance';
import type { PerformanceSeries } from '../types/performance';

function staleLiveSeries(): PerformanceSeries {
  return {
    scope: 'workforce',
    // The endpoint stamps its own clock here on every request, so it is always
    // "now" and says nothing about the data's age — the trap the panel's
    // staleness check fell into. The real age lives in `pr_updated_at`.
    generated_at: new Date().toISOString(),
    window: { start: '2026-05-27', end: '2026-06-23' },
    lifecycle: [
      { date: '2026-05-27', registered: 4, assigned: 3, delivered: 3 },
      { date: '2026-06-23', registered: 5, assigned: 4, delivered: 6 },
    ],
    pr_daily: [{ date: '2026-06-23', prs: 4, autopilot_merged: 1, additions: 100, deletions: 20 }],
    pr_summary: {
      total_prs: 4,
      autopilot_merged: 1,
      autopilot_share: 0.25,
      total_additions: 100,
      total_deletions: 20,
      humans_involved: ['refluster'],
    },
    pr_contributors: [{ handle: 'nadia', kind: 'agent', prs: 1 }],
    pr_updated_at: '2026-06-23T00:00:00Z',
  };
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(staleLiveSeries()), { status: 200 })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lib/performance (live path)', () => {
  it('serves a live series on the dates the backend published, never re-axised', async () => {
    const r = await loadPerformance(WORKFORCE_SCOPE);
    expect(r.source).toBe('live');
    const today = new Date().toISOString().slice(0, 10);
    expect(today).not.toBe('2026-06-23'); // guard: the fixture must read as old
    expect(r.series.window).toEqual({ start: '2026-05-27', end: '2026-06-23' });
    expect(r.series.lifecycle[r.series.lifecycle.length - 1].date).toBe('2026-06-23');
    expect(r.series.lifecycle[r.series.lifecycle.length - 1].delivered).toBe(6);
  });

  // pr_daily is the series PrAutomationPanel renders, and it is the one that
  // actually froze. Asserted separately from lifecycle because the two have
  // independent lengths — the old reaxis() computed two offsets, and a mix-up
  // between them would pass a lifecycle-only assertion.
  it('leaves pr_daily on its published dates too', async () => {
    const r = await loadPerformance(WORKFORCE_SCOPE);
    expect(r.series.pr_daily[r.series.pr_daily.length - 1].date).toBe('2026-06-23');
    expect(r.series.pr_daily[r.series.pr_daily.length - 1].prs).toBe(4);
  });

  it('passes pr_updated_at through so the panel can measure the block, not the response', async () => {
    const r = await loadPerformance(WORKFORCE_SCOPE);
    expect(r.series.pr_updated_at).toBe('2026-06-23T00:00:00Z');
    expect(r.series.pr_updated_at).not.toBe(r.series.generated_at);
  });
});
