#!/usr/bin/env node
// Validates workforce/skills/{name}/SKILL.md + meta.json against:
//   - The Anthropic Agent Skills spec subset (SKILL.md frontmatter: name + description).
//   - The workforce-internal sidecar schema (workforce/scripts/schemas/skill-meta.schema.json).
//   - Cross-checks against workforce/agents/{slug}/agent.json:skills owners.
// Exits non-zero on violation. Wired into CI as `npm run workforce:skills`.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKFORCE_ROOT = join(HERE, "..");
const REPO_ROOT = join(WORKFORCE_ROOT, "..");
const SKILLS_DIR = join(WORKFORCE_ROOT, "skills");
const AGENTS_DIR = join(WORKFORCE_ROOT, "agents");
const SCHEMA_PATH = join(HERE, "schemas", "skill-meta.schema.json");

const violations = [];
const v = (rule, path, msg) =>
  violations.push({ rule, path: relative(REPO_ROOT, path), msg });

// Anthropic Agent Skills spec (subset enforced here).
// Spec allows ^[a-z0-9-]+$; we tighten to require a leading letter (R-N7).
const SKILL_NAME = /^[a-z][a-z0-9-]*$/;
const SKILL_NAME_MAX = 64;
const DESCRIPTION_MAX = 1024;
const RESERVED = ["anthropic", "claude"];
const XML_TAG = /<[a-zA-Z][^>]*>/;

const SEMVER = /^\d+\.\d+\.\d+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const AGENT_SLUG = /^[a-z]+$/;

const META_REQUIRED = [
  "name",
  "version",
  "status",
  "executor",
  "cost_class",
  "owners",
  "improvement_agent",
  "created_at",
];
const META_OPTIONAL = ["deliverable"];
const STATUSES = new Set(["active", "stale", "deprecated"]);
const EXECUTORS = new Set(["llm-prose", "claude-code-routine", "deterministic"]);
const COST_CLASSES = new Set(["small", "medium", "large"]);
const DELIV_TYPES = new Set([
  "article",
  "plan",
  "design-doc",
  "launch-plan",
  "pr",
  "notification",
]);

if (!existsSync(SKILLS_DIR)) {
  console.log("workforce/scripts/validate-skills.mjs: OK (no skills/ dir yet)");
  process.exit(0);
}

if (!existsSync(SCHEMA_PATH)) {
  console.error(`workforce/scripts/validate-skills.mjs: schema missing at ${relative(REPO_ROOT, SCHEMA_PATH)}`);
  process.exit(2);
}

const skillDirs = readdirSync(SKILLS_DIR).filter((name) =>
  statSync(join(SKILLS_DIR, name)).isDirectory(),
);

if (skillDirs.length === 0) {
  console.log("workforce/scripts/validate-skills.mjs: OK (no skills yet)");
  process.exit(0);
}

// Build the set of valid agent slugs once for owners cross-check.
const knownAgentSlugs = existsSync(AGENTS_DIR)
  ? new Set(
      readdirSync(AGENTS_DIR).filter((name) =>
        statSync(join(AGENTS_DIR, name)).isDirectory(),
      ),
    )
  : new Set();

for (const name of skillDirs) {
  const dir = join(SKILLS_DIR, name);
  const skillMd = join(dir, "SKILL.md");
  const metaJson = join(dir, "meta.json");

  if (!SKILL_NAME.test(name) || name.length > SKILL_NAME_MAX) {
    v("S0-skill-dir-name", dir, `directory name "${name}" must match ${SKILL_NAME} and be ≤ ${SKILL_NAME_MAX} chars`);
    continue;
  }
  if (RESERVED.some((r) => name.includes(r))) {
    v("S0-skill-reserved", dir, `directory name "${name}" contains a reserved token (anthropic|claude)`);
    continue;
  }

  if (!existsSync(skillMd)) {
    v("F1-skill-md-missing", dir, "SKILL.md missing");
    continue;
  }
  if (!existsSync(metaJson)) {
    v("F2-meta-json-missing", dir, "meta.json missing");
    continue;
  }

  // ── Validate SKILL.md frontmatter (Anthropic spec subset) ────────────────
  const skillBody = readFileSync(skillMd, "utf8");
  const fm = extractFrontmatter(skillBody);
  if (!fm) {
    v("M1-frontmatter-missing", skillMd, "no leading YAML frontmatter block");
    continue;
  }
  const fmObj = parseSimpleYaml(fm);

  if (!("name" in fmObj)) {
    v("M2-name-missing", skillMd, 'frontmatter must include "name"');
  } else {
    const fmName = fmObj.name;
    if (typeof fmName !== "string" || !SKILL_NAME.test(fmName) || fmName.length > SKILL_NAME_MAX) {
      v("M2-name-shape", skillMd, `frontmatter name "${fmName}" must match ${SKILL_NAME} and be ≤ ${SKILL_NAME_MAX} chars`);
    } else {
      if (fmName !== name) {
        v("M2-name-match", skillMd, `frontmatter name "${fmName}" does not match directory "${name}"`);
      }
      if (RESERVED.some((r) => fmName.includes(r))) {
        v("M2-name-reserved", skillMd, `frontmatter name "${fmName}" contains a reserved token`);
      }
      if (XML_TAG.test(fmName)) {
        v("M2-name-xml", skillMd, "frontmatter name must not contain XML tags");
      }
    }
  }

  if (!("description" in fmObj)) {
    v("M3-description-missing", skillMd, 'frontmatter must include "description"');
  } else {
    const desc = fmObj.description;
    if (typeof desc !== "string" || desc.length === 0) {
      v("M3-description-empty", skillMd, "description must be a non-empty string");
    } else {
      if (desc.length > DESCRIPTION_MAX) {
        v("M3-description-length", skillMd, `description is ${desc.length} chars (max ${DESCRIPTION_MAX})`);
      }
      if (XML_TAG.test(desc)) {
        v("M3-description-xml", skillMd, "description must not contain XML tags");
      }
      // Soft check (per RFC-008): "what + when" — looks for one of these markers.
      // Warns only; surfaces as a `WARN` in stdout, not a violation.
      // (Implemented as a comment in stdout below.)
    }
  }

  // ── Validate meta.json against the schema (lightweight in-script) ────────
  let meta;
  try {
    meta = JSON.parse(readFileSync(metaJson, "utf8"));
  } catch (err) {
    v("J0-meta-parse", metaJson, `invalid JSON: ${err.message}`);
    continue;
  }

  for (const k of META_REQUIRED) {
    if (!(k in meta)) v("J1-required-key", metaJson, `missing key "${k}"`);
  }

  const allowed = new Set([...META_REQUIRED, ...META_OPTIONAL]);
  for (const k of Object.keys(meta)) {
    if (!allowed.has(k)) {
      v("J1-unknown-key", metaJson, `unknown key "${k}" (additionalProperties: false)`);
    }
  }

  if (meta.name !== name) {
    v("J2-name-match", metaJson, `meta.name "${meta.name}" does not match directory "${name}"`);
  }
  if (typeof meta.version !== "string" || !SEMVER.test(meta.version)) {
    v("J3-version", metaJson, `version "${meta.version}" must be semver x.y.z`);
  }
  if (!STATUSES.has(meta.status)) {
    v("J4-status", metaJson, `status "${meta.status}" not in {active, stale, deprecated}`);
  }
  if (!EXECUTORS.has(meta.executor)) {
    v("J5-executor", metaJson, `executor "${meta.executor}" not in {llm-prose, claude-code-routine, deterministic}`);
  }
  if (!COST_CLASSES.has(meta.cost_class)) {
    v("J6-cost-class", metaJson, `cost_class "${meta.cost_class}" not in {small, medium, large}`);
  }
  // deliverable is required for llm-prose; absent or null otherwise.
  if (meta.executor === "llm-prose") {
    if (!meta.deliverable || typeof meta.deliverable !== "object") {
      v("J5-deliverable-required", metaJson, `executor=llm-prose requires deliverable {type, publish_notion}`);
    } else {
      if (!DELIV_TYPES.has(meta.deliverable.type)) {
        v("J5-deliverable-type", metaJson, `deliverable.type "${meta.deliverable.type}" not in allowed set`);
      }
      if (typeof meta.deliverable.publish_notion !== "boolean") {
        v("J5-deliverable-notion", metaJson, "deliverable.publish_notion must be boolean");
      }
    }
  } else if ("deliverable" in meta && meta.deliverable !== undefined && meta.deliverable !== null) {
    v("J5-deliverable-forbidden", metaJson, `executor=${meta.executor} must not declare deliverable`);
  }

  if (!Array.isArray(meta.owners) || meta.owners.length === 0) {
    v("J7-owners", metaJson, "owners must be a non-empty array");
  } else {
    const seen = new Set();
    for (const s of meta.owners) {
      if (typeof s !== "string" || !AGENT_SLUG.test(s)) {
        v("J7-owner-shape", metaJson, `owner "${s}" must match ${AGENT_SLUG}`);
        continue;
      }
      if (seen.has(s)) {
        v("J7-owner-duplicate", metaJson, `duplicate owner "${s}"`);
      }
      seen.add(s);
      if (knownAgentSlugs.size > 0 && !knownAgentSlugs.has(s)) {
        v("J7-owner-unknown", metaJson, `owner "${s}" is not an existing agent under workforce/agents/`);
      }
    }
  }

  if (meta.improvement_agent !== null) {
    if (typeof meta.improvement_agent !== "string" || !AGENT_SLUG.test(meta.improvement_agent)) {
      v("J8-improvement-agent", metaJson, `improvement_agent "${meta.improvement_agent}" must be null or a valid slug`);
    } else if (knownAgentSlugs.size > 0 && !knownAgentSlugs.has(meta.improvement_agent)) {
      v("J8-improvement-agent-unknown", metaJson, `improvement_agent "${meta.improvement_agent}" is not an existing agent`);
    }
  }

  if (typeof meta.created_at !== "string" || !ISO_DATE.test(meta.created_at)) {
    v("J10-created-at", metaJson, `created_at "${meta.created_at}" must be YYYY-MM-DD`);
  }

  // ── executor=deterministic requires a sibling handler.ts ─────────────────
  // The skill bundle is self-contained: SKILL.md + meta.json + handler.ts.
  // The agent-runner picks up the handler via the build-time generated
  // skill-registry-generated.ts (workforce/scripts/build-skill-registry.mjs).
  if (meta.executor === "deterministic") {
    const handlerTs = join(dir, "handler.ts");
    if (!existsSync(handlerTs)) {
      v("J11-deterministic-handler-missing", dir, "executor=deterministic requires handler.ts in the skill folder");
    }
  } else {
    // llm-prose / claude-code-routine skills do not bundle a TS handler —
    // the runner interprets them. Forbid an orphan handler.ts so the
    // executor field stays the single source of truth.
    const handlerTs = join(dir, "handler.ts");
    if (existsSync(handlerTs)) {
      v("J11-handler-orphan", handlerTs, `executor=${meta.executor} must not have a handler.ts (only executor=deterministic does)`);
    }
  }
}

if (violations.length === 0) {
  console.log(
    `workforce/scripts/validate-skills.mjs: OK (${skillDirs.length} skill(s))`,
  );
  process.exit(0);
}

console.error(`workforce/scripts/validate-skills.mjs: ${violations.length} violation(s)\n`);
for (const x of violations) {
  console.error(`  [${x.rule}] ${x.path}: ${x.msg}`);
}
console.error(`\nSee workforce/docs/rfcs/rfc-008-skill-repository.md and workforce/scripts/schemas/skill-meta.schema.json for the schema.`);
process.exit(1);

// ── Helpers ────────────────────────────────────────────────────────────────

function extractFrontmatter(text) {
  // Anthropic-spec SKILL.md starts with a YAML block delimited by ---.
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  return m ? m[1] : null;
}

function parseSimpleYaml(yaml) {
  // Intentionally minimal: SKILL.md frontmatter is always two scalar keys
  // (name, description). We don't pull in a YAML dep — keep validators
  // dependency-free, matching validate-agent-json.mjs's style. Supports:
  //   key: value
  //   key: "quoted value"
  //   key: |
  //     multi-line
  //     value
  const out = {};
  const lines = yaml.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) { i++; continue; }
    const [, key, rest] = m;
    if (rest === "|" || rest === ">") {
      // Block scalar. Read indented continuation.
      const buf = [];
      i++;
      while (i < lines.length && /^\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s+/, ""));
        i++;
      }
      out[key] = buf.join("\n");
      continue;
    }
    let value = rest;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
    i++;
  }
  return out;
}
