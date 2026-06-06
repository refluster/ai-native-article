// Workforce skill manifest types — what the build script emits and the
// SPA consumes from /workforce-skills.json.

export type SkillStatus = 'active' | 'stale' | 'deprecated';
export type CostClass = 'small' | 'medium' | 'large';
export type DeliverableType = 'article' | 'plan' | 'design-doc' | 'launch-plan' | 'pr' | 'notification';

export interface SkillDeliverable {
  type: DeliverableType;
  publish_notion: boolean;
}

export type SkillFileLanguage =
  | 'markdown'
  | 'json'
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'shell'
  | 'yaml'
  | 'text';

export interface SkillFile {
  /** Repo-relative path inside the skill dir, e.g. "SKILL.md" or "examples/x.md". */
  path: string;
  size: number;
  language: SkillFileLanguage;
  /** UTF-8 text; null when the file is binary or exceeds the manifest cap. */
  contents: string | null;
  truncated: boolean;
  binary: boolean;
}

export interface WorkforceSkill {
  name: string;
  version: string;
  status: SkillStatus;
  /** Optional published-artefact declaration; null when the skill publishes none. */
  deliverable: SkillDeliverable | null;
  cost_class: CostClass;
  owners: string[];
  improvement_agent: string | null;
  created_at: string;
  /** First-paragraph description from SKILL.md frontmatter. */
  description: string;
  /** Source files in workforce/skills/{name}/ — SKILL.md first, then alpha. */
  files: SkillFile[];
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
  deliverable: SkillDeliverable | null;
  cost_class: CostClass;
  owners: string[];
  improvement_agent: string | null;
  improvement_agent_override?: string | null;
  created_at: string;
  invocations_this_month: number;
  last_invoked_at?: string;
}
