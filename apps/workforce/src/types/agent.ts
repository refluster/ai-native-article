// Workforce agent manifest types — what the build script emits and the
// SPA consumes from /workforce-agents.json.

export type AgentTier = 'founder' | 'lead' | 'ic';

/** One cron-to-skill pairing on an agent. */
export interface AgentBinding {
  cron: string;
  skill: string;
  note?: string;
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
  // ----- Org topology, merged from workforce/agents/_org.json by the build
  // script.
  tier: AgentTier;
  reports_to: string[];
  direct_reports: string[];
  lateral: string[];
}

export interface WorkforceAgentManifest {
  generated_at: string;
  agents: WorkforceAgent[];
}
