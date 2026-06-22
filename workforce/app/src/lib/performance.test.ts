// Unit tests for lib/performance — the mock-fallback path (the gh-pages /
// local-dev default when WORKFORCE_AGENTS_API_BASE is unset) plus the
// deliveredShare helper. config/api is mocked to the unconfigured ('') base
// so loadPerformance takes the bundled-dataset branch; global fetch returns a
// fixture dataset.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/api', () => ({
  WORKFORCE_AGENTS_API_BASE: '',
}));

import {
  apiConfigured,
  loadPerformance,
  WORKFORCE_SCOPE,
  projectScope,
} from './performance';
import { deliveredShare } from '../types/performance';
import type { PerformanceDataset, PerformanceSeries } from '../types/performance';

function series(scope: string): PerformanceSeries {
  return {
    scope,
    generated_at: '2026-06-22T00:00:00Z',
    window: { start: '2026-06-01', end: '2026-06-02' },
    lifecycle: [
      { date: '2026-06-01', registered: 5, assigned: 3, delivered: 2 },
      { date: '2026-06-02', registered: 2, assigned: 3, delivered: 5 },
    ],
    pr_daily: [{ date: '2026-06-02', prs: 4, autopilot_merged: 3, additions: 120, deletions: 30 }],
    pr_summary: {
      total_prs: 4,
      autopilot_merged: 3,
      autopilot_share: 0.75,
      total_additions: 120,
      total_deletions: 30,
      humans_involved: ['refluster'],
    },
    pr_contributors: [{ handle: 'nadia', kind: 'agent', prs: 3 }],
  };
}

const DATASET: PerformanceDataset = {
  generated_at: '2026-06-22T00:00:00Z',
  workforce: series('workforce'),
  projects: { editorial: series('editorial') },
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(DATASET), { status: 200 })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lib/performance (mock fallback)', () => {
  it('apiConfigured is false when the base is unset', () => {
    expect(apiConfigured()).toBe(false);
  });

  it('loads the workforce scope from the bundled dataset', async () => {
    const r = await loadPerformance(WORKFORCE_SCOPE);
    expect(r.series.scope).toBe('workforce');
    expect(r.source).toBe('mock');
    expect(r.series.pr_summary.autopilot_share).toBe(0.75);
  });

  it('loads a present project scope', async () => {
    const r = await loadPerformance(projectScope('editorial'));
    expect(r.series.scope).toBe('editorial');
    expect(r.source).toBe('mock');
  });

  it('synthesizes a deterministic series for a project absent from the fixture', async () => {
    const r1 = await loadPerformance(projectScope('does-not-exist'));
    expect(r1.series.scope).toBe('does-not-exist');
    expect(r1.series.lifecycle.length).toBeGreaterThan(0);
    expect(r1.series.pr_daily.length).toBeGreaterThan(0);
    // Deterministic: same id → identical synthesized totals.
    const r2 = await loadPerformance(projectScope('does-not-exist'));
    expect(r2.series.pr_summary.total_prs).toBe(r1.series.pr_summary.total_prs);
  });

  it('re-axises dates to a window ending today', async () => {
    const r = await loadPerformance(WORKFORCE_SCOPE);
    const today = new Date().toISOString().slice(0, 10);
    expect(r.series.window.end).toBe(today);
    expect(r.series.lifecycle[r.series.lifecycle.length - 1].date).toBe(today);
  });
});

describe('deliveredShare', () => {
  it('is delivered / total', () => {
    expect(deliveredShare({ date: 'x', registered: 2, assigned: 3, delivered: 5 })).toBe(0.5);
  });
  it('is 0 for an empty cohort (no NaN)', () => {
    expect(deliveredShare({ date: 'x', registered: 0, assigned: 0, delivered: 0 })).toBe(0);
  });
});
