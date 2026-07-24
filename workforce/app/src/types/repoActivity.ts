// Types for the /performance "REPOSITORY PERFORMANCE" section (2026-07-24
// operator request, requirement 5): issues opened/closed, PR opened/closed,
// and code-line churn, aggregated across every workforce project's GitHub
// repo. Unlike SkillGrowth (fully client-derived) or Epic-016's
// PerformanceSeries (live endpoint + mock fallback), this is a REAL
// point-in-time GitHub-API snapshot built offline by
// workforce/scripts/build-repo-performance.mjs and bundled as
// public/workforce-mock-repo-activity.json — same shape family as
// build-pr-metrics-github.mjs's PR series, generalised to issues + PRs +
// code churn and summed across every project's repo.

export interface RepoDailyPoint {
  /** UTC day, YYYY-MM-DD. */
  date: string;
  opened: number;
  closed: number;
}

/** Code-line churn is reported weekly (GitHub's `stats/code_frequency` is a
 *  weekly-bucketed endpoint) — still well inside the 90-day/3-month window,
 *  just coarser-grained than the daily issue/PR series. */
export interface RepoWeeklyChurnPoint {
  /** UTC week start (Sunday), YYYY-MM-DD. */
  week_start: string;
  additions: number;
  deletions: number;
}

export interface RepoActivitySummary {
  issues_opened: number;
  issues_closed: number;
  prs_opened: number;
  prs_closed: number;
  total_additions: number;
  total_deletions: number;
}

/** One repo's (or the workforce-wide sum's) activity over the window. */
export interface RepoActivitySeries {
  /** 'workforce' or a project_id. */
  scope: string;
  /** owner/repo — absent on the workforce aggregate. */
  repo?: string;
  window: { start: string; end: string };
  issues_daily: RepoDailyPoint[];
  prs_daily: RepoDailyPoint[];
  code_churn_weekly: RepoWeeklyChurnPoint[];
  summary: RepoActivitySummary;
}

/** The bundled snapshot: every project + the workforce-wide sum in one file. */
export interface RepoActivityDataset {
  generated_at: string;
  days: number;
  workforce: RepoActivitySeries;
  /** Keyed by project_id. Sparse — a project whose token couldn't be
   *  resolved this run is simply absent (see the dataset's own `$comment`
   *  for which, if any, were skipped) rather than backfilled with zeros. */
  projects: Record<string, RepoActivitySeries>;
}
