// Performance-analytics roll-up contract + pure aggregation (Epic-016 Phase 2).
//
// The console's Performance surface (Epic-016 Phase 1, PRs #357/#359) renders
// two metric families at two scopes against ONE `PerformanceSeries` shape. In
// Phase 1 that series was illustrative (a bundled fixture, re-axised client
// side). Phase 2 makes the **agent-lifecycle funnel real**: a scheduled
// reducer (`performance-reducer`) snapshots the active cohort daily, partitions
// it by furthest-reached state over `AGENT#`/`bindings[]`/`EXEC#`, and appends
// the day's `LifecyclePoint` to a `PERF#{scope}` roll-up item the agents-api
// `/performance` endpoint reads back.
//
// This module is the SHARED contract between the reducer (writer) and the
// agents-api endpoint (reader), plus the pure classification logic both the
// reducer and its unit tests exercise. It imports no AWS SDK — IO lives in the
// reducer handler — so the partition rules are testable in isolation.
//
// The TypeScript shapes here MIRROR workforce/app/src/types/performance.ts (the
// client contract). The two trees can't share a module, so a change to one is
// a change to both; the endpoint serialises exactly this shape.
//
// Q1/Q2/Q3 resolutions (operator, 2026-06-22 — see the epic doc):
//   Q1 — the funnel counts PERSONAS by furthest state (pure head-count), not
//        binding/task cardinality. `tallyLifecycle` counts one slug per band.
//   Q2 — the deck's headline is the ABSOLUTE delivered count, not a share.
//        `deliveredShare` stays available (hover/secondary) but the live shape
//        is unchanged — the count is just `LifecyclePoint.delivered`.
//   Q3 — PR→project attribution stays the path-prefix heuristic in
//        build-pr-metrics.mjs; no canonical `project:` PR label.

// ── client-mirrored series shapes ────────────────────────────────────────────

/** One day of the agent lifecycle funnel. The three counts are a
 *  mutually-exclusive partition of the active cohort by furthest reached
 *  state, so they sum to the cohort (Q1 — counted as personas). */
export interface LifecyclePoint {
  /** UTC day, YYYY-MM-DD. */
  date: string;
  registered: number;
  assigned: number;
  delivered: number;
}

export interface PrDailyPoint {
  date: string;
  prs: number;
  autopilot_merged: number;
  additions: number;
  deletions: number;
}

export interface PrContributor {
  handle: string;
  kind: "agent" | "human";
  prs: number;
}

export interface PrSummary {
  total_prs: number;
  autopilot_merged: number;
  autopilot_share: number;
  total_additions: number;
  total_deletions: number;
  humans_involved: string[];
}

/** One scope's full performance series (workforce or a single project) —
 *  the JSON body GET /performance and GET /projects/{id}/performance emit. */
export interface PerformanceSeries {
  scope: string;
  generated_at: string;
  window: { start: string; end: string };
  lifecycle: LifecyclePoint[];
  pr_daily: PrDailyPoint[];
  pr_summary: PrSummary;
  pr_contributors: PrContributor[];
}

// ── roll-up item shapes (DDB) ─────────────────────────────────────────────────
//
// Two single-partition items per scope, one per writer, so the daily reducer
// (LIFECYCLE) and the CI PR-metrics publisher (PR) never contend on one item:
//
//   pk = PERF#{scope}   sk = LIFECYCLE   — reducer-owned, the daily funnel.
//   pk = PERF#{scope}   sk = PR          — git-derived PR sections (Metric 3),
//                                          published by build-pr-metrics.mjs.
//
// `scope` is "workforce" or a project_id (e.g. "self/ren"). The endpoint reads
// both and composes the PerformanceSeries; LIFECYCLE is the live differentiator
// (its presence is what lets the endpoint serve real data instead of 404ing to
// the client's illustrative fallback).

/** Trailing window the reducer keeps per scope, matching the Phase-1 fixture. */
export const PERF_WINDOW_DAYS = 28;

export type PerfRollupKind = "LIFECYCLE" | "PR";

export function perfPk(scope: string): `PERF#${string}` {
  return `PERF#${scope}`;
}

export interface PerfLifecycleRow {
  pk: `PERF#${string}`;
  sk: "LIFECYCLE";
  scope: string;
  /** ISO timestamp of the most recent reducer run that touched this row. */
  updated_at: string;
  /** Trailing PERF_WINDOW_DAYS of daily snapshots, oldest→newest. */
  points: LifecyclePoint[];
}

export interface PerfPrRow {
  pk: `PERF#${string}`;
  sk: "PR";
  scope: string;
  updated_at: string;
  window: { start: string; end: string };
  pr_daily: PrDailyPoint[];
  pr_summary: PrSummary;
  pr_contributors: PrContributor[];
}

// ── pure aggregation ──────────────────────────────────────────────────────────

export type LifecycleState = "registered" | "assigned" | "delivered";

/** The signals the reducer gathers per agent, reduced to the two booleans the
 *  partition needs. `delivered` dominates `assigned` dominates `registered`
 *  (furthest state wins) — every hired persona is at least `registered`. */
export interface AgentLifecycleSignal {
  /** ≥1 EXEC# row with status:ok in the scope's partition. Phase 3 widened
   *  this from "status:ok + artifact_ref" to any successful execution, so
   *  artefact-less engagements (pr-review/route) count as delivered work. */
  hasDelivered: boolean;
  /** carries ≥1 triggerable (non-manual / load-bearing) binding in scope. */
  hasTriggerableBinding: boolean;
}

/** Classify one persona by furthest reached state. */
export function classifyAgentState(s: AgentLifecycleSignal): LifecycleState {
  if (s.hasDelivered) return "delivered";
  if (s.hasTriggerableBinding) return "assigned";
  return "registered";
}

/** Tally a cohort's per-persona states into the day's mutually-exclusive
 *  partition (Q1 — one slug contributes to exactly one band). */
export function tallyLifecycle(date: string, states: readonly LifecycleState[]): LifecyclePoint {
  const point: LifecyclePoint = { date, registered: 0, assigned: 0, delivered: 0 };
  for (const state of states) point[state] += 1;
  return point;
}

/** delivered / (registered + assigned + delivered); 0 for an empty cohort. */
export function deliveredShare(p: LifecyclePoint): number {
  const total = p.registered + p.assigned + p.delivered;
  return total > 0 ? p.delivered / total : 0;
}

/** Append today's snapshot to a trailing window, replacing any existing point
 *  for the same date (idempotent re-runs) and trimming to `windowDays`. */
export function appendDailyPoint(
  existing: readonly LifecyclePoint[],
  today: LifecyclePoint,
  windowDays: number = PERF_WINDOW_DAYS,
): LifecyclePoint[] {
  const kept = existing.filter((p) => p.date !== today.date);
  const merged = [...kept, today].sort((a, b) => a.date.localeCompare(b.date));
  return merged.slice(-windowDays);
}

/** Compose the endpoint's PerformanceSeries from the two roll-up rows. The
 *  LIFECYCLE row is required (the live differentiator); PR is optional — a
 *  scope whose PR sections have not been published yet serves an empty PR
 *  block rather than 404ing the whole series. */
export function composeSeries(
  scope: string,
  generatedAt: string,
  lifecycleRow: Pick<PerfLifecycleRow, "points">,
  prRow?: Pick<PerfPrRow, "window" | "pr_daily" | "pr_summary" | "pr_contributors">,
): PerformanceSeries {
  const points = lifecycleRow.points;
  const lcStart = points[0]?.date;
  const lcEnd = points[points.length - 1]?.date;
  const window = prRow?.window ?? {
    start: lcStart ?? generatedAt.slice(0, 10),
    end: lcEnd ?? generatedAt.slice(0, 10),
  };
  return {
    scope,
    generated_at: generatedAt,
    window,
    lifecycle: points,
    pr_daily: prRow?.pr_daily ?? [],
    pr_summary:
      prRow?.pr_summary ??
      {
        total_prs: 0,
        autopilot_merged: 0,
        autopilot_share: 0,
        total_additions: 0,
        total_deletions: 0,
        humans_involved: [],
      },
    pr_contributors: prRow?.pr_contributors ?? [],
  };
}
