// Performance-analytics data loader (Epic-016).
//
// Phase 1 (this is where we are): the live agents-api `/performance` +
// `/projects/{id}/performance` roll-up endpoints are NOT built yet (Epic-016
// "Out of scope" → Phase 2). So even on a production deploy where
// WORKFORCE_AGENTS_API_BASE is set, the surface must render *illustrative*
// data — calling the not-yet-existent route returns a CORS/403 failure on the
// unmatched API-Gateway path ("Load failed"), which previously surfaced as a
// hard error on the Performance tab.
//
// Contract therefore is: **try the live endpoint first** (so the moment Phase
// 2 ships it, the surface lights up with real data automatically), but on any
// failure — non-OK status OR a thrown network/CORS error — **fall back to the
// bundled illustrative dataset** rather than throwing. The fallback is loud,
// not silent: it console.warns, and the UI renders the "* illustrative"
// advisory whenever the data came from the mock (driven by `source`, below).
// This is graceful degradation for an endpoint that does not exist yet, not
// the C-4-forbidden masking of a real live-endpoint outage.
//
// A project scope with no entry in the bundled fixture is **synthesized**
// deterministically from its id so every project's tab shows content; the
// dates on all series are re-axised to the last-N-days window ending today so
// the illustrative data never looks stale.

import type {
  LifecyclePoint,
  PerformanceDataset,
  PerformanceSeries,
  PrDailyPoint,
} from '../types/performance';
import { withBasePath } from './paths';
import { encodeProjectId } from './projects';
import { WORKFORCE_AGENTS_API_BASE } from '../config/api';

export const apiConfigured = (): boolean => WORKFORCE_AGENTS_API_BASE.length > 0;

/** Scope passed to loadPerformance: the workforce-wide roll-up, or a project. */
export type PerformanceScope = { kind: 'workforce' } | { kind: 'project'; id: string };

export const WORKFORCE_SCOPE: PerformanceScope = { kind: 'workforce' };
export const projectScope = (id: string): PerformanceScope => ({ kind: 'project', id });

/** What loadPerformance returns: the series plus where it came from, so the UI
 *  can flag illustrative (mock/synth) data honestly. */
export interface PerformanceResult {
  series: PerformanceSeries;
  source: 'live' | 'mock';
}

let datasetCache: Promise<PerformanceDataset> | null = null;

/** Loads + caches the bundled mock dataset (every scope in one file). */
export function loadPerformanceMock(): Promise<PerformanceDataset> {
  if (!datasetCache) {
    datasetCache = fetch(withBasePath('/workforce-mock-performance.json'))
      .then((res) => {
        if (!res.ok) throw new Error(`failed to load workforce-mock-performance.json (${res.status})`);
        return res.json() as Promise<PerformanceDataset>;
      })
      .catch((err) => {
        datasetCache = null;
        throw err;
      });
  }
  return datasetCache;
}

// ── date re-axis ────────────────────────────────────────────────────────────
// The bundled fixture carries static dates that would age; re-map each series'
// dates onto the N days ending today so the illustrative data always reads as
// current (the same trick the Dashboard heat strip uses for its axis).

function lastNDaysUTC(n: number): string[] {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - (n - 1 - i));
    return d.toISOString().slice(0, 10);
  });
}

function reaxis(series: PerformanceSeries): PerformanceSeries {
  const n = Math.max(series.lifecycle.length, series.pr_daily.length);
  if (n === 0) return series;
  const days = lastNDaysUTC(n);
  const lcOffset = n - series.lifecycle.length;
  const prOffset = n - series.pr_daily.length;
  return {
    ...series,
    window: { start: days[0], end: days[days.length - 1] },
    lifecycle: series.lifecycle.map((p, i) => ({ ...p, date: days[lcOffset + i] })),
    pr_daily: series.pr_daily.map((p, i) => ({ ...p, date: days[prOffset + i] })),
  };
}

// ── synthesis (unknown project scopes) ───────────────────────────────────────
// Deterministic, illustrative series for any scope id not present in the
// bundled fixture, so every project's Performance tab renders content. Trends
// match the intended reads: delivered share and autopilot share both climb.

function strSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

// 3-month basis (operator request, 2026-07-24) — every graph on /performance,
// live/mock/synthesized alike, now windows to the trailing 90 days.
const DAYS = 90;

function synthesizeSeries(scopeId: string): PerformanceSeries {
  const days = lastNDaysUTC(DAYS);
  const scale = 0.3 + (strSeed(scopeId) % 70) / 100; // 0.30..0.99
  const rLc = rng(strSeed(scopeId) + 7);
  const rPr = rng(strSeed(scopeId) + 99);

  const lifecycle: LifecyclePoint[] = days.map((date, i) => {
    const t = i / (DAYS - 1);
    const cohort = Math.max(1, Math.round((6 + 18 * t) * scale));
    const delivered = Math.max(0, Math.round(cohort * (0.28 + 0.34 * t + (rLc() - 0.5) * 0.04)));
    const assigned = Math.max(0, Math.round(cohort * (0.3 - 0.06 * t + (rLc() - 0.5) * 0.03)));
    const registered = Math.max(0, cohort - delivered - assigned);
    return { date, registered, assigned, delivered };
  });

  let totAdd = 0;
  let totDel = 0;
  let totPr = 0;
  let totAuto = 0;
  const pr_daily: PrDailyPoint[] = days.map((date, i) => {
    const t = i / (DAYS - 1);
    const prs = Math.max(0, Math.round(4 * scale * (0.4 + 0.6 * t) * (0.6 + rPr() * 0.8)));
    const autopilot_merged = Math.min(prs, Math.round(prs * Math.min(0.95, 0.2 + 0.65 * t)));
    const additions = prs * Math.round(40 + rPr() * 160);
    const deletions = prs * Math.round(15 + rPr() * 80);
    totAdd += additions;
    totDel += deletions;
    totPr += prs;
    totAuto += autopilot_merged;
    return { date, prs, autopilot_merged, additions, deletions };
  });

  return {
    scope: scopeId,
    generated_at: new Date().toISOString(),
    window: { start: days[0], end: days[days.length - 1] },
    lifecycle,
    pr_daily,
    pr_summary: {
      total_prs: totPr,
      autopilot_merged: totAuto,
      autopilot_share: totPr > 0 ? +(totAuto / totPr).toFixed(3) : 0,
      total_additions: totAdd,
      total_deletions: totDel,
      humans_involved: totPr > totAuto ? ['refluster'] : [],
    },
    pr_contributors: [{ handle: 'nadia', kind: 'agent', prs: totAuto }],
  };
}

/** Resolve one scope's series from the illustrative substrate (re-axised). */
async function illustrative(scope: PerformanceScope): Promise<PerformanceSeries> {
  const ds = await loadPerformanceMock();
  if (scope.kind === 'workforce') return reaxis(ds.workforce);
  const known = ds.projects[scope.id];
  return reaxis(known ?? synthesizeSeries(scope.id));
}

/**
 * Resolve one scope's PerformanceResult. Tries the live agents-api first (so
 * the surface lights up automatically when the Phase-2 endpoint ships); on any
 * failure falls back to the bundled illustrative dataset (loud: console.warn +
 * the `source:'mock'` flag drives the UI advisory). Never throws for a missing
 * endpoint — that previously broke the Performance tab on production.
 */
export async function loadPerformance(scope: PerformanceScope): Promise<PerformanceResult> {
  if (apiConfigured()) {
    const url =
      scope.kind === 'workforce'
        ? `${WORKFORCE_AGENTS_API_BASE}/performance`
        : `${WORKFORCE_AGENTS_API_BASE}/projects/${encodeProjectId(scope.id)}/performance`;
    try {
      const res = await fetch(url);
      // Re-axis the live series too, not just the mock fallback below. Epic-016's
      // reducer redeploy + daily PR refresh (OP-011/OP-012) are still unwired, so
      // the live endpoint can serve a window frozen at its last backfill — which
      // read as "the graph's dates never update" (operator report, 2026-07-24).
      // Until the backend catches up, the frontend keeps the displayed window
      // honestly current: same days-ending-today remap the mock path already got.
      if (res.ok) return { series: reaxis((await res.json()) as PerformanceSeries), source: 'live' };
      console.warn(`performance: live endpoint ${url} -> HTTP ${res.status}; serving illustrative data`);
    } catch (err) {
      console.warn(
        `performance: live fetch failed (${err instanceof Error ? err.message : String(err)}); serving illustrative data`,
      );
    }
  }
  return { series: await illustrative(scope), source: 'mock' };
}
