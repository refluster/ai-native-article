// Workforce skill manifest types — what the build script emits and the
// SPA consumes from /workforce-skills.json.

export type SkillStatus = 'active' | 'stale' | 'deprecated' | 'archived';
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
  /** Immutable slug — the identifier bindings/EXEC history reference. */
  name: string;
  /** Human-readable label decoupled from the slug (renameable). */
  display_name?: string | null;
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
  display_name?: string | null;
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

/** One row in `GET /skills/{name}/executions` — the per-skill run ledger
 *  (ADR-0017 observability; same shape as the project ledger rows). */
export interface SkillExecution {
  exec_ulid: string;
  project_id: string;
  agent_slug: string;
  skill_name: string;
  skill_version: string;
  started_at: string;
  ended_at: string;
  status: 'ok' | 'throw' | 'skipped' | 'failed_artefact_redaction';
  execution_surface?: 'lambda' | 'client' | 'ccr';
  summary?: string;
  artifact_ref?: {
    uri: string;
    content_hash: string;
    content_type: string;
    size_bytes: number;
    summary: string;
  };
  error?: string;
}
