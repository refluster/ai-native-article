#!/usr/bin/env node
// Validates workforce/agents/{slug}/agent.json against the v0.3 schema
// ({skill, executor, trigger} bindings — see workforce/docs/runbooks/bindings.md
// and governance.md R-N4). Exits non-zero on violation. Designed to be
// wired into CI.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKFORCE_ROOT = join(HERE, "..");
const REPO_ROOT = join(WORKFORCE_ROOT, "..");
const AGENTS_DIR = join(WORKFORCE_ROOT, "agents");
const SKILLS_DIR = join(WORKFORCE_ROOT, "skills");
const ROUTINES_DIR = join(WORKFORCE_ROOT, "docs", "routines");
const WORKFLOWS_DIR = join(REPO_ROOT, ".github", "workflows");

const violations = [];
const v = (rule, path, msg) =>
  violations.push({ rule, path: relative(REPO_ROOT, path), msg });

const SLUG = /^[a-z]+$/;
const MODEL = /^(anthropic|azure|claude-code):[a-z0-9-]+(?:-[a-z0-9.]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const CRON = /^cron\([^)]+\)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SKILL_NAME = /^[a-z][a-z0-9-]*$/;

const ALLOWED_EXECUTORS = new Set(["lambda", "claude-code-routine", "gha", "cli"]);
const ALLOWED_SCHEDULERS = new Set([
  "eventbridge",
  "claude-code-routine",
  "gha",
  "external",
  "manual",
]);
const ALLOWED_INVOKED_BY = new Set(["api", "repository_dispatch", "manual"]);

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
const W3_CAP = 130;

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
      // skill
      if (typeof b.skill !== "string" || !SKILL_NAME.test(b.skill)) {
        v("S9-binding-skill", cfg, `bindings[${i}].skill "${b.skill}" must be kebab-case`);
        continue;
      }
      // executor
      if (!ALLOWED_EXECUTORS.has(b.executor)) {
        v(
          "S9-binding-executor",
          cfg,
          `bindings[${i}].executor "${b.executor}" must be one of ${[...ALLOWED_EXECUTORS].join("|")}`,
        );
        continue;
      }
      // trigger
      if (typeof b.trigger !== "object" || b.trigger === null) {
        v("S9-binding-trigger", cfg, `bindings[${i}].trigger must be an object`);
        continue;
      }
      const t = b.trigger;
      if (!ALLOWED_SCHEDULERS.has(t.scheduler)) {
        v(
          "S9-binding-scheduler",
          cfg,
          `bindings[${i}].trigger.scheduler "${t.scheduler}" must be one of ${[...ALLOWED_SCHEDULERS].join("|")}`,
        );
        continue;
      }
      // R-N4 executor↔scheduler compatibility.
      //
      // `lambda` accepts the three trigger sources documented in
      // runbooks/bindings.md:
      //   - eventbridge: orchestrator-tick cron (the original v1 shape)
      //   - external:    API GW / async invoke from another binding (Phase 7
      //                  webhook surface — wf-webhook-{stage} fires runner)
      //   - manual:      operator-triggered direct invoke
      //                  (`aws lambda invoke --function-name wf-agent-runner ...`)
      //
      // The earlier "lambda → eventbridge only" rule was too tight; Phase 7
      // (multi-project PR review) needed Lambda-resident skills triggered by
      // operator chat invocation or by the future webhook, not by a cron.
      const LAMBDA_SCHEDULERS = new Set(["eventbridge", "external", "manual"]);
      if (b.executor === "lambda" && !LAMBDA_SCHEDULERS.has(t.scheduler)) {
        v(
          "S9-binding-compat",
          cfg,
          `bindings[${i}]: executor=lambda requires trigger.scheduler in ${[...LAMBDA_SCHEDULERS].join("|")} (R-N4)`,
        );
      }
      if (b.executor === "gha" && t.scheduler !== "gha" && t.scheduler !== "external") {
        v(
          "S9-binding-compat",
          cfg,
          `bindings[${i}]: executor=gha requires trigger.scheduler=gha or external`,
        );
      }
      // Cron presence for cron-driven schedulers
      if (t.scheduler === "eventbridge") {
        if (typeof t.cron !== "string" || !CRON.test(t.cron)) {
          v(
            "S9-binding-cron",
            cfg,
            `bindings[${i}].trigger.cron "${t.cron}" must be cron(...) form when scheduler=eventbridge`,
          );
        }
      }
      // CCR bindings need either a cron or a github_event
      if (b.executor === "claude-code-routine" && t.scheduler === "claude-code-routine") {
        if (!t.github_event && !t.cron) {
          v(
            "S9-binding-ccr-trigger",
            cfg,
            `bindings[${i}]: CCR binding requires either trigger.github_event or trigger.cron`,
          );
        }
      }
      // external scheduler: must say how it's invoked
      if (t.scheduler === "external") {
        if (!ALLOWED_INVOKED_BY.has(t.invoked_by)) {
          v(
            "S9-binding-external-invoked-by",
            cfg,
            `bindings[${i}]: scheduler=external requires trigger.invoked_by in ${[...ALLOWED_INVOKED_BY].join("|")}`,
          );
        }
      }
      // routine_spec required + must exist for CCR
      if (b.executor === "claude-code-routine") {
        if (typeof b.routine_spec !== "string" || b.routine_spec.length === 0) {
          v(
            "S9-binding-routine-spec",
            cfg,
            `bindings[${i}]: executor=claude-code-routine requires routine_spec (path under workforce/docs/routines/)`,
          );
        } else {
          const routinePath = join(REPO_ROOT, b.routine_spec);
          if (!existsSync(routinePath)) {
            v(
              "R8-routine-spec-exists",
              cfg,
              `bindings[${i}].routine_spec "${b.routine_spec}" does not exist`,
            );
          }
        }
      }
      // workflow required + must exist for GHA
      if (b.executor === "gha") {
        if (typeof b.workflow !== "string" || b.workflow.length === 0) {
          v(
            "S9-binding-workflow",
            cfg,
            `bindings[${i}]: executor=gha requires workflow (path under .github/workflows/)`,
          );
        } else {
          const wfPath = join(REPO_ROOT, b.workflow);
          if (!existsSync(wfPath)) {
            v(
              "R8-workflow-exists",
              cfg,
              `bindings[${i}].workflow "${b.workflow}" does not exist`,
            );
          }
        }
      }
      // note (optional)
      if (b.note !== undefined && typeof b.note !== "string") {
        v("S9-binding-note", cfg, `bindings[${i}].note must be string if present`);
      }
      // Skill folder cross-check applies only to executor=lambda.
      // For CCR/GHA the skill name is logical; the artefact lives elsewhere.
      if (b.executor === "lambda") {
        if (skillsIndex.size === 0) continue;
        const entry = skillsIndex.get(b.skill);
        if (!entry) {
          v(
            "R8-binding-skill-exists",
            cfg,
            `bindings[${i}].skill "${b.skill}" has no workforce/skills/${b.skill}/ directory (required for executor=lambda)`,
          );
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

// R8-routine-spec-orphan: every workforce/docs/routines/*.md must be
// referenced by at least one binding's `routine_spec` field. Catches the
// inverse failure mode of R8-routine-spec-exists — a routine that was
// renamed but whose old spec file was left behind on disk.
// README.md / index-style docs in the routines/ folder are exempt.
const ROUTINES_DIR_EXEMPT = new Set(["README.md", "index.md"]);
if (existsSync(ROUTINES_DIR)) {
  const referencedSpecs = new Set();
  for (const slug of slugDirs) {
    const cfg = join(AGENTS_DIR, slug, "agent.json");
    if (!existsSync(cfg)) continue;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(cfg, "utf8"));
    } catch {
      continue;
    }
    if (!Array.isArray(parsed?.bindings)) continue;
    for (const b of parsed.bindings) {
      if (typeof b?.routine_spec === "string") {
        referencedSpecs.add(b.routine_spec);
      }
    }
  }
  const specFiles = readdirSync(ROUTINES_DIR).filter(
    (n) => n.endsWith(".md") && !ROUTINES_DIR_EXEMPT.has(n),
  );
  for (const file of specFiles) {
    const relPath = `workforce/docs/routines/${file}`;
    if (!referencedSpecs.has(relPath)) {
      v(
        "R8-routine-spec-orphan",
        join(ROUTINES_DIR, file),
        `routine_spec "${relPath}" exists on disk but is not referenced by any agent.json binding. Either delete the file or add a binding that points at it.`,
      );
    }
  }
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
