// Skill DDB row + API view types. Mirrors agent.ts for skills.
//
// Identity: name, version, description, body, status, executor,
// deliverable, cost_class, owners, improvement_agent, created_at.
// Operational (DDB-only, PATCH-able in v2): improvement_agent_override.
// Computed (written by future stats aggregator): invocations_this_month,
// last_invoked_at.

import type { SkillMeta } from "./skill.js";

export type SkillStatus = SkillMeta["status"];

export interface SkillIdentity extends SkillMeta {
  /** SKILL.md body (everything after the frontmatter). Bundled into the seed payload. */
  body: string;
  /** SKILL.md frontmatter:description, mirrored here for fast index reads. */
  description: string;
}

export interface SkillOperational {
  /** Override for meta.json:improvement_agent. Null when no override set. */
  improvement_agent_override?: string | null;
}

export interface SkillComputed {
  invocations_this_month: number;
  last_invoked_at?: string;
}

export interface SkillMetaRow
  extends SkillIdentity,
    SkillOperational,
    SkillComputed {
  pk: `SKILL#${string}`;
  sk: "META";
  identity_hash: string;
  updated_at: string;
}

export interface SkillApiView extends SkillIdentity, SkillOperational, SkillComputed {
  /** Convenience: meta.improvement_agent if no override, else the override. */
  improvement_agent_effective: string | null;
}

export function toSkillApiView(row: SkillMetaRow): SkillApiView {
  return {
    ...row,
    improvement_agent_effective:
      row.improvement_agent_override !== undefined
        ? row.improvement_agent_override
        : row.improvement_agent,
  };
}

export function skillPk(name: string): `SKILL#${string}` {
  return `SKILL#${name}`;
}
