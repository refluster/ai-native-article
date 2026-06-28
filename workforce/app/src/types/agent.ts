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
 * The semantic class of a long-term memory entry. Constrained to kinds
 * that survive across sessions — durable facts about the world, standing
 * decisions the persona has committed to, preferences that emerged, and
 * people / context the persona has learned to work with.
 *
 * Note: `lesson` and `open-question` deliberately excluded. Generalised
 * lessons should be reframed as decisions or facts before they land here;
 * open questions belong in day-to-day notes, not in the durable layer.
 */
export type AgentMemoryKind = 'fact' | 'decision' | 'preference' | 'person';

export interface AgentMemoryEntry {
  /** Short id (8-char ULID-ish) for cross-reference + future amendment. */
  id: string;
  kind: AgentMemoryKind;
  /** Short label, 1–5 words. */
  subject: string;
  /** One or two sentences of detail. Self-contained — the entry must
   *  read correctly at session open with no surrounding context. */
  body: string;
}

/**
 * Persona long-term memory — OpenClaw / Hermes MEMORY.md analogue.
 *
 * This is the **durable, curated** layer the persona "remembers" at
 * session open: facts, standing decisions, preferences, people-context.
 * It is NOT an activity record — the Task Log (recent_runs) and the
 * ACTIVITY ledger already cover what the agent has *done*.
 * Memory is what the agent has *learned*.
 *
 * Entries are append-only by convention; the schema does not carry per-
 * entry timestamps because long-term memory is not chronological. The
 * top-level `last_updated` exists so operators can see when a human or
 * agent last curated this layer.
 *
 * Empty is a valid state — a brand-new agent has no memory yet. Seeding
 * sample entries is not permitted because they would feed back into the
 * agent's execution as system context.
 */
export interface AgentMemory {
  /** ISO date of the latest curation. */
  last_updated: string;
  /** Append-only list of durable memory entries. */
  entries: AgentMemoryEntry[];
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
