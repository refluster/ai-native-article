// Loader for the Repository Performance deck (2026-07-24 operator request).
//
// Live-first, bundled-snapshot fallback — the same contract lib/performance.ts
// uses for the Epic-016 decks:
//
//   1. `GET {API}/performance` — the workforce scope's series now carries a
//      `repo` block (PERF#workforce/REPO), refreshed daily by the
//      `performance-refresh` Cadence. This is the path that makes the deck
//      show today's numbers.
//   2. Bundled `workforce-mock-repo-activity.json` — a committed point-in-time
//      snapshot. Served when the API base is unset (local dev / bare
//      gh-pages) or the live block is absent/unreachable.
//
// The fallback is loud, not silent: `source` drives the panel's advisory, and
// the panel always renders the data's own `generated_at` so a frozen refresh
// is visible rather than cosmetically hidden (the `wf:tomas` T1 lesson from
// the date-axis fix — never let stale data look current).

import type { RepoActivityDataset, RepoActivitySeries } from '../types/repoActivity';
import { withBasePath } from './paths';
import { WORKFORCE_AGENTS_API_BASE } from '../config/api';

export interface RepoActivityResult {
  /** The workforce-wide aggregate the deck charts. */
  workforce: RepoActivitySeries;
  /** Project scopes that contributed — the deck names them. */
  repos: string[];
  /** When the underlying refresh ran. */
  generatedAt: string;
  source: 'live' | 'snapshot';
}

/** The `repo` block the agents-api composes into a PerformanceSeries. */
interface LiveRepoBlock {
  window: RepoActivitySeries['window'];
  issues_daily: RepoActivitySeries['issues_daily'];
  prs_daily: RepoActivitySeries['prs_daily'];
  code_churn_weekly: RepoActivitySeries['code_churn_weekly'];
  summary: RepoActivitySeries['summary'];
  repos: string[];
  updated_at: string;
  degraded_signals?: string[];
}

let snapshotCache: Promise<RepoActivityDataset> | null = null;

function loadSnapshot(): Promise<RepoActivityDataset> {
  if (!snapshotCache) {
    snapshotCache = fetch(withBasePath('/workforce-mock-repo-activity.json'))
      .then((res) => {
        if (!res.ok) throw new Error(`failed to load workforce-mock-repo-activity.json (${res.status})`);
        return res.json() as Promise<RepoActivityDataset>;
      })
      .catch((err) => {
        snapshotCache = null;
        throw err;
      });
  }
  return snapshotCache;
}

export async function loadRepoActivity(): Promise<RepoActivityResult> {
  if (WORKFORCE_AGENTS_API_BASE.length > 0) {
    try {
      const res = await fetch(`${WORKFORCE_AGENTS_API_BASE}/performance`);
      if (res.ok) {
        const series = (await res.json()) as { repo?: LiveRepoBlock };
        const block = series.repo;
        if (block) {
          return {
            workforce: {
              scope: 'workforce',
              window: block.window,
              issues_daily: block.issues_daily,
              prs_daily: block.prs_daily,
              code_churn_weekly: block.code_churn_weekly,
              summary: block.summary,
              ...(block.degraded_signals?.length ? { degraded_signals: block.degraded_signals } : {}),
            },
            repos: block.repos ?? [],
            generatedAt: block.updated_at,
            source: 'live',
          };
        }
        console.warn('repoActivity: live /performance carries no repo block yet; serving bundled snapshot');
      } else {
        console.warn(`repoActivity: live /performance -> HTTP ${res.status}; serving bundled snapshot`);
      }
    } catch (err) {
      console.warn(
        `repoActivity: live fetch failed (${err instanceof Error ? err.message : String(err)}); serving bundled snapshot`,
      );
    }
  }

  const ds = await loadSnapshot();
  return {
    workforce: ds.workforce,
    repos: Object.keys(ds.projects).sort(),
    generatedAt: ds.generated_at,
    source: 'snapshot',
  };
}
