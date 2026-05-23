#!/usr/bin/env node
// Validates workforce/agents/{slug}/agent.json against the v0.2 schema
// (1-stage bindings[]). Exits non-zero on violation. Designed to be
// wired into CI.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKFORCE_ROOT = join(HERE, "..");
const REPO_ROOT = join(WORKFORCE_ROOT, "..");
const AGENTS_DIR = join(WORKFORCE_ROOT, "agents");
const SKILLS_DIR = join(WORKFORCE_ROOT, "skills");

const violations = [];
const v = (rule, path, msg) =>
  violations.push({ rule, path: relative(REPO_ROOT, path), msg });

const SLUG = /^[a-z]+$/;
const MODEL = /^(anthropic|azure|claude-code):[a-z0-9-]+(?:-[a-z0-9.]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const CRON = /^cron\([^)]+\)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const REQUIRED_KEYS = [
  "slug",
  "first_name",
  "last_name",
  "residence",
  "role",
  "model",
  "prompt_version",
  "budget_monthly_usd",
  "default_project",
  "streams",
  "bindings",
  "owner_email",
  "created_at",
];

const ALLOWED_STREAMS = new Set(["internal", "client", "editorial"]);

if (!existsSync(AGENTS_DIR)) {
  console.log("workforce/scripts/validate-agent-json.mjs: OK (no agents/ dir yet)");
  process.exit(0);
}

const slugDirs = readdirSync(AGENTS_DIR).filter((name) =>
  statSync(join(AGENTS_DIR, name)).isDirectory(),
);

if (slugDirs.length === 0) {
  console.log("workforce/scripts/validate-agent-json.mjs: OK (no agents yet)");
  process.exit(0);
}

let totalBudget = 0;
const W3_CAP = 50;

// Build a snapshot of available skills + their owner lists for cross-checks.
const skillsIndex = new Map(); // name → { owners: Set<slug> }
if (existsSync(SKILLS_DIR)) {
  for (const name of readdirSync(SKILLS_DIR)) {
    const dir = join(SKILLS_DIR, name);
    if (!statSync(dir).isDirectory()) continue;
    const metaPath = join(dir, "meta.json");
    if (!existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      const owners = new Set(Array.isArray(meta.owners) ? meta.owners : []);
      skillsIndex.set(name, { owners });
    } catch {
      // validate-skills.mjs reports the parse error
    }
  }
}

for (const slug of slugDirs) {
  const dir = join(AGENTS_DIR, slug);
  const cfg = join(dir, "agent.json");
  const sys = join(dir, "system.md");
  const avatar = join(dir, "avatar.svg");

  if (!SLUG.test(slug)) {
    v("R2-slug", dir, `directory "${slug}" violates ^[a-z]+$`);
    continue;
  }

  if (!existsSync(cfg)) {
    v("F1-agent-json-missing", dir, "agent.json missing");
    continue;
  }
  if (!existsSync(sys)) v("F2-system-md-missing", dir, "system.md missing");
  if (existsSync(avatar)) {
    v("F3-avatar-asset-forbidden", avatar, "per-agent avatar.svg is forbidden; avatars are rendered procedurally");
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(cfg, "utf8"));
  } catch (err) {
    v("S0-json-parse", cfg, `invalid JSON: ${err.message}`);
    continue;
  }

  for (const k of REQUIRED_KEYS) {
    if (!(k in parsed)) v("S1-required-key", cfg, `missing key "${k}"`);
  }

  if (parsed.slug !== slug) {
    v("S2-slug-match", cfg, `slug "${parsed.slug}" does not match directory "${slug}"`);
  }
  if (typeof parsed.first_name !== "string" || parsed.first_name.length === 0) {
    v("S3-first-name", cfg, "first_name must be non-empty string");
  }
  if (typeof parsed.last_name !== "string" || parsed.last_name.length === 0) {
    v("S3-last-name", cfg, "last_name must be non-empty string");
  }
  if (typeof parsed.residence !== "string" || !/^.+,\s*.+$/.test(parsed.residence)) {
    v("S3-residence", cfg, `residence "${parsed.residence}" must be "City, Country/Region" form`);
  }
  if (typeof parsed.role !== "string" || parsed.role.length === 0) {
    v("S4-role", cfg, "role must be non-empty string");
  }
  if (typeof parsed.model !== "string" || !MODEL.test(parsed.model)) {
    v("S5-model", cfg, `model "${parsed.model}" must match provider:name`);
  }
  if (typeof parsed.prompt_version !== "string" || !SEMVER.test(parsed.prompt_version)) {
    v("S7-semver", cfg, `prompt_version "${parsed.prompt_version}" must be semver x.y.z`);
  }
  if (typeof parsed.budget_monthly_usd !== "number" || parsed.budget_monthly_usd <= 0) {
    v("S8-budget", cfg, "budget_monthly_usd must be positive number");
  } else {
    totalBudget += parsed.budget_monthly_usd;
  }
  if (!Array.isArray(parsed.bindings) || parsed.bindings.length === 0) {
    v("S9-bindings", cfg, "bindings must be non-empty array");
  } else {
    for (let i = 0; i < parsed.bindings.length; i++) {
      const b = parsed.bindings[i];
      if (typeof b !== "object" || b === null) {
        v("S9-binding-object", cfg, `bindings[${i}] must be an object`);
        continue;
      }
      if (typeof b.cron !== "string" || !CRON.test(b.cron)) {
        v("S9-binding-cron", cfg, `bindings[${i}].cron "${b.cron}" must be cron(...) form`);
      }
      if (typeof b.skill !== "string" || !/^[a-z][a-z0-9-]*$/.test(b.skill)) {
        v("S9-binding-skill", cfg, `bindings[${i}].skill "${b.skill}" must be kebab-case`);
        continue;
      }
      if (b.note !== undefined && typeof b.note !== "string") {
        v("S9-binding-note", cfg, `bindings[${i}].note must be string if present`);
      }
      // R8-* cross-checks
      if (skillsIndex.size === 0) continue;
      const entry = skillsIndex.get(b.skill);
      if (!entry) {
        v("R8-binding-skill-exists", cfg, `bindings[${i}].skill "${b.skill}" has no workforce/skills/${b.skill}/ directory`);
        continue;
      }
      if (!entry.owners.has(slug)) {
        v(
          "R8-binding-skill-owner",
          cfg,
          `agent "${slug}" binds skill "${b.skill}" but is not in workforce/skills/${b.skill}/meta.json:owners`,
        );
      }
    }
  }
  if (typeof parsed.default_project !== "string" || parsed.default_project.length === 0) {
    v("S10-default-project", cfg, "default_project must be non-empty string");
  }
  if (!Array.isArray(parsed.streams) || parsed.streams.length === 0) {
    v("S11-streams", cfg, "streams must be non-empty array");
  } else {
    for (const s of parsed.streams) {
      if (!ALLOWED_STREAMS.has(s)) {
        v("S11-stream-value", cfg, `stream "${s}" not in {internal, client, editorial}`);
      }
    }
  }
  if (parsed.owner_email !== null && typeof parsed.owner_email !== "string") {
    v("S14-owner-email", cfg, "owner_email must be null or string");
  }
  if (typeof parsed.created_at !== "string" || !ISO_DATE.test(parsed.created_at)) {
    v("S15-created-at", cfg, `created_at "${parsed.created_at}" must be YYYY-MM-DD`);
  }
}

if (totalBudget > W3_CAP) {
  v(
    "W3-cap",
    AGENTS_DIR,
    `sum of budget_monthly_usd across agents (${totalBudget}) exceeds W-3 cap (${W3_CAP})`,
  );
}

if (violations.length === 0) {
  console.log(
    `workforce/scripts/validate-agent-json.mjs: OK (${slugDirs.length} agent(s), total budget USD ${totalBudget}/${W3_CAP})`,
  );
  process.exit(0);
}

console.error(`workforce/scripts/validate-agent-json.mjs: ${violations.length} violation(s)\n`);
for (const x of violations) {
  console.error(`  [${x.rule}] ${x.path}: ${x.msg}`);
}
console.error(`\nSee workforce/docs/data-model.md and workforce/docs/governance.md for the schema.`);
process.exit(1);
