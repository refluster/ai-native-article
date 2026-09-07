// On-demand dispatch of an already-declared binding (adr-0025).
//
// The cadence model (adr-0005 / R-N4) is: bindings declare what fires and when;
// wf-orchestrator-tick evaluates their crons and POSTs the matching (agent ×
// skill × project) tuples to the CCR routine. That gives every cadence a
// *completeness* floor and no *latency* floor — a queue whose worker is a
// twice-daily cron waits up to twelve hours for work that arrived a second
// after the last fire. On the author lane (adr-0022) that wait is the whole
// failure mode: the 36h `author-stale` sweep escalates the PR to a human
// before the lane's worker ever looks at it.
//
// This module is the "fire it now" half. A running CCR session that has just
// created work for another cadence calls `POST /dispatch`; the agents-api
// validates the capability token, resolves the request to a binding, debounces
// it, and hands the orchestrator one explicit (agent, binding_idx) to fire
// through the ordinary CCR path.
//
// Two properties keep this inside R-N4 rather than becoming a second scheduler:
//
//   1. **Dispatch cannot invent an execution.** It only fires a binding that
//      already exists on the agent's META row — same skill, same project, same
//      credentials, same routine. A dispatch for an unbound (skill, project)
//      is refused, so "what may run" stays a bindings[] question, and the
//      binding remains the audit surface R-N4 requires.
//   2. **It is rate-limited, not free.** `claimDispatchSlot` is an atomic
//      conditional write: at most one dispatch per (agent, skill, project)
//      per debounce window. A hand-off storm (one autopilot fire parking five
//      PRs) produces ONE remediation fire, and a review→remediate→review chain
//      cannot become a hot loop even if a bug removed its semantic bounds.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { agentPk, isOrchestratorOwnedCcr, type AgentBinding, type AgentMetaRow } from "./agent.js";

function tableName(): string {
  const t = process.env.TABLE_NAME;
  if (!t) throw new Error("TABLE_NAME env var is required");
  return t;
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/** Minimum spacing between two dispatches of the same (agent, skill, project).
 *  Ten minutes: long enough that a batch of hand-offs in one fire collapses to
 *  a single run (the worker's own scan drains the whole queue anyway), short
 *  enough that a hand-off arriving after an unrelated one still gets a prompt
 *  fire rather than waiting for the cron. */
export const DEFAULT_DEBOUNCE_SECONDS = 600;

export interface DispatchRequest {
  /** Optional. Omit it — the caller is a skill script that knows which cadence
   *  should pick the work up, not which persona is bound to it, and "who owns
   *  pr-remediate on asp-cloud" is a bindings[] question the workforce can
   *  answer itself (selectDispatchAgents). Supply it only to disambiguate. */
  agent_slug?: string;
  skill: string;
  project_id: string;
  /** Free-text audit line — what created the work (e.g. "author-lane hand-off
   *  on PSVL/asp-cloud#693"). Logged and forwarded to the fire; never parsed. */
  reason?: string;
}

export type DispatchRefusal =
  | { ok: false; code: "agent_not_found"; detail: string }
  | { ok: false; code: "agent_inactive"; detail: string }
  | { ok: false; code: "binding_not_found"; detail: string }
  | { ok: false; code: "binding_not_dispatchable"; detail: string };

export type DispatchTarget = { ok: true; binding_idx: number; binding: AgentBinding };

/** Parse + structurally validate a `POST /dispatch` body. Returns the request
 *  or a one-line reason it is not one; the caller maps that to a 400. */
export function parseDispatchRequest(raw: unknown): DispatchRequest | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "body must be a JSON object" };
  const b = raw as Record<string, unknown>;
  for (const k of ["skill", "project_id"] as const) {
    const v = b[k];
    if (typeof v !== "string" || v.trim().length === 0) return { error: `${k} is required (non-empty string)` };
  }
  if (b.agent_slug !== undefined && (typeof b.agent_slug !== "string" || b.agent_slug.trim().length === 0)) {
    return { error: "agent_slug, when given, must be a non-empty string" };
  }
  const reason = typeof b.reason === "string" ? b.reason.slice(0, 512) : undefined;
  return {
    agent_slug: typeof b.agent_slug === "string" ? b.agent_slug.trim() : undefined,
    skill: String(b.skill).trim(),
    project_id: String(b.project_id).trim(),
    reason,
  };
}

/** Every active agent carrying a dispatchable (skill, project) binding.
 *
 *  This is the "who owns this cadence" lookup, and it deliberately answers
 *  from bindings[] rather than from a table the caller maintains: the binding
 *  IS the org's declaration of who runs what (R-N4), so a cadence that was
 *  never wired for a project resolves to nobody — which is the honest answer
 *  and, on PSVL/asp-cloud#692/#693, was the actual bug (the author lane had no
 *  worker bound to that project at all). Paused/archived personas are excluded:
 *  a paused agent does not fire on demand either. */
export function selectDispatchAgents(
  agents: readonly AgentMetaRow[],
  skill: string,
  projectId: string,
): Array<{ slug: string; binding_idx: number }> {
  const out: Array<{ slug: string; binding_idx: number }> = [];
  for (const agent of agents) {
    if (!agent || agent.archived || agent.paused) continue;
    const bindings = Array.isArray(agent.bindings) ? agent.bindings : [];
    const idx = bindings.findIndex(
      (b) => b?.skill === skill && b?.project_id === projectId && isOrchestratorOwnedCcr(b),
    );
    if (idx >= 0) out.push({ slug: agent.slug, binding_idx: idx });
  }
  return out;
}

/** Resolve a dispatch request against the agent's live META row.
 *
 *  Refuses — never guesses — when the pair names no binding: an unbound
 *  (skill, project) means the operator has not declared this execution, and
 *  inventing one here would put a fire outside bindings[] (R-N4). Refusal is
 *  also the safe direction for the caller: the hand-off it just wrote stands,
 *  and the cron/sweep backstops still own the PR. */
export function resolveDispatchTarget(
  agent: AgentMetaRow | undefined,
  req: DispatchRequest & { agent_slug: string },
): DispatchTarget | DispatchRefusal {
  if (!agent) return { ok: false, code: "agent_not_found", detail: `no AGENT#${req.agent_slug} META row` };
  if (agent.archived || agent.paused) {
    return {
      ok: false,
      code: "agent_inactive",
      detail: `${req.agent_slug} is ${agent.archived ? "archived" : "paused"} — a paused persona does not fire on demand either`,
    };
  }
  const bindings = Array.isArray(agent.bindings) ? agent.bindings : [];
  const idx = bindings.findIndex((b) => b?.skill === req.skill && b?.project_id === req.project_id);
  if (idx < 0) {
    const have = bindings.map((b) => `${b?.skill}@${b?.project_id ?? "-"}`).join(", ") || "(none)";
    return {
      ok: false,
      code: "binding_not_found",
      detail: `${req.agent_slug} has no ${req.skill} binding on project ${req.project_id} — declared: ${have}`,
    };
  }
  const binding = bindings[idx]!;
  if (!isOrchestratorOwnedCcr(binding)) {
    return {
      ok: false,
      code: "binding_not_dispatchable",
      detail:
        `${req.skill}@${req.project_id} is ${binding.executor}/${binding.trigger?.scheduler} — ` +
        "on-demand dispatch fires the orchestrator-owned CCR path only (executor=claude-code-routine, scheduler=external, invoked_by=api)",
    };
  }
  return { ok: true, binding_idx: idx, binding };
}

/** The DDB sort key holding the last-dispatch stamp for one (skill, project)
 *  on one agent. Lives under the agent's own partition so it is visible beside
 *  the binding it rate-limits. */
export const dispatchSlotSk = (skill: string, projectId: string): string => `DISPATCH#${skill}#${projectId}`;

export interface DispatchSlotClaim {
  claimed: boolean;
  /** Set when `claimed` is false — the stamp that blocked this attempt. */
  last_dispatched_at?: string;
}

/** Atomically claim the debounce slot for (agent, skill, project).
 *
 *  One conditional UpdateItem, not read-then-write: two hand-offs racing inside
 *  the same fire (or two fires overlapping) must produce exactly one dispatch,
 *  and only the condition expression can promise that. A refused claim is a
 *  NORMAL outcome, not an error — the work is queued and the already-dispatched
 *  run will drain it. */
export async function claimDispatchSlot(
  slug: string,
  skill: string,
  projectId: string,
  now: Date = new Date(),
  debounceSeconds: number = DEFAULT_DEBOUNCE_SECONDS,
): Promise<DispatchSlotClaim> {
  const cutoff = new Date(now.getTime() - debounceSeconds * 1000).toISOString();
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { pk: agentPk(slug), sk: dispatchSlotSk(skill, projectId) },
        UpdateExpression: "SET last_dispatched_at = :now",
        ConditionExpression: "attribute_not_exists(last_dispatched_at) OR last_dispatched_at < :cutoff",
        ExpressionAttributeValues: { ":now": now.toISOString(), ":cutoff": cutoff },
        // The blocking stamp comes back ON the failure, so a debounced caller
        // can be told when the live run started rather than just "no".
        ReturnValuesOnConditionCheckFailure: "ALL_OLD",
      }),
    );
    return { claimed: true };
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "ConditionalCheckFailedException") {
      const old = (err as { Item?: Record<string, unknown> })?.Item;
      const stamp = old && typeof old.last_dispatched_at === "string" ? old.last_dispatched_at : undefined;
      return { claimed: false, last_dispatched_at: stamp };
    }
    throw err;
  }
}

/** The event shape the agents-api sends to wf-orchestrator for an explicit
 *  fire. Deliberately distinct from the EventBridge tick payload (which is
 *  `{}`) so the orchestrator branches on presence, not on a flag. */
export interface OrchestratorDispatchEvent {
  dispatch: {
    agent_slug: string;
    binding_idx: number;
    reason?: string;
    /** Who asked. Audit only. */
    requested_by?: string;
  };
}

export function isOrchestratorDispatchEvent(event: unknown): event is OrchestratorDispatchEvent {
  if (!event || typeof event !== "object") return false;
  const d = (event as { dispatch?: unknown }).dispatch;
  if (!d || typeof d !== "object") return false;
  const { agent_slug, binding_idx } = d as { agent_slug?: unknown; binding_idx?: unknown };
  return typeof agent_slug === "string" && agent_slug.length > 0 && Number.isInteger(binding_idx) && (binding_idx as number) >= 0;
}
