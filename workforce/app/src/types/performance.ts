// Workforce performance-analytics types (Epic-016). Two metric families,
// rendered at two scopes (workforce-wide + per-project) against one dataset.
//
// Live shape: GET /performance (workforce) and GET /projects/{id}/performance
// return a single PerformanceSeries. The static fallback bundles every scope
// into one PerformanceDataset served from public/workforce-mock-performance.json
// (mirrors the /stats + workforce-mock-stats.json precedent in lib/agents.ts).
//
// This file MIRRORS workforce/lambdas/shared/performance.ts (the server
// contract) — the two trees can't share a module, so a change to one is a
// change to both; the endpoint serialises exactly this shape.
// workforce/scripts/check-performance-mirror-drift.mjs enforces that the
// `PerformanceSeries` field set stays identical across both files (#686 —
// three blocks landed server-side without this file for a full cycle before
// anything caught it, because every one of them is optional).

import type {
  RepoActivitySummary,
  RepoDailyPoint,
  RepoWeeklyChurnPoint,
} from './repoActivity';

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
  /** Metric 4 (2026-07-26) — repository issue/PR/churn activity. Absent until
   *  this scope's first repo-activity refresh lands; a caller falls back to
   *  the bundled snapshot when missing (see lib/repoActivity.ts). */
  repo?: RepoActivityBlock;
  /** Epic-021 §B.1 idle-talent snapshot. Absent until the reducer's first
   *  IDLE sweep for this scope lands — a caller must NOT read an absent
   *  block as "nobody idle"; see the staleness contract on `PerfIdleBlock`
   *  above `window.end`. */
  idle?: PerfIdleBlock;
  /** Epic-020 Story 2 — absent until this scope's first human-touch
   *  aggregation lands. Never merged into the blocks above: the touch
   *  tables are per-class by construction (see HumanTouchBlock). */
  human_touch?: HumanTouchBlock;
  /** Issue 661 — month-to-date W-3 ledger. Workforce scope only (the ledger is
   *  keyed per agent, and an agent works across projects, so there is no
   *  honest per-project attribution), and absent before the month's first
   *  charged dispatch. Absence is NOT "$0 spent": a fresh month and a writer
   *  that stopped charging look the same from here. */
  budget?: BudgetBlock;
}

/** One scope's repository activity, as served inside a PerformanceSeries.
 *  Mirrors workforce/lambdas/shared/performance.ts `RepoActivityBlock`.
 *  Field shapes reuse `../types/repoActivity` (the client's own repo-activity
 *  contract) rather than re-declaring them a third time. */
export interface RepoActivityBlock {
  window: { start: string; end: string };
  issues_daily: RepoDailyPoint[];
  prs_daily: RepoDailyPoint[];
  code_churn_weekly: RepoWeeklyChurnPoint[];
  summary: RepoActivitySummary;
  /** For the workforce aggregate: the project scopes that contributed. A
   *  project scope carries just its own id. Lets the console name the
   *  tracked repos without a second round-trip. */
  repos: string[];
  /** ISO timestamp of the refresh that produced this block — the console
   *  renders it so a frozen refresh is visible, never cosmetically hidden. */
  updated_at: string;
}

// ── Epic-021 §B.1 idle-talent snapshot ───────────────────────────────────────

/** Whose action is pending on an idle persona. Mirrors
 *  workforce/lambdas/shared/performance.ts `IdlePendingAction`. */
export type IdlePendingAction = 'design' | 'enable' | 'output';

/** One idle persona, as written to the IDLE roll-up row. Mirrors
 *  workforce/lambdas/shared/performance.ts `IdleAgentRecord`. */
export interface IdleAgentRecord {
  slug: string;
  pending: IdlePendingAction;
  /** The non-commons skills this persona is bound to, if any — so a reader
   *  can say *which* designed duty is silent, not merely that one is. */
  bound_skills: string[];
}

/** The IDLE roll-up as served inside a PerformanceSeries. Mirrors
 *  workforce/lambdas/shared/performance.ts `PerfIdleBlock` (there defined as
 *  a `Pick<PerfIdleRow, ...>` over the DDB row shape; restated flat here
 *  since the client never sees the DDB row).
 *
 *  **Consumer contract — an unknown is never a measured zero.** A sweep whose
 *  `window.end` is older than ~2 days must be treated as **unknown** and
 *  said so, never rendered as an empty idle list (the same line the codebase
 *  already holds twice — "an unknown is never a measured zero"
 *  (pr-autopilot-post.mjs) and "never let stale data look current"
 *  (lib/repoActivity.ts)). */
export interface PerfIdleBlock {
  updated_at: string;
  /** The window this sweep evaluated, so a reader never has to assume it. */
  window: { start: string; end: string; days: number };
  /** Personas with zero non-commons deliverable rows in the window. */
  idle: IdleAgentRecord[];
  /** Cohort size the sweep ran over — the denominator for "N of M idle". */
  cohort: number;
  /** Slugs whose window probe came back saturated — bounded evidence rather
   *  than a complete read. Empty in the normal case. */
  probe_truncated: string[];
  /** The commons skills discounted by this sweep, as actually resolved at
   *  run time. */
  commons_skills: string[];
}

// ── Epic-020 human leverage ───────────────────────────────────────────────────
// Mirrors the human-touch types in workforce/lambdas/shared/performance.ts.
// The taxonomy this consumes is Zone A prose — Epic-016 §
// "Human-touch taxonomy (Epic-020 Story 1)" — and it is the authority on
// which types exist, which class each belongs to, and which are counted vs
// estimated.

/** The three touch classes. The published table reports them separately and
 *  never blends them into a cross-class total. */
export type HumanTouchClass = 'gate' | 'digest' | 'one-time';

export type HumanTouchTypeId = 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7';

/** One touch type's result for one window. `touches: null` is "we did not
 *  look", never "there were none" — see the taxonomy's collector contract. */
export interface HumanTouchTypeResult {
  type: HumanTouchTypeId;
  /** Human-readable label, verbatim from the taxonomy table. */
  label: string;
  class: HumanTouchClass;
  /** Taxonomy designation. Only `counted` types sit in the falsifier
   *  denominator (estimated types are excluded). */
  designation: 'counted' | 'estimated';
  /** Touches observed in the window, or null when the source was unreadable. */
  touches: number | null;
  /** Work units the touches unblocked — direct first-order only. Null
   *  exactly when `touches` is null. */
  work_units: number | null;
  /** What one work unit *is* for this type (e.g. "changed-file", "pr",
   *  "persona", "usd-headroom"). */
  unit: string;
  /** Set iff `touches === null`: why the source could not be read. */
  unavailable_reason?: string;
  /** Touches whose attribution was ambiguous, credited `1` and flagged. */
  ambiguous: number;
}

/** One class's table. `leverage` is within-class only and is null when the
 *  class observed zero touches, or when its readable types disagree on what
 *  a work unit is. */
export interface HumanTouchClassTable {
  class: HumanTouchClass;
  types: HumanTouchTypeResult[];
  touches: number;
  /** Null when the class's readable types use more than one work unit. */
  work_units: number | null;
  leverage: number | null;
  /** Distinct work units among the class's readable types, sorted. */
  units: string[];
  /** Type ids whose source was unreadable, excluded from the sums above. */
  unavailable: HumanTouchTypeId[];
}

/** Epic-020's falsifier, computed rather than asserted: the metric fails as
 *  defined if fewer than 80% of the countable-designated types turn out to
 *  be mechanically countable. */
export interface HumanTouchCoverage {
  countable_designated: number;
  mechanically_counted: number;
  /** mechanically_counted / countable_designated, 0–1, rounded to 3dp. */
  share: number;
  /** share >= 0.8 — the epic's bar. */
  meets_bar: boolean;
  /** Countable-designated types that did not produce a count this run. */
  missing: HumanTouchTypeId[];
}

/** One scope's human-leverage block, as served inside a PerformanceSeries. */
export interface HumanTouchBlock {
  /** The calendar month this aggregation replayed, e.g. "2026-07". */
  month: string;
  window: { start: string; end: string };
  /** Version of the Epic-016 taxonomy block this run was computed against. */
  taxonomy_version: string;
  /** Always all three classes, in a stable order, even when empty. */
  classes: HumanTouchClassTable[];
  coverage: HumanTouchCoverage;
  /** V1 measures fan-out, not price (Epic-020 Q2 / the Goodhart clause). */
  definition: 'leverage-not-price';
  updated_at: string;
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
