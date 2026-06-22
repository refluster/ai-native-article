// Performance-analytics data loader (Epic-016). Live-API-first, mock-fallback
// — identical contract to loadWorkforceStats in lib/agents.ts:
//
//   - WORKFORCE_AGENTS_API_BASE set  → GET /performance (workforce scope) or
//     GET /projects/{id}/performance (project scope). A non-OK response throws
//     (C-4: fail loud, never silently serve stale mock over a live deploy).
//   - unset (bare gh-pages / local dev) → the bundled
//     public/workforce-mock-performance.json, selecting the requested scope.

import type { PerformanceDataset, PerformanceSeries } from '../types/performance';
import { withBasePath } from './paths';
import { encodeProjectId } from './projects';
import { WORKFORCE_AGENTS_API_BASE } from '../config/api';

export const apiConfigured = (): boolean => WORKFORCE_AGENTS_API_BASE.length > 0;

/** Scope passed to loadPerformance: the workforce-wide roll-up, or a project. */
export type PerformanceScope = { kind: 'workforce' } | { kind: 'project'; id: string };

export const WORKFORCE_SCOPE: PerformanceScope = { kind: 'workforce' };
export const projectScope = (id: string): PerformanceScope => ({ kind: 'project', id });

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

/**
 * Resolve one scope's PerformanceSeries. Prefers the live agents-api; falls
 * back to the bundled mock when the API base is unconfigured. Returns
 * `undefined` only when a project scope has no series at all (live 404 or no
 * mock entry) so the caller can render an honest empty state rather than
 * fabricating zeros.
 */
export async function loadPerformance(
  scope: PerformanceScope,
): Promise<PerformanceSeries | undefined> {
  if (apiConfigured()) {
    const url =
      scope.kind === 'workforce'
        ? `${WORKFORCE_AGENTS_API_BASE}/performance`
        : `${WORKFORCE_AGENTS_API_BASE}/projects/${encodeProjectId(scope.id)}/performance`;
    const res = await fetch(url);
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`failed to load performance (${res.status})`);
    return (await res.json()) as PerformanceSeries;
  }

  const ds = await loadPerformanceMock();
  if (scope.kind === 'workforce') return ds.workforce;
  return ds.projects[scope.id];
}
