// Shared agent types and DDB row shape.
// Mirrors workforce/docs/data-model.md and workforce/docs/runbooks/bindings.md.
//
// v2 routing model: an agent's bindings[] declares {skill, executor, trigger}
// tuples. The executor determines where the binding actually runs (Lambda,
// CCR, GHA, CLI). The trigger.scheduler determines who fires it. The
// orchestrator-tick only dispatches bindings with executor=lambda +
// trigger.scheduler=eventbridge; other bindings are declarative (audit
// surface) and are fired by their respective schedulers.

export type AgentSlug = string;

export type Stream = "internal" | "client" | "editorial";

/** Where a binding actually executes. */
export type ExecutorKind = "lambda" | "claude-code-routine" | "gha" | "cli";

/** Who fires a binding. */
export type SchedulerKind =
  | "eventbridge"
  | "claude-code-routine"
  | "gha"
  | "external"
  | "manual";

/** How and when a binding fires. Fields are scheduler-specific. */
export interface BindingTrigger {
  scheduler: SchedulerKind;
  /** EventBridge-syntax cron expression. Required when scheduler=eventbridge. */
  cron?: string;
  /** GitHub event identifier (e.g. "pull_request.labeled"). Used by
   *  scheduler=claude-code-routine and scheduler=gha when GitHub-event-driven. */
  github_event?: string;
  /** Event filter (e.g. {label: "wf:needs-review-dario"}). Scheduler-specific. */
  filter?: Record<string, string>;
  /** For scheduler=external: how the binding is invoked. */
  invoked_by?: "api" | "repository_dispatch" | "manual";
  /** For scheduler=external: which skill / routine fires this binding (audit). */
  fired_from?: string;
}

/** One binding on an agent: a (skill, executor, trigger) tuple. */
export interface AgentBinding {
  /** Skill / routine name. For executor=lambda, must match workforce/skills/{name}/.
   *  For executor=claude-code-routine, it's a logical name; the prompt body lives
   *  in routine_spec. */
  skill: string;
  /** Where this binding actually runs. */
  executor: ExecutorKind;
  /** When/how it fires. */
  trigger: BindingTrigger;
  /** For executor=claude-code-routine: repo-relative path to the routine
   *  specification doc (prompt + connectors + setup notes for the operator
   *  to instantiate the routine in claude.ai/code/routines). */
  routine_spec?: string;
  /** For executor=gha: workflow file path under .github/workflows/. */
  workflow?: string;
  /** Project this binding executes against. Required for CCR-batched
   *  bindings (executor=claude-code-routine + scheduler=external +
   *  invoked_by=api) per PR β — the orchestrator-tick resolves the
   *  skill's `requires[]` against `wf/projects/{project_id}/{type}` and
   *  ships the credentials inline in the CCR /fire payload. Optional on
   *  Lambda-bound bindings today (the existing wf-agent-runner reads its
   *  webhook/secret from env vars on the legacy path); a follow-up PR
   *  may tighten this to required-on-all once the legacy paths migrate. */
  project_id?: string;
  /** Persona-overlay block — skill-specific. The skill's routine_spec /
   *  handler.ts contract defines the shape; the validator only enforces
   *  structural binding fields, not `config` contents. See bindings.md
   *  §"persona overlay" for examples (nomination_rules, lens_name,
   *  checklist_sections, ...). Forwarded to deterministic handlers via
   *  RunnerContext.binding_config (Phase 7 PR3a). */
  config?: Readonly<Record<string, unknown>>;
  /** Human-readable cadence note. Renders in the UI. */
  note?: string;
}

/** Returns the cron string for a binding, or undefined if it has no cron trigger. */
export function bindingCron(binding: AgentBinding): string | undefined {
  return binding.trigger?.cron;
}

/** True when the orchestrator-tick fires this binding by POSTing to a CCR
 *  routine's `/fire` API. Same cron-window evaluation + RUN dedup as the
 *  Lambda path; dispatch target differs. The bearer token + URL live in
 *  Secrets Manager at `wf/ccr/{binding.skill}` — see ccr-bootstrap.md and
 *  workforce/lambdas/shared/ccr-fire.ts. */
export function isOrchestratorOwnedCcr(binding: AgentBinding): boolean {
  return (
    binding.executor === "claude-code-routine" &&
    binding.trigger?.scheduler === "external" &&
    binding.trigger?.invoked_by === "api"
  );
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
  /** ADR-0007 migration marker. Set to "ddb" on the first identity write
   *  through agents-api; wf-seed-agents then stops overwriting this row's
   *  identity from the bundled git tree (the two-master interregnum guard).
   *  Absent = identity still git-sourced. Retires with the seed (step 6). */
  config_owner?: "ddb";
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
