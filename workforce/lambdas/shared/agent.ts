// Shared agent types and DDB row shape.
// Mirrors workforce/docs/data-model.md.
//
// v1 routing model (1-stage): an agent's bindings[] declares the
// (cron → skill) pairs directly. There is no task_kind / outputs token
// matching; the orchestrator dispatches {agent, binding_idx} and the
// runner loads exactly that binding's skill.

export type AgentSlug = string;

export type Stream = "internal" | "client" | "editorial";

/** One cron-to-skill binding on an agent. The cron fires the named skill. */
export interface AgentBinding {
  /** EventBridge cron expression. UTC. */
  cron: string;
  /** Skill slug — must match a workforce/skills/{name}/ directory. */
  skill: string;
  /** Human-readable cadence note. Renders in the UI. */
  note?: string;
}

/** Identity fields — sourced from workforce/agents/{slug}/agent.json (git SoT). */
export interface AgentIdentity {
  slug: AgentSlug;
  first_name: string;
  last_name: string;
  residence: string;
  role: string;
  model: string;
  prompt_version: string;
  budget_monthly_usd_default: number;
  default_project: string;
  streams: Stream[];
  bindings: AgentBinding[];
  created_at: string;
}

/** Operational fields — DDB-mutable via the agents-api PATCH endpoint. */
export interface AgentOperational {
  budget_monthly_usd_override?: number;
  paused: boolean;
  archived: boolean;
  last_run_at?: string;
  last_run_status?: "ok" | "throw" | "dlq";
}

/** Computed roll-ups — written by the runner, read-only via the API. */
export interface AgentComputed {
  runs_this_month: number;
  cost_this_month_usd: number;
  deliv_count_total: number;
}

/** Full DDB row at AGENT#{slug}/META. */
export interface AgentMetaRow extends AgentIdentity, AgentOperational, AgentComputed {
  pk: `AGENT#${string}`;
  sk: "META";
  identity_hash: string;
  updated_at: string;
}

/** API response shape — flattens the row, omits the PK/SK plumbing. */
export interface AgentApiView extends AgentIdentity, AgentOperational, AgentComputed {
  budget_monthly_usd_effective: number;
}

export function toApiView(row: AgentMetaRow): AgentApiView {
  return {
    ...row,
    budget_monthly_usd_effective:
      row.budget_monthly_usd_override ?? row.budget_monthly_usd_default,
  };
}

export function agentPk(slug: AgentSlug): `AGENT#${string}` {
  return `AGENT#${slug}`;
}
