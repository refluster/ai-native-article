// Workforce agent manifest types — what the build script emits and the
// SPA consumes from /workforce-agents.json.

export type AgentTier = 'founder' | 'lead' | 'ic';

export interface WorkforceAgent {
  slug: string;
  first_name: string;
  last_name: string;
  residence: string;
  role: string;
  model: string;
  schedule_cron: string;
  schedule_note: string;
  prompt_version: string;
  budget_monthly_usd: number;
  skills: string[];
  default_project: string;
  streams: Array<'internal' | 'client' | 'editorial'>;
  primary_deliverable_type: 'article' | 'pr' | 'plan' | 'design-doc' | 'launch-plan';
  primary_deliverable_kind: string;
  code_execution: 'lambda' | 'claude-code-routine-on-gha' | null;
  created_at: string;
  /** First non-heading, non-framing paragraph from system.md. */
  about: string;
  // ----- Org topology, merged from workforce/agents/_org.json by the build
  // script. These are present on every record; if _org.json has no entry
  // for the slug, tier defaults to 'ic' and the edge arrays are empty.
  tier: AgentTier;
  reports_to: string[];
  /** Inverse of reports_to: slugs whose reports_to includes this agent. */
  direct_reports: string[];
  lateral: string[];
}

export interface WorkforceAgentManifest {
  generated_at: string;
  agents: WorkforceAgent[];
}
