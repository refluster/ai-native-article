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

/** True when *some* scheduler actually consumes `trigger.cron`, i.e. the cron
 *  is load-bearing and the binding really fires on it. A cron is honored by:
 *    - `external` + `invoked_by=api` CCR (the orchestrator-tick — isOrchestratorOwnedCcr),
 *    - `eventbridge` (a Lambda cron rule),
 *    - `gha` (a GitHub Actions cron),
 *    - `claude-code-routine` (a CCR self-schedule; see bindings.md compat table).
 *  Any other scheduler carrying a cron (notably `manual`, or `external` without
 *  `invoked_by=api`) has a **dead cron**: the string is present but no fire path
 *  reads it. This is the single predicate the UI must use so the console never
 *  again renders a decorative cron as a live schedule (the daily-research /
 *  Epic-015 drift: a cron was hand-added while scheduler stayed `manual`). */
export function bindingCronIsLoadBearing(binding: AgentBinding): boolean {
  const s = binding.trigger?.scheduler;
  return (
    isOrchestratorOwnedCcr(binding) ||
    s === "eventbridge" ||
    s === "gha" ||
    s === "claude-code-routine"
  );
}

/** The effective schedule of a binding — the operator-facing answer to "will
 *  this fire, and when?", derived from the SAME gate the orchestrator uses
 *  (isOrchestratorOwnedCcr / bindingCronIsLoadBearing) so the console can never
 *  disagree with the engine. This decides what to *display*; whether a live
 *  cron matches *this* tick is cron-match.ts (engine-only).
 *
 *    - `cron`       — a load-bearing cron; the binding fires on it.
 *    - `dead-cron`  — a cron is set but no scheduler consumes it (inert).
 *    - `manual`     — operator-triggered; no cron, nothing auto-fires it.
 *    - `declarative`— no cron; fired by its own scheduler (gha / CCR self /
 *                     external-non-api / github-event), which owns the cadence. */
export type EffectiveSchedule =
  | { kind: "cron"; cron: string; scheduler: SchedulerKind }
  | { kind: "dead-cron"; cron: string; scheduler: SchedulerKind }
  | { kind: "manual"; scheduler: SchedulerKind }
  | { kind: "declarative"; scheduler: SchedulerKind; executor: ExecutorKind };

export function effectiveSchedule(binding: AgentBinding): EffectiveSchedule {
  const scheduler = binding.trigger?.scheduler;
  const cron = binding.trigger?.cron;
  if (typeof cron === "string" && cron.length > 0) {
    return bindingCronIsLoadBearing(binding)
      ? { kind: "cron", cron, scheduler }
      : { kind: "dead-cron", cron, scheduler };
  }
  if (scheduler === "manual") return { kind: "manual", scheduler };
  return { kind: "declarative", scheduler, executor: binding.executor };
}

/** Identity fields — authoritative in the AGENT#{slug}/META DDB row
 *  (ADR-0007); historically sourced from workforce/agents/{slug}/. */
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
  /** Persona prompt (the former system.md body), inline per ADR-0007
   *  Decision §1. Required in practice — wf-messaging-reply throws on a
   *  row without it (W-4). Optional in the type only because legacy rows
   *  predate the backfill; PATCH it via agents-api if one surfaces. */
  system_prompt?: string;
  /** Profile blocks (the former agent.json extended fields) + org edges
   *  (the former workforce/agents/_org.json topology) — moved onto the
   *  row by ADR-0007 step 6a so the SPA manifest can build from the API
   *  and the git tree can retire. The SPA renders all of these
   *  null-safe; consumers derive direct_reports / depth from the
   *  reports_to edge list. */
  owner_email?: string | null;
  jd?: Record<string, unknown> | null;
  identity?: Record<string, unknown> | null;
  experience?: Record<string, unknown> | null;
  memory?: Record<string, unknown> | null;
  reports_to?: string[];
  lateral?: string[];
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
  updated_at: string;
  /** Legacy seed-era attributes (ADR-0007 steps 1–6a). Still present on
   *  rows written before the wf-seed-agents retirement; nothing reads or
   *  writes them any more. */
  identity_hash?: string;
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
