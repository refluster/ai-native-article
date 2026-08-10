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
  /** Epic-019 Story 1 — escalation-reason funnel, written by
   *  build-pr-metrics-github.mjs; absent on rows built before it shipped.
   *  PRs labelled autopilot:needs-human in the window. */
  escalated_prs?: number;
  /** Escalated PRs NOT reasoned `autopilot:reason:l0l1-path` — the eligible
   *  (non-L0/L1) share the Epic-019 verdict gates on. */
  eligible_escalations?: number;
  /** Counts per escalation-reason code (workforce/docs/pr-escalation-reasons.md
   *  v1); "unspecified" = a hand-off missing its reason label. */
  escalation_reasons?: Record<string, number>;
}

// ── repository activity (Metric 4, 2026-07-26) ───────────────────────────────
// Issues/PRs opened+closed and code-line churn per tracked GitHub repo, built
// by workforce/scripts/build-repo-performance.mjs. Mirrors
// workforce/app/src/types/repoActivity.ts. Unlike the PR block (which measures
// the autopilot merge split on THIS repo), this measures raw repository
// throughput across EVERY workforce project's repo.

export interface RepoDailyPoint {
  /** UTC day, YYYY-MM-DD. */
  date: string;
  opened: number;
  closed: number;
}

/** Code churn is weekly — GitHub's `stats/code_frequency` is weekly-bucketed. */
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

/** One scope's repository activity, as served inside a PerformanceSeries. */
export interface RepoActivityBlock {
  window: { start: string; end: string };
  issues_daily: RepoDailyPoint[];
  prs_daily: RepoDailyPoint[];
  code_churn_weekly: RepoWeeklyChurnPoint[];
  summary: RepoActivitySummary;
  /** For the workforce aggregate: the project scopes that contributed. A
   *  project scope carries just its own id. Lets the console name the tracked
   *  repos without a second round-trip. */
  repos: string[];
  /** ISO timestamp of the refresh that produced this block — the console
   *  renders it so a frozen refresh is visible, never cosmetically hidden. */
  updated_at: string;
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
  /** Absent until this scope's first repo-activity refresh lands; the client
   *  falls back to its bundled snapshot when missing. */
  repo?: RepoActivityBlock;
  /** Epic-021 §B.1 idle-talent snapshot. Absent until the reducer's first
   *  IDLE sweep for this scope lands — a caller (the discord-digest
   *  cadence first) must NOT read an absent block as "nobody idle"; see the
   *  staleness contract on `PerfIdleRow` above `window.end`. */
  idle?: PerfIdleBlock;
}

/** The IDLE roll-up, minus the DDB key/scope fields — what composeSeries
 *  actually needs from `PerfIdleRow` to serve `/performance`. */
export type PerfIdleBlock = Pick<
  PerfIdleRow,
  "updated_at" | "window" | "idle" | "cohort" | "probe_truncated" | "commons_skills"
>;

// ── roll-up item shapes (DDB) ─────────────────────────────────────────────────
//
// FOUR single-partition items per scope, one per writer, so the daily reducer
// (LIFECYCLE, IDLE) and the CI publishers (PR, REPO) never contend on one item:
//
//   pk = PERF#{scope}   sk = LIFECYCLE   — reducer-owned, the daily funnel.
//   pk = PERF#{scope}   sk = PR          — git-derived PR sections (Metric 3),
//                                          published by build-pr-metrics.mjs.
//   pk = PERF#{scope}   sk = REPO        — repository activity (Metric 4),
//                                          published by build-repo-performance.mjs.
//   pk = PERF#{scope}   sk = IDLE        — reducer-owned, the Epic-021 §B.1 idle
//                                          snapshot. NOT served by /performance
//                                          yet: the endpoint reads LIFECYCLE /
//                                          PR / REPO by explicit `sk`, so this
//                                          item is additive and invisible to it
//                                          until the digest PR renders it.
//
// `scope` is "workforce" or a project_id (e.g. "self/ren"). The endpoint reads
// the first three and composes the PerformanceSeries; LIFECYCLE is the live
// differentiator (its presence is what lets the endpoint serve real data
// instead of 404ing to the client's illustrative fallback).
//
// Keep this catalogue in step with the writers. A shape registry that stops
// tracking its own shapes is how a second, drifting definition gets written by
// someone who read the catalogue and believed it (PR #524 cycle-1, mateo M2).

/** Trailing window the reducer keeps per scope.
 *  90 days (2026-07-26, operator): the console's decks are all on a 3-month
 *  basis, so the stored window must cover it — a 28-day row could only ever
 *  paint a third of the chart. The reducer appends forward, so an existing
 *  28-point row grows to 90 over the following weeks; re-run
 *  workforce/scripts/backfill-performance-lifecycle.mjs to fill it at once. */
export const PERF_WINDOW_DAYS = 90;

export type PerfRollupKind = "LIFECYCLE" | "PR" | "REPO" | "IDLE";

/** Epic-021 §B.1 — the single global idleness window. One constant, no
 *  per-team override: "configurability is where exemptions hide" (Q3,
 *  farah/dario concur). A persona is idle when it has produced zero
 *  NON-COMMONS deliverable rows in this many trailing days. */
export const IDLE_WINDOW_DAYS = 30;

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

/** Epic-021 §B.1 — the idle-talent sweep, written by the same daily reducer
 *  walk (mateo: no new cron, one idleness definition). Deliberately its own
 *  `sk` so it never touches a persona's track record: the digest reads this
 *  row, and Epic-023 tiering reads the EXEC ledger, which this does not
 *  write to.
 *
 *  **Consumer contract — an unknown is never a measured zero.** This is the
 *  first PERF# item with no dated series, so a reducer that stops running
 *  leaves a stale row that renders as "nobody is idle" rather than as "we did
 *  not look". Any consumer (the digest PR first) MUST treat a sweep whose
 *  `window.end` is older than ~2 days as **unknown** and say so, never as an
 *  empty idle list. The codebase already holds this line twice — "an unknown
 *  is never a measured zero" (pr-autopilot-post.mjs) and "never let stale data
 *  look current" (app/src/lib/repoActivity.ts). Stated here at definition time
 *  so the digest inherits it instead of re-deciding it (mateo M4). */
export interface PerfIdleRow {
  pk: `PERF#${string}`;
  sk: "IDLE";
  scope: string;
  updated_at: string;
  /** The window this sweep evaluated, so a reader never has to assume it. */
  window: { start: string; end: string; days: number };
  /** Personas with zero non-commons deliverable rows in the window. */
  idle: IdleAgentRecord[];
  /** Cohort size the sweep ran over — the denominator for "N of M idle".
   *  Archived personas are NOT in it: they are excluded from the sweep the
   *  way the orchestrator excludes them from firing, so they cannot sit on
   *  the idle list forever (dario D1). This deliberately differs from the
   *  LIFECYCLE head-count, which is a different question. */
  cohort: number;
  /** Slugs whose window probe came back saturated — i.e. the persona had more
   *  EXEC rows inside the window than one page, so "no non-commons row found"
   *  is bounded evidence rather than a complete read. A digest must be able to
   *  tell "we found nothing" from "we stopped looking" (C-4); a prose caveat
   *  in a code comment is not a check (dario D2 / mateo M1). Empty in the
   *  normal case. */
  probe_truncated: string[];
  /** The commons skills discounted by this sweep, as actually resolved at run
   *  time. Recorded so a digest reader can see the class the number depends
   *  on rather than trusting the detector's word for it. */
  commons_skills: string[];
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

export interface PerfRepoRow {
  pk: `PERF#${string}`;
  sk: "REPO";
  scope: string;
  updated_at: string;
  window: { start: string; end: string };
  issues_daily: RepoDailyPoint[];
  prs_daily: RepoDailyPoint[];
  code_churn_weekly: RepoWeeklyChurnPoint[];
  summary: RepoActivitySummary;
  /** Contributing project scopes (workforce aggregate) or [scope] (project). */
  repos: string[];
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

// ── idle-talent detector (Epic-021 §B.1) ─────────────────────────────────────
//
// Keyed on OUTPUT, not paperwork. The RFC's load-bearing correction (theo,
// tessa, priya, mateo): a binding is a declaration, and a bound-but-paused
// skill would clear a binding-keyed flag while producing nothing — the day-29
// token binding is the exact evasion. So the predicate asks one question:
// did this persona produce a non-commons deliverable row in the window?
//
// The pending-action annotation exists so idleness lands on whoever can
// actually clear it. Idleness is a JOB-DESIGN failure charged to the hiring
// lead (priya) — these records live on their own PERF#{scope}/IDLE row and are
// never written into the persona's track record, so they stay inadmissible to
// Epic-023 tiers.

/** Whose action is pending on an idle persona (Epic-021 §B.1). */
export type IdlePendingAction =
  /** No non-commons binding exists at all — the hiring lead owes job design. */
  | "design"
  /** A non-commons binding exists but nothing fires it (paused / dead cron) —
   *  the operator owes the enable. Gate-limbo is attributed to the gate. */
  | "enable"
  /** A non-commons binding is live and firing, yet no deliverable row landed —
   *  the persona owes output. */
  | "output";

/** The signals the detector needs per persona. Both lists are already
 *  scoped/filtered by the caller; this function does no IO. */
export interface AgentIdleSignal {
  slug: string;
  /** Skill names of this persona's ok EXEC rows inside the window. */
  windowExecSkills: readonly string[];
  /** Skill names of every non-commons binding the persona carries. */
  nonCommonsBoundSkills: readonly string[];
  /** Skill names of the non-commons bindings whose cron is load-bearing —
   *  i.e. something actually fires them (shared/agent.ts
   *  bindingCronIsLoadBearing, the same predicate the orchestrator uses). */
  nonCommonsLiveSkills: readonly string[];
}

/** One idle persona, as written to the IDLE roll-up row. */
export interface IdleAgentRecord {
  slug: string;
  pending: IdlePendingAction;
  /** The non-commons skills this persona is bound to, if any — so the digest
   *  can say *which* designed duty is silent, not merely that one is. */
  bound_skills: string[];
}

/** Is this execution specialised work? Commons rows (the daily reflection /
 *  daily research every persona shares) never count toward non-idleness. */
export function isCommonsSkill(skill: string, commons: ReadonlySet<string>): boolean {
  return commons.has(skill);
}

/** Classify one persona. Returns null when the persona is NOT idle — i.e. it
 *  produced at least one non-commons deliverable row inside the window. */
export function classifyIdleAgent(
  signal: AgentIdleSignal,
  commons: ReadonlySet<string>,
): IdleAgentRecord | null {
  const delivered = signal.windowExecSkills.some((s) => !isCommonsSkill(s, commons));
  if (delivered) return null;

  const bound = signal.nonCommonsBoundSkills;
  const live = signal.nonCommonsLiveSkills;

  // Order matters and is the RFC's attribution rule: no designed duty at all
  // is the hiring lead's; a designed duty nobody schedules is the operator's;
  // a live schedule producing nothing is the persona's.
  const pending: IdlePendingAction =
    bound.length === 0 ? "design" : live.length === 0 ? "enable" : "output";

  return { slug: signal.slug, pending, bound_skills: [...bound].sort() };
}

/** Sweep a cohort. Ordered by slug so two runs over the same state produce
 *  byte-identical rows (a diffable digest, not a shuffled one). */
export function detectIdleAgents(
  signals: readonly AgentIdleSignal[],
  commons: ReadonlySet<string>,
): IdleAgentRecord[] {
  return signals
    .map((s) => classifyIdleAgent(s, commons))
    .filter((r): r is IdleAgentRecord => r !== null)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Inclusive lower bound of the idle window, as an ISO instant. */
export function idleWindowStart(now: Date, windowDays: number = IDLE_WINDOW_DAYS): string {
  return new Date(now.getTime() - windowDays * 86_400_000).toISOString();
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
  repoRow?: Pick<
    PerfRepoRow,
    "window" | "issues_daily" | "prs_daily" | "code_churn_weekly" | "summary" | "repos" | "updated_at"
  >,
  idleRow?: PerfIdleBlock,
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
    ...(repoRow
      ? {
          repo: {
            window: repoRow.window,
            issues_daily: repoRow.issues_daily,
            prs_daily: repoRow.prs_daily,
            code_churn_weekly: repoRow.code_churn_weekly,
            summary: repoRow.summary,
            repos: repoRow.repos,
            updated_at: repoRow.updated_at,
          },
        }
      : {}),
    ...(idleRow
      ? {
          idle: {
            updated_at: idleRow.updated_at,
            window: idleRow.window,
            idle: idleRow.idle,
            cohort: idleRow.cohort,
            probe_truncated: idleRow.probe_truncated,
            commons_skills: idleRow.commons_skills,
          },
        }
      : {}),
  };
}
