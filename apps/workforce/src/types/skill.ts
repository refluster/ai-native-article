// Workforce skill manifest types — what the build script emits and the
// SPA consumes from /workforce-skills.json.

export type SkillStatus = 'active' | 'stale' | 'deprecated';
export type SkillExecutor = 'llm-prose' | 'claude-code-routine' | 'deterministic';
export type CostClass = 'small' | 'medium' | 'large';
export type DeliverableType = 'article' | 'plan' | 'design-doc' | 'launch-plan' | 'pr' | 'notification';

export interface SkillDeliverable {
  type: DeliverableType;
  publish_notion: boolean;
}

export interface WorkforceSkill {
  name: string;
  version: string;
  status: SkillStatus;
  executor: SkillExecutor;
  /** Present only when executor === "llm-prose". */
  deliverable: SkillDeliverable | null;
  cost_class: CostClass;
  owners: string[];
  improvement_agent: string | null;
  created_at: string;
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
  executor: SkillExecutor;
  deliverable: SkillDeliverable | null;
  cost_class: CostClass;
  owners: string[];
  improvement_agent: string | null;
  improvement_agent_override?: string | null;
  created_at: string;
  invocations_this_month: number;
  last_invoked_at?: string;
}
