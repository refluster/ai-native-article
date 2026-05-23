// Workforce agent manifest types — what the build script emits and the
// SPA consumes from /workforce-agents.json.

export type AgentBinding = {
  cron: string;
  skill: string;
  note?: string;
};

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
