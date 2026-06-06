// Skill repository loader for the agent-runner.
//
// v1 1-stage routing: an agent's binding names a skill directly; the
// runner loads that skill and dispatches based on its `executor`:
//   - llm-prose            LLM generates an artefact body. The skill's
//                          `deliverable` field declares S3 key + Notion
//                          publish flag.
//   - claude-code-routine  LLM generates a brief, runner dispatches GHA
//                          workflow_dispatch and writes a pending DELIV.
//   - deterministic        Runner runs a registered handler keyed by
//                          skill name. No LLM call. The handler returns
//                          the output bytes; the runner persists them.
//
// SKILL.md is documentation for human + Claude-Code readers. Only the
// llm-prose executor injects the body into a prompt at runtime.

export type SkillExecutor = "llm-prose" | "claude-code-routine" | "deterministic";

export type DeliverableType =
  | "article"
  | "plan"
  | "design-doc"
  | "launch-plan"
  | "pr"
  | "notification"
  // Phase 7 PR6: opens a Pull Request against an external project's
  // target repo per R-N9. The mechanical enforcement is the enum
  // itself — `external-commit` deliberately doesn't exist, so a skill
  // CAN'T declare "I will push directly to the external repo's
  // default branch". Adding `external-commit` is a Zone A amendment
  // that must explain why W-5 (agents never gate merges) doesn't
  // extend outward to external maintainers. See workforce/lambdas/
  // shared/external-pr.ts for the helper that opens the PR.
  | "external-pr";

export interface SkillFrontmatter {
  name: string;
  description: string;
}

/** Output target declared by llm-prose skills. Other executors leave this undefined. */
export interface SkillDeliverable {
  type: DeliverableType;
  /** True when the runner must also call insertArticle() after writing S3. */
  publish_notion: boolean;
  /**
   * Optional. For article deliverables, the Notion `Type` select
   * (explanation | analysis) the article-publish path writes — read by a
   * skill's bundled CCR write script (e.g. article-level2/publish-notion.mjs)
   * so the front-end labels/groups the article correctly. Omitted → the
   * reader's resolveType defaults to 'analysis'. Enforced by
   * scripts/validate-skills.mjs + scripts/schemas/skill-meta.schema.json.
   */
  article_type?: "explanation" | "analysis";
}

export interface SkillMeta {
  name: string;
  version: string;
  status: "active" | "stale" | "deprecated";
  executor: SkillExecutor;
  /** Required when executor === "llm-prose"; absent otherwise. */
  deliverable?: SkillDeliverable;
  cost_class: "small" | "medium" | "large";
  owners: string[];
  improvement_agent: string | null;
  created_at: string;
  /** Epic-010 §5: credential keys the skill will receive via ctx.credentials.
   *  Schema allowlist + variant pattern enforced by scripts/validate-skills.mjs
   *  and scripts/schemas/skill-meta.schema.json. Runtime re-check in
   *  shared/credential-injector.ts:injectCredentials. Absent/empty produces a
   *  sealed bag with no readable keys — undeclared access throws. */
  requires?: string[];
  /** Epic-012 Story 1: how many past executions to semantically recall and
   *  inject into the prompt at run time. Omitted → runner default
   *  (RECALL_K_DEFAULT). Set `0` to opt a cheap/deterministic skill out of
   *  the recall packet entirely. Validated by scripts/validate-skills.mjs +
   *  scripts/schemas/skill-meta.schema.json. */
  recall_k?: number;
}

export interface LoadedSkill {
  frontmatter: SkillFrontmatter;
  meta: SkillMeta;
  body: string;
}

/**
 * Load a skill by name from the bundled workforce/skills/ tree.
 * Throws if the skill is missing — the orchestrator should never
 * dispatch a binding pointing at a non-existent skill (the build-time
 * validator catches this).
 */
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

/**
 * Compose the agent's system.md with the active skill's body under a
 * clearly delimited heading. Only used by the llm-prose executor.
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
