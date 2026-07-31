// wf-performance-reducer — the Epic-016 Phase-2 daily lifecycle roll-up.
//
// Phase 1 (PRs #357/#359) shipped the Performance surface against an
// illustrative funnel. Phase 2 makes the agent-lifecycle funnel REAL: this
// EventBridge-scheduled reducer runs daily (02:00 UTC), snapshots the active
// agent cohort, partitions it by furthest-reached state over the live data
// plane, and appends the day's LifecyclePoint to a per-scope PERF# roll-up
// item that the agents-api `/performance` endpoint reads back.
//
//   registered — an AGENT#{slug} row exists, but no triggerable binding yet.
//   assigned   — carries ≥1 load-bearing (non-manual) binding, no delivery yet.
//   delivered  — has ≥1 EXEC# row with status:ok (any successful execution —
//                a shipped artefact OR a completed engagement such as a
//                pr-review/route; Epic-016 Phase 3 widened this from
//                "status:ok + artifact_ref" so review-heavy work counts).
//
// Furthest state wins (delivered ⊃ assigned ⊃ registered) and personas are
// counted as head-count (Epic-016 Q1), so the three bands are mutually
// exclusive and sum to the cohort. The reducer SNAPSHOTS today rather than
// reconstructing history: each run appends one point and trims to the trailing
// window, so the live series fills in forward from first deploy (the client's
// illustrative fallback covers the pre-deploy past — Epic-016 "Out of scope").
//
// "Triggerable" uses bindingCronIsLoadBearing — the SAME predicate the
// orchestrator-tick fires on — so a decorative/dead cron never inflates the
// `assigned` band (the Epic-015 dead-cron drift this codebase already learned
// to gate on: shared/agent.ts effectiveSchedule).
//
// Fail-loud (W-4): the reducer throws on any read/write failure so a broken run
// surfaces on the Errors alarm; a scheduling lapse surfaces on the missed-run
// alarm. PR sections (Metric 3) are NOT this reducer's job — they are git-derived
// and published to PERF#{scope}#PR by build-pr-metrics.mjs (Epic-016 §"Metric 3"
// keeps git as the PR source of truth).

import {
  type AgentMetaRow,
  agentPk,
  bindingCronIsLoadBearing,
} from "../shared/agent.js";
import {
  type ProjectMetaRow,
  type ExecutionRow,
  projectPk,
  listExecutions,
} from "../shared/project.js";
import { getItem, putItem, scanAllPrefix } from "../shared/ddb.js";
import {
  type AgentIdleSignal,
  type LifecyclePoint,
  type LifecycleState,
  type PerfIdleRow,
  type PerfLifecycleRow,
  IDLE_WINDOW_DAYS,
  appendDailyPoint,
  classifyAgentState,
  detectIdleAgents,
  idleWindowStart,
  perfPk,
  tallyLifecycle,
} from "../shared/performance.js";
import { COMMONS_SKILLS } from "../shared/skill-registry-generated.js";

// Newest-N ok-status executions inspected per agent to decide "has delivered".
// At C-3 single-operator scale an agent that ever delivered has a recent ok
// row inside this window; bounding the read keeps the daily sweep O(agents)
// without a full ledger scan. Raising this is a read-cost decision, not an
// in-handler tweak.
const EXEC_PROBE_LIMIT = 100;

export interface PerformanceReducerResult {
  date: string;
  agents: number;
  projects: number;
  workforce: Pick<LifecyclePoint, "registered" | "assigned" | "delivered">;
  /** Epic-021 §B.1 — how many personas the idle sweep flagged today. */
  idle: number;
}

export async function handler(): Promise<PerformanceReducerResult> {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);

  // ── 1. the cohort: every hired persona (AGENT#{slug}/META) ────────────────
  const metas = await scanAllPrefix<AgentMetaRow>("AGENT#", "META");
  const metaBySlug = new Map(metas.map((m) => [m.slug, m]));

  // Cache each agent's recent ok executions once; reused across the workforce
  // sweep and every project the agent participates in.
  const execCache = new Map<string, ExecutionRow[]>();
  async function okExecs(slug: string): Promise<ExecutionRow[]> {
    const hit = execCache.get(slug);
    if (hit) return hit;
    const rows = await listExecutions({ agent_slug: slug, status: "ok", limit: EXEC_PROBE_LIMIT });
    execCache.set(slug, rows);
    return rows;
  }

  function hasTriggerableBinding(meta: AgentMetaRow | undefined, projectId?: string): boolean {
    const bindings = meta?.bindings ?? [];
    return bindings.some(
      (b) => bindingCronIsLoadBearing(b) && (projectId === undefined || b.project_id === projectId),
    );
  }

  // ── 2. workforce-wide snapshot ────────────────────────────────────────────
  const workforceStates: LifecycleState[] = [];
  const idleSignals: AgentIdleSignal[] = [];
  const windowStart = idleWindowStart(now);
  for (const meta of metas) {
    const execs = await okExecs(meta.slug);
    // Delivered = any successful execution (Phase 3: artefact OR engagement).
    const hasDelivered = execs.length > 0;
    const hasTriggerable = hasTriggerableBinding(meta);
    workforceStates.push(classifyAgentState({ hasDelivered, hasTriggerableBinding: hasTriggerable }));
    idleSignals.push(idleSignalFor(meta, execs, windowStart));
  }
  const workforcePoint = tallyLifecycle(date, workforceStates);
  await upsertLifecycle("workforce", workforcePoint);

  // ── 2b. idle-talent sweep (Epic-021 §B.1) ─────────────────────────────────
  // Rides the walk above rather than a second cron, so there is exactly one
  // idleness definition in the org and it cannot drift from Epic-016's cohort.
  const idle = detectIdleAgents(idleSignals, COMMONS_SKILLS);
  await upsertIdle("workforce", {
    window: { start: windowStart, end: now.toISOString(), days: IDLE_WINDOW_DAYS },
    idle,
    cohort: metas.length,
    commons_skills: [...COMMONS_SKILLS].sort(),
  });

  // ── 3. per-project snapshots (active projects only) ───────────────────────
  const projects = (await scanAllPrefix<ProjectMetaRow>("PROJECT#", "META")).filter(
    (p) => p.status === "active",
  );
  let projectsWritten = 0;
  for (const project of projects) {
    const projectId = project.project_id;
    // Participation is behavioural, not roster-based (the membership
    // concept was removed 2026-07-03 — every registered agent participates
    // in every project): an agent counts toward a project's snapshot when
    // it has a project-scoped load-bearing binding OR a delivered EXEC on
    // the project's ledger. This keeps the per-project funnel meaningful
    // without a member roster.
    const states: LifecycleState[] = [];
    for (const meta of metas) {
      const execs = await okExecs(meta.slug);
      const hasDelivered = execs.some((e) => e.project_id === projectId);
      const hasTriggerable = hasTriggerableBinding(metaBySlug.get(meta.slug), projectId);
      if (!hasDelivered && !hasTriggerable) continue; // not participating here
      states.push(classifyAgentState({ hasDelivered, hasTriggerableBinding: hasTriggerable }));
    }
    // Skip projects with no participants so a 100-project org doesn't bloat
    // with empty scopes (Epic-016 "per-project map is sparse by construction").
    if (states.length === 0) continue;
    await upsertLifecycle(projectId, tallyLifecycle(date, states));
    projectsWritten += 1;
  }

  const result: PerformanceReducerResult = {
    date,
    agents: metas.length,
    projects: projectsWritten,
    workforce: {
      registered: workforcePoint.registered,
      assigned: workforcePoint.assigned,
      delivered: workforcePoint.delivered,
    },
    idle: idle.length,
  };
  console.log(JSON.stringify({ event: "performance_reducer_run", ...result }));
  return result;
}

/** Reduce one persona's meta + recent ok executions to the idle detector's
 *  input. Keyed on output: bindings only decide *whose action is pending*
 *  once the persona is already flagged, never whether it is flagged.
 *
 *  Note on the EXEC probe bound: `okExecs` reads the newest EXEC_PROBE_LIMIT
 *  ok rows, which can be shorter than the idle window for a very busy
 *  persona. That is safe in one direction only, and it is the safe one — a
 *  persona busy enough to exhaust the probe inside 30 days has non-commons
 *  rows in it, or is genuinely producing nothing but commons output. A
 *  non-commons row older than the probe is outside the window anyway. */
function idleSignalFor(
  meta: AgentMetaRow,
  execs: readonly ExecutionRow[],
  windowStart: string,
): AgentIdleSignal {
  const bindings = meta.bindings ?? [];
  const nonCommons = bindings.filter((b) => !COMMONS_SKILLS.has(b.skill));
  return {
    slug: meta.slug,
    windowExecSkills: execs
      // `ended_at` is the completion instant; fall back to `started_at` for
      // rows written before it was populated rather than dropping them.
      .filter((e) => (e.ended_at || e.started_at || "") >= windowStart)
      .map((e) => e.skill_name),
    nonCommonsBoundSkills: nonCommons.map((b) => b.skill),
    nonCommonsLiveSkills: nonCommons.filter(bindingCronIsLoadBearing).map((b) => b.skill),
  };
}

/** Overwrite the scope's idle sweep. Unlike LIFECYCLE this is a snapshot, not
 *  a trailing series: the digest asks "who is idle now", and keeping 90 days
 *  of daily idle lists would be a second, slower-moving copy of the EXEC
 *  ledger it is derived from. */
async function upsertIdle(
  scope: string,
  body: Pick<PerfIdleRow, "window" | "idle" | "cohort" | "commons_skills">,
): Promise<void> {
  const row: PerfIdleRow = {
    pk: perfPk(scope),
    sk: "IDLE",
    scope,
    updated_at: new Date().toISOString(),
    ...body,
  };
  await putItem(row);
}

/** Read-modify-write the scope's trailing lifecycle window with today's point. */
async function upsertLifecycle(scope: string, point: LifecyclePoint): Promise<void> {
  const existing = await getItem<PerfLifecycleRow>(perfPk(scope), "LIFECYCLE");
  const row: PerfLifecycleRow = {
    pk: perfPk(scope),
    sk: "LIFECYCLE",
    scope,
    updated_at: new Date().toISOString(),
    points: appendDailyPoint(existing?.points ?? [], point),
  };
  await putItem(row);
}
