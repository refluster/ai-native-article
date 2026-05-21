// Workforce skill manifest types — what the build script emits and the
// SPA consumes from /workforce-skills.json. Shape mirrors the live
// agents-api `GET /skills/{name}` response where the fields overlap;
// the static manifest additionally carries the SKILL.md `description`
// frontmatter line so the SPA can render explanatory copy without a
// round-trip to the API.

export type SkillStatus = 'active' | 'deprecated' | 'paused';
export type TriggerClass = 'lambda' | 'claude-code-routine-on-gha';
export type CostClass = 'low' | 'medium' | 'high';

export interface WorkforceSkill {
  name: string;
  version: string;
  status: SkillStatus;
  trigger_class: TriggerClass;
  cost_class: CostClass;
  owners: string[];
  improvement_agent: string | null;
  inputs: string[];
  outputs: string[];
  created_at: string;
  deprecated_replacement: string | null;
  /** First-paragraph description from SKILL.md frontmatter. */
  description: string;
}

export interface WorkforceSkillManifest {
  generated_at: string;
  skills: WorkforceSkill[];
}

/** Subset returned by the live agents-api (no description). */
export interface SkillLiveRecord {
  name: string;
  version: string;
  status: SkillStatus;
  trigger_class: TriggerClass;
  cost_class: CostClass;
  owners: string[];
  improvement_agent: string | null;
  improvement_agent_override?: string | null;
  inputs: string[];
  outputs: string[];
  created_at: string;
  deprecated_replacement: string | null;
  invocations_this_month: number;
  last_invoked_at?: string;
}
