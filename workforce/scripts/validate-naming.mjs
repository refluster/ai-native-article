#!/usr/bin/env node
// Enforces R-N7 (workforce/docs/naming.md). Exits non-zero on violation.
// Designed to degrade gracefully: rules dependent on files/dirs that don't yet
// exist are no-ops, so this lint passes at PR1 (docs + linter only) and
// progressively activates as later PRs add agents, lambdas, and the SAM template.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WORKFORCE_ROOT = join(HERE, "..");
const REPO_ROOT = join(WORKFORCE_ROOT, "..");

const violations = [];
const report = (rule, path, msg) =>
  violations.push({ rule, path: relative(REPO_ROOT, path), msg });

const KEBAB = /^[a-z][a-z0-9-]*$/;
const SLUG = /^[a-z]+$/;
const KEBAB_TS = /^[a-z][a-z0-9-]*\.ts$/;
const KEBAB_MD = /^[a-z][a-z0-9-]*\.md$/;

const listDir = (path) => {
  if (!existsSync(path)) return [];
  return readdirSync(path).map((name) => ({
    name,
    full: join(path, name),
    stat: statSync(join(path, name)),
  }));
};

// Rule 1: kebab-case for directories under workforce/{agents,lambdas,skills}/
const SKIP_DIR_NAMES = new Set(["node_modules", "dist", ".aws-sam"]);
for (const parent of ["agents", "lambdas", "skills"]) {
  const dir = join(WORKFORCE_ROOT, parent);
  for (const e of listDir(dir)) {
    if (!e.stat.isDirectory()) continue;
    if (SKIP_DIR_NAMES.has(e.name)) continue;
    if (!KEBAB.test(e.name)) {
      report("R1-kebab-dir", e.full, `directory name "${e.name}" must match ${KEBAB}`);
    }
  }
}

// Rule 2: agent slugs are single lowercase tokens
for (const e of listDir(join(WORKFORCE_ROOT, "agents"))) {
  if (!e.stat.isDirectory()) continue;
  if (!SLUG.test(e.name)) {
    report("R2-agent-slug", e.full, `agent slug "${e.name}" must match ${SLUG}`);
  }
}

// Rule 3: TS files under lambdas/ and skills/ are kebab-case
// (skills/{name}/handler.ts and any future co-bundled helpers).
const walkTs = (dir) => {
  for (const e of listDir(dir)) {
    if (e.stat.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".aws-sam") continue;
      walkTs(e.full);
    } else if (extname(e.name) === ".ts") {
      if (!KEBAB_TS.test(e.name)) {
        report("R3-kebab-ts", e.full, `TS source "${e.name}" must be kebab-case.ts`);
      }
    }
  }
};
walkTs(join(WORKFORCE_ROOT, "lambdas"));
walkTs(join(WORKFORCE_ROOT, "skills"));

// Rule 4: markdown files anywhere under docs/ are kebab-case
const walkMd = (dir) => {
  for (const e of listDir(dir)) {
    if (e.stat.isDirectory()) {
      walkMd(e.full);
    } else if (extname(e.name) === ".md") {
      const allowed = e.name === "README.md" || KEBAB_MD.test(e.name);
      if (!allowed) {
        report("R4-kebab-md", e.full, `doc "${e.name}" must be kebab-case.md (or README.md)`);
      }
    }
  }
};
walkMd(join(WORKFORCE_ROOT, "docs"));

// Rule 5: SAM template — *Name properties must start with wf- and end with -{stage} token
const samPath = join(WORKFORCE_ROOT, "infra", "sam", "template.yaml");
if (existsSync(samPath)) {
  const yaml = readFileSync(samPath, "utf8");
  // Match lines like:   FunctionName: wf-foo-${Stage}
  //   or  FunctionName: !Sub wf-foo-${Stage}
  //   or  FunctionName: "wf-foo-${Stage}"
  // [ \t]+ (not \s+) so we don't match a bare YAML key on its own line —
  // those are Outputs/parameter-block headers, not deployed-resource-name properties.
  const nameProp = /^(\s*)(FunctionName|TableName|BucketName|RuleName|TopicName|QueueName|StateMachineName|LogGroupName|AlarmName):[ \t]+(?:!Sub[ \t]+)?["']?([^\s"'#]+)["']?/gm;
  let m;
  while ((m = nameProp.exec(yaml)) !== null) {
    const [, , prop, value] = m;
    if (!value.startsWith("wf-")) {
      report("R5-wf-prefix", samPath, `${prop} "${value}" must start with "wf-"`);
    }
    if (!/\$\{(Stage|WorkforceStage)\}|-(dev|prod)$/.test(value)) {
      report("R5-stage-suffix", samPath, `${prop} "${value}" must end with -dev, -prod, or a \${Stage}/\${WorkforceStage} reference`);
    }
  }
}

// Rule 6: agent.json:slug equals directory name (when both exist)
for (const e of listDir(join(WORKFORCE_ROOT, "agents"))) {
  if (!e.stat.isDirectory()) continue;
  const cfg = join(e.full, "agent.json");
  if (!existsSync(cfg)) continue;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(cfg, "utf8"));
  } catch (err) {
    report("R6-agent-json", cfg, `not valid JSON: ${err.message}`);
    continue;
  }
  if (parsed.slug !== e.name) {
    report("R6-agent-json", cfg, `agent.json:slug "${parsed.slug}" does not match directory "${e.name}"`);
  }
}

if (violations.length === 0) {
  console.log("workforce/scripts/validate-naming.mjs: OK (0 violations)");
  process.exit(0);
}

console.error(`workforce/scripts/validate-naming.mjs: ${violations.length} violation(s)\n`);
for (const v of violations) {
  console.error(`  [${v.rule}] ${v.path}: ${v.msg}`);
}
console.error(`\nSee workforce/docs/naming.md for the convention.`);
process.exit(1);
