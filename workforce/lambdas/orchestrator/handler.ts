// wf-orchestrator Lambda handler.
//
// Driven by a single EventBridge rule wf-orchestrator-tick-{stage} that
// fires every 2 hours. On each tick (in order):
//
//   A. Poll Ren's pending pr DELIV rows. For each one:
//        - findRecentPRs(owner, repo, dispatch_branch, dispatched_at)
//        - On match: update DELIV pr_url + status=ok + published_at.
//        - 24h elapsed without match: status=timeout + error_message.
//
//   B. Scan all AGENT#*/META rows.
//   C. For each non-paused / non-archived agent, iterate its bindings[].
//      For each binding, evaluate its cron against a 120-minute window. If
//      matchesNow returns true, async-invoke wf-agent-runner-{stage} with
//      { agent, binding_idx }.
//   D. Skip a binding if its (skill, agent) has fired within a per-skill
//      dedup window — guards against same-window double-fire.
//
// The same handler also serves an EXPLICIT, single-binding fire (adr-0025).
// When the event carries `{ dispatch: { agent_slug, binding_idx } }` — sent by
// the agents-api's `POST /dispatch` route after it validated the capability
// token, resolved the binding and claimed the debounce slot — the cron scan is
// skipped entirely and that one binding is prepared and fired through the same
// CCR path. Nothing about *what* runs changes; only *when* it starts.

import type { Context } from "aws-lambda";
import {
  agentPk,
  isOrchestratorOwnedCcr,
  type AgentBinding,
  type AgentMetaRow,
} from "../shared/agent.js";
import { scanPrefix, queryBySkPrefix, updateOperational, getItem } from "../shared/ddb.js";
import { isOrchestratorDispatchEvent, type OrchestratorDispatchEvent } from "../shared/dispatch.js";
import { matchesNow } from "../shared/cron-match.js";
import { findRecentPRs } from "../shared/github.js";
import { fireCcrRoutine, routineIdFromSpec, type CcrFireTask } from "../shared/ccr-fire.js";
import { asProjectId, getCredential } from "../shared/project.js";
import { mintEngagementToken } from "../shared/engagement-token.js";
import { mintMemoryWriteToken } from "../shared/memory-write-token.js";
import { mintDispatchToken } from "../shared/dispatch-token.js";
import { SKILL_REQUIRES } from "../shared/skill-registry-generated.js";
import type { DelivRow } from "../shared/task.js";

const STAGE = process.env.STAGE;
const TICK_WINDOW_MINUTES = parseInt(process.env.TICK_WINDOW_MINUTES ?? "5", 10);
if (!STAGE) throw new Error("STAGE env var is required");

// Per-skill dedup window. The orchestrator skips a binding when the
// agent's last RUN for the same skill is within this many minutes. The
// table is keyed by skill name so the dedup tracks the actual cadence
// (a 6h heartbeat skill needs a shorter dedup than a biweekly plan).
//
// Fallback DEFAULT_DEDUP_MINUTES applies to skills not listed here.
const DEFAULT_DEDUP_MINUTES = 60;
const DEDUP_MINUTES_BY_SKILL: Record<string, number> = {
  "discord-heartbeat": 30,     // 30m — well under the 2-hourly cadence (cron(20 0/2 …)); skip-safe with wide margin
  "feed-post": 30,             // 30m — guards same-window double-fire of the daily cadence (cron(M H ? * * *)). Must stay short: dedup keys on agent.last_run_at (any skill), so a long window would starve feed-post on multi-binding agents whose other skills run more often.
  "article-level2": 30,        // 30m — well under Elena's 2-hourly L1→L2 cadence (cron(0 0/2 …)); skip-safe with wide margin
  "design-note": 60 * 24 * 6,
  "positioning-write": 60 * 24 * 6,
  "code-task-brief": 60 * 12,  // 12h — Ren's daily
};

// Polling Ren's pending PR DELIVs.
const ENGINEER_SLUG = process.env.ENGINEER_SLUG ?? "ren";
const ENGINEER_OWNER = process.env.ENGINEER_OWNER ?? "refluster";
const ENGINEER_REPO = process.env.ENGINEER_REPO ?? "ai-native-article";
const ENGINEER_TIMEOUT_MIN = parseInt(process.env.ENGINEER_TIMEOUT_MIN ?? "1440", 10);

export interface OrchestratorResult {
  ticked_at: string;
  scanned: number;
  dispatched: Array<{ slug: string; binding_idx: number; skill: string }>;
  skipped: Array<{ slug: string; binding_idx: number; skill: string; reason: string }>;
  pr_polls: {
    pending_seen: number;
    promoted_ok: Array<{ deliv_id: string; pr_url: string }>;
    timed_out: Array<{ deliv_id: string }>;
  };
}

/** Per-routine batch collector: routineId → (tasks, slot-aligned audit items).
 *  The two arrays stay parallel — same length, same order — so flush-time
 *  bookkeeping can pair each task with its (slug, binding_idx, skill)
 *  audit entry to push into dispatched[] or skipped[] depending on the
 *  batch outcome. Keyed by routineId because each routine has its own
 *  /fire URL + token in wf/ccr/{routineId}. */
type CcrBatchSlot = {
  tasks: CcrFireTask[];
  items: Array<{ slug: string; binding_idx: number; skill: string }>;
};

export async function handler(_event: unknown, _context: Context): Promise<OrchestratorResult> {
  const now = new Date();
  const tickedAt = now.toISOString();

  // adr-0025 — explicit single-binding fire. Handled before the cron scan and
  // returns without running it: an on-demand dispatch must not drag the whole
  // tick's worth of crons along with it.
  if (isOrchestratorDispatchEvent(_event)) {
    return await handleDispatch(_event, tickedAt);
  }

  const dispatched: OrchestratorResult["dispatched"] = [];
  const skipped: OrchestratorResult["skipped"] = [];
  const ccrBatchByRoutine = new Map<string, CcrBatchSlot>();

  // ADR-0005 item 5: mint ONE short-lived engagement-write token for this
  // fire and inject it into every CCR task, so the routine can record one
  // activity-ledger row per task (POST /agents/{slug}/engagements). Best-
  // effort: a mint failure must not stall the fire — tasks still run, the
  // per-task engagement record is just skipped this cycle.
  let fireEngagementToken: string | undefined;
  try {
    fireEngagementToken = (await mintEngagementToken()).token;
  } catch (err) {
    console.warn(JSON.stringify({ event: "engagement-token-mint-failed", error: err instanceof Error ? err.message : String(err) }));
  }

  // A. Poll Ren's pending PR DELIVs first.
  const pr_polls = await pollEngineerPRs(now);

  // B/C/D. Cron-driven dispatch — iterate every agent × every binding.
  let cursor: string | undefined;
  let scanned = 0;
  do {
    const page = await scanPrefix<AgentMetaRow>("AGENT#", "META", 100, cursor);
    cursor = page.cursor;
    for (const agent of page.items) {
      scanned++;
      if (agent.archived || agent.paused) {
        for (let i = 0; i < (agent.bindings?.length ?? 0); i++) {
          skipped.push({
            slug: agent.slug,
            binding_idx: i,
            skill: agent.bindings[i]!.skill,
            reason: agent.archived ? "archived" : "paused",
          });
        }
        continue;
      }
      for (let i = 0; i < agent.bindings.length; i++) {
        const binding = agent.bindings[i]!;
        // ADR-0005: the orchestrator-tick fires CCR bindings only
        // (executor=claude-code-routine, scheduler=external, invoked_by=api):
        // collect each into a per-routine batch and fire ONE /fire POST per
        // routine after the agent-scan loop. Other bindings (CCR self-schedule,
        // GHA, external non-API) are declarative — fired by their own
        // schedulers. Recorded as skipped for inventory. The legacy
        // async-invoke-Lambda path was removed when wf-agent-runner was retired.
        const ownedCcr = isOrchestratorOwnedCcr(binding);
        if (!ownedCcr) {
          skipped.push({
            slug: agent.slug,
            binding_idx: i,
            skill: binding.skill,
            reason: `non_orchestrator_executor: ${binding.executor}/${binding.trigger?.scheduler}`,
          });
          continue;
        }
        const decision = await evaluateBinding(agent, i, binding, now);
        if (decision.action !== "dispatch") {
          skipped.push({ slug: agent.slug, binding_idx: i, skill: binding.skill, reason: decision.reason });
          continue;
        }
        // ownedCcr — pre-resolve credentials, then collect into the
        // routine-id-keyed batch. A failure here (missing project_id,
        // unknown skill, credential read error) is per-task: the bad
        // task is skipped; other tasks in the batch still fire.
        try {
          const routineId = routineIdFromSpec(binding.routine_spec ?? "");
          const task = await prepareCcrTask(agent.slug, i, binding, tickedAt, fireEngagementToken);
          const slot = ccrBatchByRoutine.get(routineId) ?? { tasks: [], items: [] };
          slot.tasks.push(task);
          slot.items.push({ slug: agent.slug, binding_idx: i, skill: binding.skill });
          ccrBatchByRoutine.set(routineId, slot);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          console.error(JSON.stringify({ event: "ccr-prep-error", slug: agent.slug, skill: binding.skill, reason }));
          skipped.push({ slug: agent.slug, binding_idx: i, skill: binding.skill, reason: `ccr_prep_error: ${reason.slice(0, 200)}` });
        }
      }
    }
  } while (cursor);

  // Flush per-routine CCR batches. One POST per routine_id with all
  // its collected tasks. A successful batch promotes every item to
  // dispatched[]; a failed batch puts every item in skipped[] with
  // the same error reason — keeps the audit trail clean.
  for (const [routineId, slot] of ccrBatchByRoutine) {
    if (slot.tasks.length === 0) continue;
    try {
      const fired = await fireCcrRoutine(routineId, { tasks: slot.tasks });
      for (const item of slot.items) dispatched.push(item);
      console.log(JSON.stringify({
        event: "ccr-batch-fired",
        routine_id: routineId,
        task_count: slot.tasks.length,
        session_id: fired.session_id,
        session_url: fired.session_url,
      }));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({ event: "ccr-batch-error", routine_id: routineId, task_count: slot.tasks.length, reason }));
      for (const item of slot.items) {
        skipped.push({
          slug: item.slug,
          binding_idx: item.binding_idx,
          skill: item.skill,
          reason: `ccr_batch_error[${routineId}]: ${reason.slice(0, 180)}`,
        });
      }
    }
  }

  const result: OrchestratorResult = { ticked_at: tickedAt, scanned, dispatched, skipped, pr_polls };
  console.log(JSON.stringify({ event: "tick-complete", result }));
  return result;
}

/** Build one CCR task from a binding: resolve the skill's declared credential
 *  types for the binding's project and stamp the fire's engagement token in.
 *  Shared by the cron scan and the on-demand dispatch path so the two can
 *  never compose a task differently (R-N8 — no per-path branches). Throws on
 *  a binding the orchestrator cannot prepare; both callers catch. */
async function prepareCcrTask(
  slug: string,
  bindingIdx: number,
  binding: AgentBinding,
  tickedAt: string,
  fireEngagementToken?: string,
): Promise<CcrFireTask> {
  if (!binding.project_id) {
    throw new Error(`binding missing project_id (CCR batch requires explicit project per PR β)`);
  }
  const requires = SKILL_REQUIRES[binding.skill];
  if (requires === undefined) {
    throw new Error(`skill "${binding.skill}" not in SKILL_REQUIRES map — re-run npm run workforce:skill-registry`);
  }
  const credentials = await resolveCredentialsForTask(binding.project_id, requires);
  // Inject this fire's short-lived engagement-write token (minted by the
  // caller) so the CCR routine can record the task's activity row.
  if (fireEngagementToken) (credentials as Record<string, unknown>).engagement_write_token = fireEngagementToken;
  return {
    agent_slug: slug,
    binding_idx: bindingIdx,
    project_id: binding.project_id,
    ticked_at: tickedAt,
    credentials,
  };
}

/** adr-0025 — fire ONE explicitly-named binding now.
 *
 *  Everything the agents-api could check has already been checked there (token
 *  valid, binding exists and is orchestrator-owned CCR, debounce slot claimed).
 *  What is re-read here is the binding itself: the request carries an index,
 *  and an index resolved against a row read seconds ago in another Lambda is a
 *  claim, not a fact. A mismatch throws rather than firing the wrong skill.
 *
 *  The cron scan is NOT run: this returns a result shaped like a tick with one
 *  dispatched (or skipped) entry, so the audit surface is the same either way. */
async function handleDispatch(event: OrchestratorDispatchEvent, tickedAt: string): Promise<OrchestratorResult> {
  const { agent_slug, binding_idx, reason, requested_by } = event.dispatch;
  const empty: OrchestratorResult["pr_polls"] = { pending_seen: 0, promoted_ok: [], timed_out: [] };
  const base = { ticked_at: tickedAt, scanned: 1, pr_polls: empty };
  const skip = (skill: string, why: string): OrchestratorResult => {
    console.error(JSON.stringify({ event: "dispatch-refused", slug: agent_slug, binding_idx, skill, reason: why, requested_by }));
    return { ...base, dispatched: [], skipped: [{ slug: agent_slug, binding_idx, skill, reason: why }] };
  };

  const agent = await getItem<AgentMetaRow>(agentPk(agent_slug), "META");
  if (!agent) return skip("?", `agent_not_found: ${agent_slug}`);
  if (agent.archived || agent.paused) return skip("?", agent.archived ? "archived" : "paused");
  const binding = agent.bindings?.[binding_idx];
  if (!binding) return skip("?", `binding_idx ${binding_idx} out of range (${agent.bindings?.length ?? 0} bindings)`);
  if (!isOrchestratorOwnedCcr(binding)) {
    return skip(binding.skill, `non_orchestrator_executor: ${binding.executor}/${binding.trigger?.scheduler}`);
  }

  // The dedup window (evaluateBinding) is deliberately NOT applied. It exists
  // to stop one cron matching twice inside a tick window; an on-demand fire is
  // rate-limited by the agents-api's debounce claim, which is per (skill,
  // project) rather than per agent — the right grain for "work just arrived on
  // this queue" and one this path must not have re-suppressed by an unrelated
  // skill's recent run.
  let fireEngagementToken: string | undefined;
  try {
    fireEngagementToken = (await mintEngagementToken()).token;
  } catch (err) {
    console.warn(JSON.stringify({ event: "engagement-token-mint-failed", error: err instanceof Error ? err.message : String(err) }));
  }

  try {
    const routineId = routineIdFromSpec(binding.routine_spec ?? "");
    const task = await prepareCcrTask(agent_slug, binding_idx, binding, tickedAt, fireEngagementToken);
    const fired = await fireCcrRoutine(routineId, { tasks: [task] });
    console.log(JSON.stringify({
      event: "ccr-dispatch-fired",
      routine_id: routineId,
      slug: agent_slug,
      skill: binding.skill,
      project_id: binding.project_id,
      dispatch_reason: reason,
      requested_by,
      session_id: fired.session_id,
      session_url: fired.session_url,
    }));
    return { ...base, dispatched: [{ slug: agent_slug, binding_idx, skill: binding.skill }], skipped: [] };
  } catch (err) {
    // W-4: loud, and loud in the orchestrator's own error metric — the caller
    // (a CCR session mid-hand-off) treats dispatch as best-effort by design,
    // so this log + the function's error alarm are where a broken dispatch
    // path becomes visible. The cron backstop still owns the queue.
    const why = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ event: "ccr-dispatch-error", slug: agent_slug, skill: binding.skill, reason: why }));
    throw err;
  }
}

async function pollEngineerPRs(now: Date): Promise<OrchestratorResult["pr_polls"]> {
  const promoted_ok: OrchestratorResult["pr_polls"]["promoted_ok"] = [];
  const timed_out: OrchestratorResult["pr_polls"]["timed_out"] = [];

  const rows = await queryBySkPrefix<DelivRow>(agentPk(ENGINEER_SLUG), "DELIV#", 100);
  const pending = rows.filter((r) => r.status === "pending" && r.type === "pr");
  if (pending.length === 0) return { pending_seen: 0, promoted_ok, timed_out };

  const earliest = pending.reduce(
    (acc, r) => (r.dispatched_at && r.dispatched_at < acc ? r.dispatched_at : acc),
    now.toISOString(),
  );
  let recentPRs: Awaited<ReturnType<typeof findRecentPRs>> = [];
  try {
    recentPRs = await findRecentPRs(ENGINEER_OWNER, ENGINEER_REPO, `${ENGINEER_SLUG}/`, earliest);
  } catch (err) {
    console.warn("findRecentPRs failed:", err instanceof Error ? err.message : String(err));
    return { pending_seen: pending.length, promoted_ok, timed_out };
  }

  for (const row of pending) {
    const delivId = row.sk.replace("DELIV#", "");
    const branch = row.dispatch_branch ?? `${ENGINEER_SLUG}/${delivId}`;
    const match = recentPRs.find((p) => p.branch === branch);
    if (match) {
      await updateOperational(row.pk, row.sk, {
        pr_url: match.url,
        status: "ok",
        published_at: now.toISOString(),
      });
      promoted_ok.push({ deliv_id: delivId, pr_url: match.url });
      continue;
    }
    const dispatchedAt = row.dispatched_at ?? row.created_at;
    const ageMin = (now.getTime() - Date.parse(dispatchedAt)) / 60_000;
    if (ageMin > ENGINEER_TIMEOUT_MIN) {
      await updateOperational(row.pk, row.sk, {
        status: "timeout",
        error_message: `no PR appeared within ${ENGINEER_TIMEOUT_MIN}min`,
      });
      console.warn(JSON.stringify({ event: "engineer-pr-timeout", deliv_id: delivId, branch, age_min: Math.round(ageMin) }));
      timed_out.push({ deliv_id: delivId });
    }
  }
  return { pending_seen: pending.length, promoted_ok, timed_out };
}

type Decision = { action: "dispatch" } | { action: "skip"; reason: string };

async function evaluateBinding(
  agent: AgentMetaRow,
  bindingIdx: number,
  binding: AgentBinding,
  now: Date,
): Promise<Decision> {
  const cron = binding.trigger?.cron;
  if (!cron) {
    return { action: "skip", reason: "binding_missing_cron" };
  }
  let fires: boolean;
  try {
    fires = matchesNow(cron, now, { windowMinutes: TICK_WINDOW_MINUTES });
  } catch (err) {
    return { action: "skip", reason: `cron_parse_error: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!fires) return { action: "skip", reason: "not_scheduled" };

  // Per-skill dedup: scan recent RUN rows for this agent + same skill.
  const dedupMin = DEDUP_MINUTES_BY_SKILL[binding.skill] ?? DEFAULT_DEDUP_MINUTES;
  // For v1 simplicity we reuse the agent's last_run_at (any skill). This
  // is correct for single-binding agents (the common case) and conservative
  // for multi-binding agents (skipping when a *different* skill ran recently
  // is a false positive that resolves on the next tick). A per-skill last-run
  // index lives at GSI1 in v2.
  if (agent.last_run_at) {
    const lastMs = Date.parse(agent.last_run_at);
    if (Number.isFinite(lastMs)) {
      const sinceMin = (now.getTime() - lastMs) / 60_000;
      if (sinceMin < dedupMin) {
        return { action: "skip", reason: `dedup_window (${sinceMin.toFixed(0)}m < ${dedupMin}m)` };
      }
    }
  }
  void bindingIdx;
  return { action: "dispatch" };
}

/** Resolve a task's credential bag inline for the CCR fire payload.
 *  Per Q1=A (operator design discussion above PR #176): orchestrator
 *  (the privileged AWS principal) reads each credential from
 *  `wf/projects/{project_id}/{type}` and ships it inline to CCR. CCR
 *  itself never touches Secrets Manager. An empty `requires[]` yields
 *  an empty map; a read error propagates and is caught per-task by the
 *  scan loop's prep-error branch. */

async function resolveCredentialsForTask(
  projectId: string,
  requires: readonly string[],
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  if (requires.length === 0) return out;
  const proj = asProjectId(projectId);
  for (const type of requires) {
    // ADR-0021: workforce.memory_write_token is minted per-task into DDB
    // (AUTH#MEMORY_WRITE) rather than read from Secrets Manager — the same
    // dynamic-capability-token shape ADR-0005/ADR-0009 established for the
    // engagement-write token. The credential key + shape presented to the
    // skill script (`{token}`) is unchanged, so this is invisible to
    // memory-curation's SKILL.md / update-memory.mjs contract: only the
    // resolution mechanism moved from static-secret to per-fire mint.
    if (type === "workforce.memory_write_token") {
      const minted = await mintMemoryWriteToken();
      out[type] = { token: minted.token };
      continue;
    }
    // adr-0025: same per-fire dynamic-token shape for the dispatch capability.
    // A skill that hands work to another cadence (pr-autopilot → pr-remediate
    // and back) declares `workforce.dispatch_token` in its requires[]; the
    // token authorises `POST /dispatch` and nothing else, and expires with the
    // fire. There is no static secret to fall back to by design.
    if (type === "workforce.dispatch_token") {
      const minted = await mintDispatchToken();
      out[type] = { token: minted.token };
      continue;
    }
    out[type] = await getCredential<unknown>(proj, type);
  }
  return out;
}

export type { AgentMetaRow };
