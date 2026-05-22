// Shared agent types and DDB row shape.
// Mirrors workforce/docs/data-model.md.

export type AgentSlug = string;

export type CodeExecution = "lambda" | "claude-code-routine-on-gha";

export type Stream = "internal" | "client" | "editorial";

export type DeliverableType =
  | "article"
  | "pr"
  | "plan"
  | "design-doc"
  | "launch-plan"
  | "notification";

/** Identity fields — sourced from workforce/agents/{slug}/agent.json (git SoT). */
export interface AgentIdentity {
  slug: AgentSlug;
  first_name: string;
  last_name: string;
  residence: string;
  role: string;
  model: string;
  primary_deliverable_type: DeliverableType;
  primary_deliverable_kind: string;
  code_execution?: CodeExecution;
  prompt_version: string;
  schedule_cron_default: string;
  schedule_note: string;
  budget_monthly_usd_default: number;
  skills: string[];
  default_project: string;
  streams: Stream[];
  created_at: string;
}

/** Operational fields — DDB-mutable via the agents-api PATCH endpoint. */
export interface AgentOperational {
  schedule_cron_override?: string;
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
  schedule_cron_effective: string;
  budget_monthly_usd_effective: number;
}

export function toApiView(row: AgentMetaRow): AgentApiView {
  return {
    ...row,
    schedule_cron_effective: row.schedule_cron_override ?? row.schedule_cron_default,
    budget_monthly_usd_effective:
      row.budget_monthly_usd_override ?? row.budget_monthly_usd_default,
  };
}

export function agentPk(slug: AgentSlug): `AGENT#${string}` {
  return `AGENT#${slug}`;
}
