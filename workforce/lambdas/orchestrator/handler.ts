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
import { fireCcrRoutine, routineIdFromSpec } from "../shared/ccr-fire.js";
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

export async function handler(_event: unknown, _context: Context): Promise<OrchestratorResult> {
  const now = new Date();
  const tickedAt = now.toISOString();
  const dispatched: OrchestratorResult["dispatched"] = [];
  const skipped: OrchestratorResult["skipped"] = [];

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
        //   - isOrchestratorOwned     → async-invoke wf-agent-runner Lambda
        //   - isOrchestratorOwnedCcr  → POST to a CCR routine's /fire URL
        //     (Secret at wf/ccr/{skill}, see shared/ccr-fire.ts)
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
        try {
          if (ownedCcr) {
            // routine_id = basename of binding.routine_spec → wf/ccr/{routine_id}.
            // Bindings sharing a routine_spec share the secret (one CCR routine
            // handles many (agent, skill) pairs — see workforce/docs/routines/agent-runner.md).
            const routineId = routineIdFromSpec(binding.routine_spec ?? "");
            await fireCcrRoutine(routineId, {
              agent_slug: agent.slug,
              binding_idx: i,
              ticked_at: tickedAt,
            });
          } else {
            await invokeRunner(agent.slug, i);
          }
          dispatched.push({ slug: agent.slug, binding_idx: i, skill: binding.skill });
        } catch (err) {
          // Dispatch failure: W-4 fail-loud. Record as skipped with the
          // error message so the operator can find it in the tick log.
          // The next tick will retry (cron + dedup-window semantics
          // unchanged).
          const reason = err instanceof Error ? err.message : String(err);
          console.error(JSON.stringify({ event: "dispatch-error", slug: agent.slug, skill: binding.skill, reason }));
          skipped.push({ slug: agent.slug, binding_idx: i, skill: binding.skill, reason: `dispatch_error: ${reason.slice(0, 200)}` });
        }
      }
    }
  } while (cursor);

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

async function invokeRunner(slug: string, bindingIdx: number): Promise<void> {
  await lambda.send(
    new InvokeCommand({
      FunctionName: RUNNER_FUNCTION,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify({ agent: slug, binding_idx: bindingIdx })),
    }),
  );
}

export type { AgentMetaRow };
