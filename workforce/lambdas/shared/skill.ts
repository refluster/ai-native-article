// Skill loading + selection + system-prompt composition.
//
// RFC-008 establishes the Skill as the workforce's execution unit.
// At runtime: agent-runner loads the agent's assigned skills from
// the Lambda bundle, picks one based on the task_kind, and composes
// its body onto the system.md to form the LLM system prompt.
//
// One Skill per run at v1; multi-Skill composition is v2.

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { TaskKind } from "./task.js";

export type SkillStatus = "active" | "stale" | "deprecated";
export type SkillTriggerClass = "lambda" | "claude-code-routine";
export type SkillCostClass = "small" | "medium" | "large";

/** Anthropic Agent Skills spec frontmatter — name + description only. */
export interface SkillFrontmatter {
  name: string;
  description: string;
}

/** Workforce sidecar (meta.json). Mirror of validate-skills.mjs / schema. */
export interface SkillMeta {
  name: string;
  version: string;
  status: SkillStatus;
  trigger_class: SkillTriggerClass;
  cost_class: SkillCostClass;
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

/**
 * Load a skill by name from the Lambda bundle. The runner Makefile copies
 * workforce/skills/ next to handler.mjs at build time.
 *
 * @param bundleRoot overrides the default bundle root (handler.mjs's dirname).
 *                   Tests and local invocations pass a workforce/-relative path.
 */
export async function loadSkill(name: string, bundleRoot?: string): Promise<LoadedSkill> {
  const root = bundleRoot ?? defaultBundleRoot();
  const dir = join(root, "skills", name);
  const skillMd = await readFile(join(dir, "SKILL.md"), "utf8");
  const meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8")) as SkillMeta;
  const { frontmatter, body } = splitFrontmatter(skillMd);
  if (frontmatter.name !== meta.name) {
    throw new Error(`skill "${name}": frontmatter.name="${frontmatter.name}" disagrees with meta.name="${meta.name}"`);
  }
  return { frontmatter, meta, body };
}

/**
 * Load every skill in `skillNames` (typically `agent.skills` from agent.json).
 * Filters to status=active and verifies the agent slug is listed in owners.
 * Skips (with WARN) any skill that fails to load — the run continues so a
 * misconfigured skill doesn't break the whole agent.
 */
export async function loadActiveSkillsForAgent(
  agentSlug: string,
  skillNames: readonly string[],
  bundleRoot?: string,
): Promise<LoadedSkill[]> {
  const out: LoadedSkill[] = [];
  for (const name of skillNames) {
    let skill: LoadedSkill;
    try {
      skill = await loadSkill(name, bundleRoot);
    } catch (err) {
      console.warn(`loadActiveSkillsForAgent(${agentSlug}): skipping "${name}": ${(err as Error).message}`);
      continue;
    }
    if (skill.meta.status !== "active") continue;
    if (!skill.meta.owners.includes(agentSlug)) {
      console.warn(`loadActiveSkillsForAgent(${agentSlug}): skill "${name}" owners=${JSON.stringify(skill.meta.owners)} does not include this agent`);
      continue;
    }
    out.push(skill);
  }
  return out;
}

/**
 * Pick one Skill for a given task_kind. v1 uses a hard-coded mapping
 * from task_kind to a required output symbol; the first matching active
 * Skill (in declaration order) wins. Returns undefined when no Skill
 * matches — the caller falls back to a default brief with a WARN log.
 *
 * TODO(RFC-008 Q2): replace this table with a planner-style picker once
 * N_skills > ~20.
 */
export function pickSkillForTask(
  taskKind: TaskKind,
  skills: readonly LoadedSkill[],
): LoadedSkill | undefined {
  const requiredOutput = REQUIRED_OUTPUT_BY_TASK_KIND[taskKind];
  if (!requiredOutput) return undefined;
  return skills.find((s) => s.meta.outputs.includes(requiredOutput));
}

const REQUIRED_OUTPUT_BY_TASK_KIND: Partial<Record<TaskKind, string>> = {
  "l0-to-l1": "article-markdown",
  "weekly-synthesis": "article-markdown",
  "hypothesis": "plan-markdown",
  "design": "design-note-markdown",
  "launch": "launch-plan-markdown",
  "pr": "task-brief-markdown",
  // "tech-note" intentionally has no mapping at v1 — agents fall back to
  // the generic brief until a matching Skill exists.
};

/**
 * Compose the active Skill body onto the agent's system.md to form
 * the system prompt sent to the LLM. Returns the unmodified base when
 * no Skill was selected.
 */
export function composeSystemPrompt(baseSystemMd: string, skill: LoadedSkill | undefined): string {
  if (!skill) return baseSystemMd;
  return `${baseSystemMd}\n\n---\n\n## Active skill: ${skill.meta.name} (v${skill.meta.version})\n\n${skill.body.trim()}\n`;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function defaultBundleRoot(): string {
  // Same pattern as loadSystemMd in handler.ts.
  const here = dirname(fileURLToPath(import.meta.url));
  return here;
}

function splitFrontmatter(skillMd: string): { frontmatter: SkillFrontmatter; body: string } {
  const m = skillMd.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!m) {
    throw new Error("SKILL.md missing leading YAML frontmatter");
  }
  const fm = parseSimpleYaml(m[1]!);
  if (typeof fm.name !== "string" || typeof fm.description !== "string") {
    throw new Error("SKILL.md frontmatter missing name/description");
  }
  return { frontmatter: { name: fm.name, description: fm.description }, body: m[2]! };
}

function parseSimpleYaml(yaml: string): Record<string, string> {
  // Mirror of workforce/scripts/validate-skills.mjs:parseSimpleYaml.
  // SKILL.md frontmatter is always two scalar keys (name, description).
  const out: Record<string, string> = {};
  for (const line of yaml.split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    let value = m[2] ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[m[1]!] = value;
  }
  return out;
}
