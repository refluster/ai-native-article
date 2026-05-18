// wf-orchestrator Lambda handler.
//
// Driven by a single EventBridge rule wf-orchestrator-tick-{stage} that
// fires every 5 minutes. On each tick (in order):
//
//   A. Poll Ren's pending pr DELIV rows. For each one:
//        - findRecentPRs(owner, repo, dispatch_branch, dispatched_at)
//        - On match: update DELIV pr_url + status=ok + published_at.
//        - 24h elapsed without match: status=timeout + error_message.
//        The 24h timeout is the W-4 mechanical guard against silent
//        Claude-Code-routine failures.
//
//   B. Scan all AGENT#*/META rows.
//   C. For each non-archived agent, evaluate its effective cron against
//      a 5-minute window. If matchesNow returns true, async-invoke
//      wf-agent-runner-{stage} with { agent, task_kind }.
//   D. Skip an agent if its last_run_at is within a per-cadence dedup
//      window — guards against same-window double-fire.
//
// Paused/archived agents are skipped without invoking the runner.

import type { Context } from "aws-lambda";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { agentPk, type AgentMetaRow, type DeliverableType } from "../shared/agent.js";
import { scanPrefix, queryBySkPrefix, updateOperational } from "../shared/ddb.js";
import { matchesNow } from "../shared/cron-match.js";
import { findRecentPRs } from "../shared/github.js";
import type { DelivRow } from "../shared/task.js";

const STAGE = process.env.STAGE;
const TICK_WINDOW_MINUTES = parseInt(process.env.TICK_WINDOW_MINUTES ?? "5", 10);
const RUNNER_FUNCTION = process.env.RUNNER_FUNCTION_NAME;
if (!STAGE) throw new Error("STAGE env var is required");
if (!RUNNER_FUNCTION) throw new Error("RUNNER_FUNCTION_NAME env var is required");

const lambda = new LambdaClient({});

// Default dedup window per deliverable type. The orchestrator skips an
// agent whose last_run_at is within this many minutes — guards against
// the same 5-min cron tick firing twice (clock skew, retry). Smaller
// than the natural cadence in every case.
const DEDUP_MINUTES_BY_TYPE: Record<DeliverableType, number> = {
  article: 60 * 6,   // 6h — Sora's twice-daily L0->L1 fires every 12h
  plan: 60 * 24 * 13, // 13d — Maya's biweekly enforcement
  pr: 60 * 12,        // 12h — Ren's daily, give half a day's slack
  "design-doc": 60 * 24 * 6,
  "launch-plan": 60 * 24 * 6,
};

// Polling Ren's pending PR DELIVs.
const ENGINEER_SLUG = process.env.ENGINEER_SLUG ?? "ren";
const ENGINEER_OWNER = process.env.ENGINEER_OWNER ?? "refluster";
const ENGINEER_REPO = process.env.ENGINEER_REPO ?? "ai-native-article";
const ENGINEER_TIMEOUT_MIN = parseInt(process.env.ENGINEER_TIMEOUT_MIN ?? "1440", 10); // 24h default

export interface OrchestratorResult {
  ticked_at: string;
  scanned: number;
  dispatched: Array<{ slug: string; task_kind: string }>;
  skipped: Array<{ slug: string; reason: string }>;
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

  // A. Poll Ren's pending PR DELIVs first. Doing it before dispatch means
  // a just-dispatched DELIV (which we'd write later in this same tick)
  // can't be re-checked too eagerly.
  const pr_polls = await pollEngineerPRs(now);

  // B/C/D. Cron-driven dispatch.
  let cursor: string | undefined;
  let scanned = 0;
  do {
    const page = await scanPrefix<AgentMetaRow>("AGENT#", "META", 100, cursor);
    cursor = page.cursor;
    for (const agent of page.items) {
      scanned++;
      const decision = await evaluate(agent, now);
      if (decision.action === "dispatch") {
        await invokeRunner(agent.slug, decision.task_kind);
        dispatched.push({ slug: agent.slug, task_kind: decision.task_kind });
      } else {
        skipped.push({ slug: agent.slug, reason: decision.reason });
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

  if (pending.length === 0) {
    return { pending_seen: 0, promoted_ok, timed_out };
  }

  // One GitHub list-PRs call covers all pending rows — we filter client-side
  // by dispatch_branch. Earliest dispatched_at scopes the `since` filter.
  const earliest = pending.reduce(
    (acc, r) => (r.dispatched_at && r.dispatched_at < acc ? r.dispatched_at : acc),
    now.toISOString(),
  );
  let recentPRs: Awaited<ReturnType<typeof findRecentPRs>> = [];
  try {
    recentPRs = await findRecentPRs(ENGINEER_OWNER, ENGINEER_REPO, `${ENGINEER_SLUG}/`, earliest);
  } catch (err) {
    console.warn("findRecentPRs failed:", err instanceof Error ? err.message : String(err));
    // Don't fail the whole tick — pending rows stay pending; next tick retries.
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
    // Timeout?
    const dispatchedAt = row.dispatched_at ?? row.created_at;
    const ageMin = (now.getTime() - Date.parse(dispatchedAt)) / 60_000;
    if (ageMin > ENGINEER_TIMEOUT_MIN) {
      await updateOperational(row.pk, row.sk, {
        status: "timeout",
        error_message: `no PR appeared within ${ENGINEER_TIMEOUT_MIN}min`,
      });
      // Log loudly — alarm on Errors metric will catch the orchestrator
      // *throw*, but timeouts are within-bound state transitions. Surface
      // via console for now; a dedicated CloudWatch metric is a follow-up.
      console.warn(JSON.stringify({ event: "engineer-pr-timeout", deliv_id: delivId, branch, age_min: Math.round(ageMin) }));
      timed_out.push({ deliv_id: delivId });
    }
  }
  return { pending_seen: pending.length, promoted_ok, timed_out };
}

type Decision =
  | { action: "dispatch"; task_kind: string }
  | { action: "skip"; reason: string };

async function evaluate(agent: AgentMetaRow, now: Date): Promise<Decision> {
  if (agent.archived) return { action: "skip", reason: "archived" };
  if (agent.paused) return { action: "skip", reason: "paused" };

  const cron = agent.schedule_cron_override ?? agent.schedule_cron_default;
  let fires: boolean;
  try {
    fires = matchesNow(cron, now, { windowMinutes: TICK_WINDOW_MINUTES });
  } catch (err) {
    return {
      action: "skip",
      reason: `cron_parse_error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!fires) return { action: "skip", reason: "not_scheduled" };

  // Dedup: agent fired recently within its per-type window? Skip.
  if (agent.last_run_at) {
    const dedupMin = DEDUP_MINUTES_BY_TYPE[agent.primary_deliverable_type] ?? 60;
    const lastMs = Date.parse(agent.last_run_at);
    if (Number.isFinite(lastMs)) {
      const sinceMin = (now.getTime() - lastMs) / 60_000;
      if (sinceMin < dedupMin) {
        return { action: "skip", reason: `dedup_window (${sinceMin.toFixed(0)}m < ${dedupMin}m)` };
      }
    }
  }

  return { action: "dispatch", task_kind: defaultTaskKindFor(agent) };
}

function defaultTaskKindFor(agent: AgentMetaRow): string {
  switch (agent.primary_deliverable_type) {
    case "article":
      return agent.primary_deliverable_kind === "l1-insight" ? "l0-to-l1" : "weekly-synthesis";
    case "plan":
      return "hypothesis";
    case "pr":
      return "pr";
    case "design-doc":
      return "design";
    case "launch-plan":
      return "launch";
    default:
      return "weekly-synthesis";
  }
}

async function invokeRunner(slug: string, task_kind: string): Promise<void> {
  await lambda.send(
    new InvokeCommand({
      FunctionName: RUNNER_FUNCTION,
      InvocationType: "Event", // async; orchestrator does not block
      Payload: Buffer.from(JSON.stringify({ agent: slug, task_kind })),
    }),
  );
}

// Re-exported only to keep agent.ts's DeliverableType import tree-shakeable.
export type { AgentMetaRow };
