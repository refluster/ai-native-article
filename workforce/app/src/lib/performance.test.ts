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
  vi.resetModules();
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
    const s = await loadPerformance(WORKFORCE_SCOPE);
    expect(s?.scope).toBe('workforce');
    expect(s?.pr_summary.autopilot_share).toBe(0.75);
  });

  it('loads a present project scope', async () => {
    const s = await loadPerformance(projectScope('editorial'));
    expect(s?.scope).toBe('editorial');
  });

  it('returns undefined for a project with no series (honest empty state)', async () => {
    const s = await loadPerformance(projectScope('does-not-exist'));
    expect(s).toBeUndefined();
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
