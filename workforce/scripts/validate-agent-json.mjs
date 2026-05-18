#!/usr/bin/env node
// Validates workforce/agents/{slug}/agent.json against the v0.1 schema.
// Also checks that system.md and avatar.svg are present alongside each agent.json.
// Exits non-zero on violation. Designed to be wired into CI.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKFORCE_ROOT = join(HERE, "..");
const REPO_ROOT = join(WORKFORCE_ROOT, "..");
const AGENTS_DIR = join(WORKFORCE_ROOT, "agents");

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
  "schedule_cron",
  "schedule_note",
  "prompt_version",
  "budget_monthly_usd",
  "skills",
  "default_project",
  "streams",
  "primary_deliverable_type",
  "primary_deliverable_kind",
  "owner_email",
  "created_at",
];

const ALLOWED_DELIVERABLE_TYPES = new Set([
  "article",
  "pr",
  "plan",
  "design-doc",
  "launch-plan",
]);

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
  // F3 removed: per-agent avatar files don't scale to 100s of agents.
  // Avatars are rendered procedurally from the slug (initial + slug-hash hue).
  // If an avatar.svg sneaks in, flag it as an unused asset.
  if (existsSync(avatar)) {
    v("F3-avatar-asset-forbidden", avatar, "per-agent avatar.svg is forbidden; avatars are rendered procedurally from the slug — remove this file");
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
  if (typeof parsed.schedule_cron !== "string" || !CRON.test(parsed.schedule_cron)) {
    v("S6-cron", cfg, `schedule_cron "${parsed.schedule_cron}" must be cron(...) form`);
  }
  if (typeof parsed.prompt_version !== "string" || !SEMVER.test(parsed.prompt_version)) {
    v("S7-semver", cfg, `prompt_version "${parsed.prompt_version}" must be semver x.y.z`);
  }
  if (typeof parsed.budget_monthly_usd !== "number" || parsed.budget_monthly_usd <= 0) {
    v("S8-budget", cfg, "budget_monthly_usd must be positive number");
  } else {
    totalBudget += parsed.budget_monthly_usd;
  }
  if (!Array.isArray(parsed.skills) || parsed.skills.length === 0) {
    v("S9-skills", cfg, "skills must be non-empty array");
  } else {
    for (const s of parsed.skills) {
      if (typeof s !== "string" || !/^[a-z][a-z0-9-]*$/.test(s)) {
        v("S9-skill-name", cfg, `skill name "${s}" must be kebab-case`);
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
  if (!ALLOWED_DELIVERABLE_TYPES.has(parsed.primary_deliverable_type)) {
    v("S12-deliv-type", cfg, `primary_deliverable_type "${parsed.primary_deliverable_type}" not in allowed set`);
  }
  if (typeof parsed.primary_deliverable_kind !== "string") {
    v("S13-deliv-kind", cfg, "primary_deliverable_kind must be string");
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
