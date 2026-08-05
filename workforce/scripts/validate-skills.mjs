#!/usr/bin/env node
// Validates workforce/skills/{name}/SKILL.md + meta.json against:
//   - The Anthropic Agent Skills spec subset (SKILL.md frontmatter: name + description).
//   - The workforce-internal sidecar schema (workforce/scripts/schemas/skill-meta.schema.json).
//   - Cross-checks against workforce/agents/{slug}/agent.json:skills owners.
// Exits non-zero on violation. Wired into CI as `npm run workforce:skills`.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
// Epic-019 Story 2c: the flake-allowlist validator is single-sourced from the
// skill module that consumes it at runtime (same twin pattern as
// escalation-reasons.mjs ↔ pr-escalation-reasons.md).
import { validateFlakyChecks } from "../skills/pr-autopilot/flaky-rerun.mjs";

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
  "cost_class",
  "owners",
  "improvement_agent",
  "created_at",
];
const META_OPTIONAL = ["deliverable", "requires", "archetype", "display_name", "recall_k", "commons"];
const STATUSES = new Set(["active", "stale", "deprecated", "archived"]);
// Named skill archetypes (固有名詞). A skill MAY declare one; when it does,
// the C-* rules below enforce that archetype's structural shape so a
// mis-built instance turns CI red (W-4 fail-loud) instead of half-working.
// "cadence": EventBridge → orchestrator-tick → the generic CCR routine,
// (agent × skill × project) context, deterministic write-script → authed
// endpoint with a project-scoped credential. feed-post is instance #1;
// new ones are scaffolded by .claude/skills/cadence-forge.
const ARCHETYPES = new Set(["cadence"]);
const COST_CLASSES = new Set(["small", "medium", "large"]);
const DELIV_TYPES = new Set([
  "article",
  "plan",
  "design-doc",
  "launch-plan",
  "pr",
  "notification",
  "external-pr",
  // R-N10 (Zone A, 2026-06-16): the one delegated-merge marker. Mirrors the
  // skill-meta schema enum + skill.ts:DeliverableType.
  "external-pr-merge",
]);
// Notion `Type` select values the front-end article pipeline distinguishes.
// Mirrors ArticleType in newsletter/app/src/types/article.ts.
const ARTICLE_TYPES = new Set(["explanation", "analysis"]);
// Mirror of CREDENTIAL_TYPES in workforce/lambdas/shared/credential-injector.ts.
// To extend: add the type here AND register its shape in CredentialShapes
// in the injector module (see the injector file header for all 5 mirror points).
// Skill meta requires[] is checked against this set, modulo the variant
// suffix (`type@name`) per Epic-010 §Q2.
const CREDENTIAL_TYPES = new Set([
  "anthropic.api_key",
  "discord.bot_token",
  "discord.webhook_url",
  "github.token",
  "notion.integration_token",
  "voyage.api_key",
  "workforce.feed_write_token",
  "workforce.memory_write_token",
]);
// Variant naming convention (Epic-010 §Q2): starts with a letter, then
// kebab/snake-case. Empty variants (`type@`) are rejected explicitly.
const CREDENTIAL_VARIANT = /^[a-z][a-z0-9_-]*$/;
// Bound on per-invocation Promise.all fan-out — must equal the JSON
// schema's maxItems on requires[] (Dario A2).
const CREDENTIAL_REQUIRES_MAX = 8;

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
      // Soft check (per Epic-008): "what + when" — looks for one of these markers.
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
  if (meta.display_name !== undefined) {
    if (typeof meta.display_name !== "string" || meta.display_name.trim().length === 0 || meta.display_name.length > 120) {
      v("N1-display-name", metaJson, `display_name must be a 1..120 char string`);
    }
  }
  // Epic-021 §B.1 — the commons class. Boolean-only: a truthy string would
  // silently widen the class the idle detector discounts, which is exactly the
  // exemption surface the epic's Q3 closed by refusing configurability.
  if (meta.commons !== undefined && typeof meta.commons !== "boolean") {
    // J14, not J8: J8 is already taken by the improvement_agent rules below,
    // and a rule ID is the string an operator greps when CI goes red — two
    // unrelated concerns under one ID makes it ambiguous forever (sana S1).
    v("J14-commons", metaJson, `commons must be a boolean (got ${typeof meta.commons})`);
  }
  if (!STATUSES.has(meta.status)) {
    v("J4-status", metaJson, `status "${meta.status}" not in {active, stale, deprecated, archived}`);
  }
  if (!COST_CLASSES.has(meta.cost_class)) {
    v("J6-cost-class", metaJson, `cost_class "${meta.cost_class}" not in {small, medium, large}`);
  }
  // deliverable is optional (ADR-0005: no skill-shape axis). When present it
  // declares the published-artefact target read by the skill's CCR
  // write-script; its shape is validated regardless of which skill carries it.
  if ("deliverable" in meta && meta.deliverable !== undefined && meta.deliverable !== null) {
    if (typeof meta.deliverable !== "object") {
      v("J5-deliverable-shape", metaJson, "deliverable must be an object {type, publish_notion}");
    } else {
      if (!DELIV_TYPES.has(meta.deliverable.type)) {
        v("J5-deliverable-type", metaJson, `deliverable.type "${meta.deliverable.type}" not in allowed set`);
      }
      if (typeof meta.deliverable.publish_notion !== "boolean") {
        v("J5-deliverable-notion", metaJson, "deliverable.publish_notion must be boolean");
      }
      // article_type (optional): mirrors the JSON schema enum. Sets the
      // Notion `Type` select the article pipeline reads (explanation vs.
      // analysis). Only meaningful for article deliverables.
      const allowedDeliverableKeys = new Set(["type", "publish_notion", "article_type"]);
      for (const k of Object.keys(meta.deliverable)) {
        if (!allowedDeliverableKeys.has(k)) {
          v("J5-deliverable-unknown-key", metaJson, `deliverable has unknown key "${k}" (additionalProperties: false)`);
        }
      }
      if ("article_type" in meta.deliverable) {
        if (!ARTICLE_TYPES.has(meta.deliverable.article_type)) {
          v("J5-deliverable-article-type", metaJson, `deliverable.article_type "${meta.deliverable.article_type}" not in {explanation, analysis}`);
        } else if (meta.deliverable.type !== "article") {
          v("J5-deliverable-article-type-scope", metaJson, `deliverable.article_type is only valid when deliverable.type="article" (got "${meta.deliverable.type}")`);
        }
      }
    }
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

  // ── requires (Story 2-A): credential keys declared by this skill ─────────
  // Each entry is either a base type from CREDENTIAL_TYPES, or a variant
  // suffix `type@name` of one (Epic-010 §Q2 "tolerate @"). Duplicates and
  // over-the-limit arrays are rejected (mirrored from the JSON schema).
  if ("requires" in meta && meta.requires !== undefined) {
    if (!Array.isArray(meta.requires)) {
      v("J12-requires-shape", metaJson, `requires must be an array (got ${typeof meta.requires})`);
    } else {
      if (meta.requires.length > CREDENTIAL_REQUIRES_MAX) {
        v("J12-requires-too-many", metaJson, `requires has ${meta.requires.length} entries; max ${CREDENTIAL_REQUIRES_MAX} (per-invocation fan-out bound)`);
      }
      const seen = new Set();
      for (const entry of meta.requires) {
        if (typeof entry !== "string") {
          v("J12-requires-item-shape", metaJson, `requires[] entry must be a string (got ${typeof entry})`);
          continue;
        }
        const atIdx = entry.indexOf("@");
        const baseType = atIdx === -1 ? entry : entry.slice(0, atIdx);
        const variant = atIdx === -1 ? null : entry.slice(atIdx + 1);
        if (!CREDENTIAL_TYPES.has(baseType)) {
          v("J12-requires-unknown-type", metaJson, `requires[] entry "${entry}" base type "${baseType}" not in CREDENTIAL_TYPES allowlist (extend the set in validate-skills.mjs AND register a shape in credential-injector.ts)`);
        }
        if (variant !== null) {
          if (variant.length === 0) {
            v("J12-requires-variant-empty", metaJson, `requires[] entry "${entry}" has empty variant after "@"`);
          } else if (!CREDENTIAL_VARIANT.test(variant)) {
            v("J12-requires-variant-shape", metaJson, `requires[] entry "${entry}" variant "${variant}" must match ${CREDENTIAL_VARIANT}`);
          }
        }
        if (seen.has(entry)) {
          v("J12-requires-duplicate", metaJson, `duplicate requires[] entry "${entry}"`);
        }
        seen.add(entry);
      }
    }
  }

  // ── archetype (固有名詞) + its structural invariants ──────────────────────
  // `archetype` is optional. When present it must be a known archetype, and
  // its C-* structural rules are enforced so a mis-built instance fails loud
  // (W-4) rather than half-working. Skills with no archetype are unaffected.
  if ("archetype" in meta && meta.archetype !== undefined && meta.archetype !== null) {
    if (typeof meta.archetype !== "string" || !ARCHETYPES.has(meta.archetype)) {
      v("J13-archetype-unknown", metaJson, `archetype "${meta.archetype}" not in {${[...ARCHETYPES].join(", ")}}`);
    } else if (meta.archetype === "cadence") {
      // C-2 — a Cadence writes through a project-scoped credential to an
      // authenticated endpoint; an empty/absent requires[] means it has no
      // capability token, so it can't be the canonical archetype.
      if (!Array.isArray(meta.requires) || meta.requires.length === 0) {
        v("C2-cadence-requires", metaJson, "archetype=cadence requires a non-empty requires[] (the project-scoped write credential its bundled script POSTs with)");
      }
      // C-3 — the write is owned by a bundled deterministic script, not by
      // the LLM hand-editing files. Assert at least one *.mjs ships in the
      // skill folder (the write script, e.g. feed-post/post-feed.mjs).
      const hasWriteScript = readdirSync(dir).some(
        (f) => f.endsWith(".mjs") && statSync(join(dir, f)).isFile(),
      );
      if (!hasWriteScript) {
        v("C3-cadence-write-script", dir, "archetype=cadence requires a bundled deterministic write script (*.mjs) — the LLM produces judgment, the script owns the authenticated write");
      }
    }
  }

  // handler.ts is optional library code (ADR-0005: no skill-shape axis, no
  // runtime dispatch on executor). A skill MAY bundle a handler.ts for custom
  // pre-/post-processing (e.g. feed-post) or as a dormant library awaiting a
  // CCR rework (pr-review / pr-autopilot / pdm-charter). Neither required nor
  // forbidden — the CCR routine never switches on it.

  // ── flaky-checks.json (Epic-019 Story 2c — Farah's rerun discipline) ─────
  // A skill MAY ship a flake allowlist (today: pr-autopilot). When present it
  // must be an array of { check_name, evidence, expires }: an entry without
  // evidence or expiry is a violation (no evergreen exemptions), an
  // editorial/deploy-class check name (R-10/W-1: /deploy|article|truncat|
  // editorial/i) is a hard error (categorically rerun-ineligible), and an
  // expired entry warns (inert at runtime — prune it).
  const flakyPath = join(dir, "flaky-checks.json");
  if (existsSync(flakyPath)) {
    let flakyEntries;
    try {
      flakyEntries = JSON.parse(readFileSync(flakyPath, "utf8"));
    } catch (err) {
      v("K0-flaky-parse", flakyPath, `invalid JSON: ${err.message}`);
    }
    if (flakyEntries !== undefined) {
      const { errors, warnings } = validateFlakyChecks(flakyEntries);
      for (const msg of errors) v("K1-flaky-entry", flakyPath, msg);
      for (const msg of warnings) {
        console.warn(`WARN [K2-flaky-expired] ${relative(REPO_ROOT, flakyPath)}: ${msg}`);
      }
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
console.error(`\nSee workforce/docs/epics/epic-008-skill-repository.md and workforce/scripts/schemas/skill-meta.schema.json for the schema.`);
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
