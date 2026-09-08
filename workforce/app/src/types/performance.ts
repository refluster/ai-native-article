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
 *   delivered  — has produced ≥1 EXEC# row with status:ok (any successful
 *                execution — a shipped artefact OR a completed engagement such
 *                as a pr-review; widened in Epic-016 Phase 3).
 *
 * Personas are counted as head-count (Epic-016 Q1) — one persona contributes to
 * exactly one band. The panel's headline read is the ABSOLUTE delivered count
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
  /** Issue 661 — month-to-date W-3 ledger. Workforce scope only (the ledger is
   *  keyed per agent, and an agent works across projects, so there is no
   *  honest per-project attribution), and absent before the month's first
   *  charged dispatch. Absence is NOT "$0 spent": a fresh month and a writer
   *  that stopped charging look the same from here. */
  budget?: BudgetBlock;
}

/**
 * Month-to-date spend against the W-3 ceiling (issue 661).
 *
 * `modelled_usd` and `measured_usd` are deliberately NOT summed into one
 * headline. The data plane cannot meter a CCR session, so nearly everything
 * the workforce spends arrives as `modelled` — derived from each skill's
 * declared `cost_class`, not observed. A single total would render a model as
 * a measurement, which is the failure this ledger exists to end. Render them
 * apart, or add them knowingly.
 */
export interface BudgetBlock {
  /** 'YYYY-MM', UTC — the partition these figures were read from. */
  month: string;
  modelled_usd: number;
  measured_usd: number;
  /** Dispatched CCR fires behind `modelled_usd`. */
  fires: number;
  /** Agents with a ledger row this month — NOT the roster size. */
  agents_charged: number;
  ceiling_usd: number;
  /** When the ledger last MOVED — newest row timestamp, not the read time.
   *  A figure whose `updated_at` has gone quiet must render as "the writer has
   *  stopped", never as a current total: a frozen number reads as alive. */
  updated_at: string;
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
