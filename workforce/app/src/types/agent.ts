// Workforce agent types — what the live agents-api serves (ADR-0008 §7)
// and the SPA consumes. Binding shapes mirror the canonical
// workforce/lambdas/shared/agent.ts (duplicated because the two TS
// projects compile under different module/target configs — same
// precedent as types/project.ts).

export type AgentBindingTrigger = {
  /** Who fires the binding. The CCR-batched shape the orchestrator
   *  dispatches is scheduler=external + invoked_by=api. */
  scheduler: 'eventbridge' | 'claude-code-routine' | 'gha' | 'external' | 'manual';
  /** EventBridge-syntax cron expression, e.g. "cron(7 1 ? * * *)" (UTC). */
  cron?: string;
  github_event?: string;
  filter?: Record<string, string>;
  invoked_by?: 'api' | 'repository_dispatch' | 'manual';
  fired_from?: string;
};

export type AgentBinding = {
  skill: string;
  executor?: string;
  trigger: AgentBindingTrigger;
  routine_spec?: string;
  workflow?: string;
  /** Project whose credential bag is injected at fire time. */
  project_id?: string;
  config?: Record<string, unknown>;
  note?: string;
  /** ISO 8601 instant this binding was first created (issue 574). Absent on
   *  bindings created before this field existed — treat as "age unknown",
   *  never as "just bound". */
  bound_at?: string;
};

/**
 * Persona JD — Mission / Key Responsibilities / Success Measures.
 * Authored in agent.json. Not a job post; a structured attribute block
 * the profile page renders for orientation.
 */
export interface AgentJD {
  /** One-sentence statement of why this role exists on the workforce. */
  mission: string;
  /** 4-6 verb-led responsibility statements. */
  key_responsibilities: string[];
  /** 3-5 measurable outcomes that prove the role is working. */
  success_measures: string[];
}

/**
 * OpenClaw-style IDENTITY block. Complements JD: JD is what the role
 * does; IDENTITY is who the persona is when they do it.
 */
export interface AgentIdentity {
  /** 3-5 word label, e.g. "Systems-first designer". */
  archetype: string;
  /** 3-5 short operating principles. */
  operating_principles: string[];
  /** One sentence on voice / tone / register. */
  voice: string;
  /** 2-4 hard refusals — things this persona will not do. */
  guardrails: string[];
}

/**
 * Persona long-term memory — the semantic MEMORY.md layer (ADR-0019).
 *
 * This is the **durable, curated** layer the persona re-reads at every
 * fire (agent-runner composition layer 3.5): a plain-markdown document
 * distilling what the agent has *learned* — mission anchor, generalised
 * principles, people-context, standing bets — at the meaning level, not
 * the work level. It is NOT an activity record — the Task Log
 * (recent_runs) and the ACTIVITY ledger cover what the agent has *done*,
 * and the S3 rolling chunks (Epic-012) hold the episodic run narrative.
 *
 * Empty / absent `body` is a valid state — a brand-new agent has no
 * memory yet. Seeding invented content is not permitted because the body
 * feeds back into the agent's execution as system context; curation
 * rules live in workforce/seed/memory/README.md.
 *
 * (The pre-ADR-0019 shape was a structured `entries[]` deck; it never
 * carried data and was superseded before first write.)
 */
export interface AgentMemory {
  /** ISO date of the latest curation. */
  last_updated: string;
  /** The MEMORY.md document — plain markdown, semantic level. */
  body?: string;
}

export interface WorkforceAgent {
  slug: string;
  first_name: string;
  last_name: string;
  residence: string;
  role: string;
  model: string;
  prompt_version: string;
  budget_monthly_usd: number;
  default_project: string;
  streams: Array<'internal' | 'client' | 'editorial'>;
  bindings: AgentBinding[];
  created_at: string;
  /** First non-heading, non-framing paragraph from system.md. */
  about: string;
  jd?: AgentJD;
  identity?: AgentIdentity;
  memory?: AgentMemory;
  // ----- Org topology, merged from workforce/agents/_org.json by the build
  // script. `depth` is derived: 0 for nodes with no reports_to (roots),
  // 1 + min(parent depth) otherwise. There is no hard ceiling on N — a
  // 4-deep org renders the same way a 3-deep one does.
  depth: number;
  reports_to: string[];
  direct_reports: string[];
  lateral: string[];
}

export interface WorkforceAgentManifest {
  generated_at: string;
  agents: WorkforceAgent[];
}
