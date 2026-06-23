// Workforce performance-analytics types (Epic-016). Two metric families,
// rendered at two scopes (workforce-wide + per-project) against one dataset.
//
// Live shape: GET /performance (workforce) and GET /projects/{id}/performance
// return a single PerformanceSeries. The static fallback bundles every scope
// into one PerformanceDataset served from public/workforce-mock-performance.json
// (mirrors the /stats + workforce-mock-stats.json precedent in lib/agents.ts).

/**
 * One day of the agent lifecycle funnel (Metric 2). The three counts are a
 * **mutually-exclusive partition** of the active cohort by *furthest reached
 * state*, so they sum to the cohort and band shares are directly readable:
 *
 *   registered — hired (AGENT# row exists) but holds no triggerable binding yet.
 *   assigned   — carries ≥1 non-manual binding but has produced no artefact yet.
 *   delivered  — has produced ≥1 EXEC# row with status:ok + an artifact_ref.
 *
 * Personas are counted as head-count (Epic-016 Q1) — one persona contributes to
 * exactly one band. The deck's headline read is the ABSOLUTE delivered count
 * (Epic-016 Q2), expected to climb as hiring converts into bound, then
 * delivered, work; `deliveredShare` below stays available as a secondary read.
 */
export interface LifecyclePoint {
  /** UTC day, YYYY-MM-DD. */
  date: string;
  registered: number;
  assigned: number;
  delivered: number;
}

/** One day of PR throughput (Metric 3). `autopilot_merged` is the subset of
 *  `prs` that pr-autopilot reviewed-and-merged with no human in the loop. */
export interface PrDailyPoint {
  /** UTC day, YYYY-MM-DD. */
  date: string;
  /** Total PRs merged that day. */
  prs: number;
  /** Of `prs`, the count merged by pr-autopilot with no human touch. */
  autopilot_merged: number;
  /** Lines added across the day's merged PRs. */
  additions: number;
  /** Lines removed across the day's merged PRs. */
  deletions: number;
}

/** A contributor to the merged PRs in the window. `kind` separates the agent
 *  personas we want to grow from the humans we are trying to remove. */
export interface PrContributor {
  handle: string;
  kind: 'agent' | 'human';
  prs: number;
}

/** Window-level PR-automation roll-up — the numbers the summary band reads. */
export interface PrSummary {
  total_prs: number;
  autopilot_merged: number;
  /** autopilot_merged / total_prs, 0..1. The headline (target → 1). */
  autopilot_share: number;
  total_additions: number;
  total_deletions: number;
  /** The distinct human handles that touched any merged PR in the window —
   *  the set the workforce is trying to shrink. */
  humans_involved: string[];
}

/** One scope's full performance series (workforce or a single project). */
export interface PerformanceSeries {
  /** 'workforce' or a project_id. */
  scope: string;
  generated_at: string;
  /** First → last UTC day covered, inclusive. */
  window: { start: string; end: string };
  lifecycle: LifecyclePoint[];
  pr_daily: PrDailyPoint[];
  pr_summary: PrSummary;
  pr_contributors: PrContributor[];
}

/** The bundled fallback: every scope in one file. */
export interface PerformanceDataset {
  generated_at: string;
  workforce: PerformanceSeries;
  /** Keyed by project_id. Sparse — only projects with activity appear. */
  projects: Record<string, PerformanceSeries>;
}

/** delivered / (registered + assigned + delivered) for one lifecycle point.
 *  Returns 0 for an empty cohort rather than NaN. */
export function deliveredShare(p: LifecyclePoint): number {
  const total = p.registered + p.assigned + p.delivered;
  return total > 0 ? p.delivered / total : 0;
}
