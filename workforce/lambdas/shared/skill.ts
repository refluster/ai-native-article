// Skill repository loader for the agent-runner.
//
// RFC-008: Skills live under workforce/skills/{name}/ with SKILL.md +
// meta.json. The runner's Makefile bundles the tree alongside agents/
// (same pattern as seed-agents). At runtime this module reads them
// off the Lambda's filesystem.
//
// v1 selection rule is hard-coded: a task_kind maps to a required
// output, and the first matching active skill among the agent's
// `skills` list wins. Replace with a planner in v2 (RFC-008 Q2).

import type { AgentMetaRow } from "./agent.js";
import type { TaskKind } from "./task.js";

export interface SkillFrontmatter {
  name: string;
  description: string;
}

export interface SkillMeta {
  name: string;
  version: string;
  status: "active" | "stale" | "deprecated";
  trigger_class: "lambda" | "claude-code-routine" | "webhook";
  cost_class: "small" | "medium" | "large";
  owners: string[];
  improvement_agent: string | null;
  inputs: string[];
  outputs: string[];
  created_at: string;
  deprecated_replacement: string | null;
}

export interface LoadedSkill {
  frontmatter: SkillFrontmatter;
  meta: SkillMeta;
  body: string;
}

// task_kind -> required outputs in meta.json:outputs.
// Hard-coded mapping (RFC-008 Q2 — planner deferred to v2).
//
// Values must exactly match a `meta.json:outputs` token on at least one
// skill. The aliases are deliberately distinct between L1 (`article-markdown`,
// from article-draft) and weekly synthesis (`synthesis-article-markdown`,
// from market-research) so pickSkillForTask doesn't conflate them for an
// agent who owns both.
const TASK_REQUIRED_OUTPUTS: Record<TaskKind, string[]> = {
  "l0-to-l1": ["article-markdown"],
  "weekly-synthesis": ["synthesis-article-markdown"],
  hypothesis: ["plan-markdown"],
  "tech-note": ["article-markdown"],
  design: ["design-note-markdown"],
  launch: ["launch-plan-markdown"],
  pr: ["task-brief-markdown"],
  ping: ["discord-notification"],
};

export async function loadSkill(name: string): Promise<LoadedSkill> {
  const { readFile } = await import("node:fs/promises");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  const skillDir = join(here, "skills", name);

  const raw = await readFile(join(skillDir, "SKILL.md"), "utf8");
  const { frontmatter, body } = splitFrontmatter(raw);
  const meta = JSON.parse(
    await readFile(join(skillDir, "meta.json"), "utf8"),
  ) as SkillMeta;

  return { frontmatter, meta, body };
}

export async function loadSkillsForAgent(agent: AgentMetaRow): Promise<LoadedSkill[]> {
  const results: LoadedSkill[] = [];
  for (const name of agent.skills) {
    try {
      results.push(await loadSkill(name));
    } catch {
      // RFC-008 rollout: not every named skill is ported yet. Silently
      // skip missing skills; the validator's R8-skills-exist warning
      // is the audit signal, not a runtime error.
    }
  }
  return results;
}

/**
 * Pick the first active skill whose outputs intersect the task's required
 * outputs. Returns undefined if no skill matches — caller falls back to
 * defaultBriefFor.
 */
export function pickSkillForTask(
  taskKind: TaskKind,
  skills: LoadedSkill[],
): LoadedSkill | undefined {
  const required = TASK_REQUIRED_OUTPUTS[taskKind];
  if (!required) return undefined;
  return skills.find(
    (s) =>
      s.meta.status === "active" &&
      s.meta.outputs.some((o) => required.includes(o)),
  );
}

/**
 * Compose the agent's system.md with the active skill's body under a
 * clearly delimited heading (RFC-008). One skill per run; multi-skill
 * composition is a v2 concern.
 */
export function composeSystemPrompt(baseSystemMd: string, skill: LoadedSkill): string {
  return `${baseSystemMd}\n\n---\n\n## Active skill: ${skill.meta.name} (v${skill.meta.version})\n\n${skill.body}`;
}

function splitFrontmatter(raw: string): { frontmatter: SkillFrontmatter; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) throw new Error("SKILL.md must begin with --- YAML frontmatter ---");
  const fm: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    fm[key] = value;
  }
  if (typeof fm.name !== "string" || typeof fm.description !== "string") {
    throw new Error("SKILL.md frontmatter must contain name + description");
  }
  return {
    frontmatter: { name: fm.name, description: fm.description },
    body: m[2]!.trim(),
  };
}
