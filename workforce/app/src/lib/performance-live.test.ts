// Unit test for the LIVE branch of loadPerformance() — separate file from
// performance.test.ts because WORKFORCE_AGENTS_API_BASE is mocked at module
// load time and the two branches (configured vs unconfigured) can't share a
// mock within one file.
//
// Regression test for the 2026-07-24 operator report: the live endpoint can
// serve a window frozen at its last backfill (Epic-016 OP-011/OP-012 still
// unwired), which read as "the graph's dates never update". loadPerformance
// must re-axis a live series to a window ending today, exactly like the mock
// fallback already does.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/api', () => ({
  WORKFORCE_AGENTS_API_BASE: 'https://api.example.test',
}));

import { loadPerformance, WORKFORCE_SCOPE } from './performance';
import type { PerformanceSeries } from '../types/performance';

function staleLiveSeries(): PerformanceSeries {
  return {
    scope: 'workforce',
    generated_at: '2026-06-23T00:00:00Z',
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
  it('re-axises a stale live series to a window ending today', async () => {
    const r = await loadPerformance(WORKFORCE_SCOPE);
    expect(r.source).toBe('live');
    const today = new Date().toISOString().slice(0, 10);
    expect(r.series.window.end).toBe(today);
    expect(r.series.lifecycle[r.series.lifecycle.length - 1].date).toBe(today);
    // Values are preserved — only the date labels move.
    expect(r.series.lifecycle[r.series.lifecycle.length - 1].delivered).toBe(6);
  });
});
