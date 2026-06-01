// wf-orchestrator Lambda handler.
//
// Driven by a single EventBridge rule wf-orchestrator-tick-{stage} that
// fires every 30 minutes. On each tick (in order):
//
//   A. Poll Ren's pending pr DELIV rows. For each one:
//        - findRecentPRs(owner, repo, dispatch_branch, dispatched_at)
//        - On match: update DELIV pr_url + status=ok + published_at.
//        - 24h elapsed without match: status=timeout + error_message.
//
//   B. Scan all AGENT#*/META rows.
//   C. For each non-paused / non-archived agent, iterate its bindings[].
//      For each binding, evaluate its cron against a 30-minute window. If
//      matchesNow returns true, async-invoke wf-agent-runner-{stage} with
//      { agent, binding_idx }.
//   D. Skip a binding if its (skill, agent) has fired within a per-skill
//      dedup window — guards against same-window double-fire.

import type { Context } from "aws-lambda";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import {
  agentPk,
  isOrchestratorOwned,
  isOrchestratorOwnedCcr,
  type AgentBinding,
  type AgentMetaRow,
} from "../shared/agent.js";
import { scanPrefix, queryBySkPrefix, updateOperational } from "../shared/ddb.js";
import { matchesNow } from "../shared/cron-match.js";
import { findRecentPRs } from "../shared/github.js";
import { fireCcrRoutine, routineIdFromSpec, type CcrFireTask } from "../shared/ccr-fire.js";
import { asProjectId, getCredential } from "../shared/project.js";
import { SKILL_REQUIRES } from "../shared/skill-registry-generated.js";
import type { DelivRow } from "../shared/task.js";

const STAGE = process.env.STAGE;
const TICK_WINDOW_MINUTES = parseInt(process.env.TICK_WINDOW_MINUTES ?? "5", 10);
const RUNNER_FUNCTION = process.env.RUNNER_FUNCTION_NAME;
if (!STAGE) throw new Error("STAGE env var is required");
if (!RUNNER_FUNCTION) throw new Error("RUNNER_FUNCTION_NAME env var is required");

const lambda = new LambdaClient({});

// Per-skill dedup window. The orchestrator skips a binding when the
// agent's last RUN for the same skill is within this many minutes. The
// table is keyed by skill name so the dedup tracks the actual cadence
// (a 6h heartbeat skill needs a shorter dedup than a biweekly plan).
//
// Fallback DEFAULT_DEDUP_MINUTES applies to skills not listed here.
const DEFAULT_DEDUP_MINUTES = 60;
const DEDUP_MINUTES_BY_SKILL: Record<string, number> = {
  "discord-ping": 45,          // 45m — under the 1h cadence, well above the 30m tick interval
  "discord-heartbeat": 30,     // 30m — half the hourly cadence; same logic as feed-post (cron-vs-dedup edge case at exact 60m equality with default would skip alternate fires)
  "feed-post": 30,             // 30m — half the hourly cadence so the cron-vs-dedup edge case (exact 60m equality with default) can't skip a fire
  "article-level2": 30,        // 30m — half Elena's hourly L1→L2 cadence; same cron-vs-dedup edge-case logic as feed-post
  "article-draft": 60 * 5,     // 5h — Sora's 12h cadence
  "market-research": 60 * 5,
  "plan-write": 60 * 24 * 13,  // 13d — Maya's biweekly
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
  const dispatched: OrchestratorResult["dispatched"] = [];
  const skipped: OrchestratorResult["skipped"] = [];
  const ccrBatchByRoutine = new Map<string, CcrBatchSlot>();

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
        // The orchestrator-tick owns two dispatch paths sharing the same
        // scan/evaluate procedure:
        //   - isOrchestratorOwned     → async-invoke wf-agent-runner Lambda (per-binding)
        //   - isOrchestratorOwnedCcr  → collect into a per-routine batch;
        //                               fire ONE /fire POST per routine after
        //                               the agent-scan loop (PR β shape)
        // Other bindings (CCR with self-schedule, GHA, external non-API)
        // are declarative — fired by their own schedulers. Recorded as
        // skipped for inventory.
        const ownedLambda = isOrchestratorOwned(binding);
        const ownedCcr = isOrchestratorOwnedCcr(binding);
        if (!ownedLambda && !ownedCcr) {
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
        if (ownedLambda) {
          // Per-binding immediate dispatch. A lambda binding may name an
          // explicit project_id (e.g. Elena's article-level2 runs against
          // agent-workforce so its EXEC ledger lands under that project);
          // forward it so the runner's resolveProjectId honours it instead
          // of defaulting to self/{slug}.
          try {
            await invokeRunner(agent.slug, i, binding.project_id);
            dispatched.push({ slug: agent.slug, binding_idx: i, skill: binding.skill });
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            console.error(JSON.stringify({ event: "dispatch-error", slug: agent.slug, skill: binding.skill, reason }));
            skipped.push({ slug: agent.slug, binding_idx: i, skill: binding.skill, reason: `dispatch_error: ${reason.slice(0, 200)}` });
          }
          continue;
        }
        // ownedCcr — pre-resolve credentials, then collect into the
        // routine-id-keyed batch. A failure here (missing project_id,
        // unknown skill, credential read error) is per-task: the bad
        // task is skipped; other tasks in the batch still fire.
        try {
          const routineId = routineIdFromSpec(binding.routine_spec ?? "");
          if (!binding.project_id) {
            throw new Error(`binding missing project_id (CCR batch requires explicit project per PR β)`);
          }
          const requires = SKILL_REQUIRES[binding.skill];
          if (requires === undefined) {
            throw new Error(`skill "${binding.skill}" not in SKILL_REQUIRES map — re-run npm run workforce:skill-registry`);
          }
          const credentials = await resolveCredentialsForTask(binding.project_id, requires);
          const task: CcrFireTask = {
            agent_slug: agent.slug,
            binding_idx: i,
            project_id: binding.project_id,
            ticked_at: tickedAt,
            credentials,
          };
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

async function invokeRunner(slug: string, bindingIdx: number, projectId?: string): Promise<void> {
  const payload: { agent: string; binding_idx: number; project_id?: string } = {
    agent: slug,
    binding_idx: bindingIdx,
  };
  // Only forward project_id when the binding declares one — omitting it lets
  // the runner fall back to self/{slug} (the default for cron bindings).
  if (projectId) payload.project_id = projectId;
  await lambda.send(
    new InvokeCommand({
      FunctionName: RUNNER_FUNCTION,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify(payload)),
    }),
  );
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
    out[type] = await getCredential<unknown>(proj, type);
  }
  return out;
}

export type { AgentMetaRow };
