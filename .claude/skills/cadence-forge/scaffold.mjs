#!/usr/bin/env node
// cadence-forge/scaffold.mjs — materialize a new Cadence skill folder under
// workforce/skills/{name}/ from the templates in ./template/, so producing a
// conformant instance of the Cadence archetype is one reproducible command
// instead of hand-copying feed-post and hoping you matched every invariant.
//
// What a "Cadence" is (固有名詞): a scheduled, persona-voiced skill fired by
// EventBridge → wf-orchestrator-tick → the generic agent-runner CCR routine,
// whose runtime context is composed from (agent × skill × project) and whose
// side effect is a deterministic bundled write-script POSTing to an
// authenticated endpoint with a project-scoped credential. No PR, no AWS
// access in-session. feed-post is instance #1. See references/cadence-archetype.md.
//
// This script owns ONLY the mechanical scaffold (files that match the schema +
// the C-* lint invariants by construction). YOU still write the skill's actual
// SKILL.md body (the judgment the LLM performs) and wire the agent binding —
// see SKILL.md for the full procedure.
//
// Usage:
//   node .claude/skills/cadence-forge/scaffold.mjs \
//     --name weekly-digest \
//     --description "Write one weekly roll-up of the agent's shipped work. Use when ..." \
//     --owners dario,maya \
//     --credential workforce.feed_write_token \
//     --endpoint https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod/feed \
//     [--deliverable-type notification]   # only if the skill also publishes an artefact \
//     [--cost-class small|medium|large] \
//     [--write-script post.mjs] \
//     [--env-token FEED_WRITE_TOKEN] \
//     [--force] [--dry-run]
//
// Exit codes:
//   0  — folder written (or dry-run printed)
//   1  — bad / missing args

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const TEMPLATE_DIR = join(HERE, "template");
const SKILLS_DIR = join(REPO_ROOT, "workforce", "skills");
const AGENTS_DIR = join(REPO_ROOT, "workforce", "agents");

// Kept in sync with validate-skills.mjs:CREDENTIAL_TYPES (the lint source of truth).
const CREDENTIAL_TYPES = new Set([
  "anthropic.api_key",
  "discord.bot_token",
  "discord.webhook_url",
  "github.token",
  "notion.integration_token",
  "voyage.api_key",
  "workforce.feed_write_token",
]);
const COST_CLASSES = new Set(["small", "medium", "large"]);
const DELIV_TYPES = new Set(["article", "plan", "design-doc", "launch-plan", "pr", "notification"]);
const SKILL_NAME = /^[a-z][a-z0-9-]*$/;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
const flag = (name) => process.argv.includes(`--${name}`);
function die(msg) {
  console.error(`cadence-forge: ${msg}`);
  process.exit(1);
}

const name = arg("name");
const description = arg("description");
const ownersRaw = arg("owners");
const credential = arg("credential");
const endpoint = arg("endpoint");
// ADR-0005: no skill-shape axis. A Cadence runs as a CCR task; its judgment
// is LLM-produced and its side effect is the bundled write-script. A
// deliverable is optional — declare one only if the skill also publishes an
// artefact (pass --deliverable-type); omit for pure POST-to-endpoint cadences.
const deliverableType = arg("deliverable-type");
const costClass = arg("cost-class") ?? "small";
const writeScript = arg("write-script") ?? "post.mjs";
const dryRun = flag("dry-run");
const force = flag("force");

if (!name) die("--name <kebab-case> is required");
if (!SKILL_NAME.test(name) || name.length > 64) die(`--name "${name}" must match ${SKILL_NAME} and be ≤ 64 chars`);
if (/anthropic|claude/.test(name)) die(`--name "${name}" must not contain a reserved token (anthropic|claude)`);
if (!description) die("--description <text> is required (the SKILL.md frontmatter 'what + when')");
if (description.length > 1024) die(`--description is ${description.length} chars (max 1024)`);
if (!ownersRaw) die("--owners <slug,slug,...> is required");
if (!credential) die(`--credential <type> is required (one of: ${[...CREDENTIAL_TYPES].join(", ")})`);

const credBase = credential.split("@")[0];
if (!CREDENTIAL_TYPES.has(credBase)) die(`--credential base type "${credBase}" not in the allowlist: ${[...CREDENTIAL_TYPES].join(", ")}`);
if (!COST_CLASSES.has(costClass)) die(`--cost-class must be one of {${[...COST_CLASSES].join(", ")}}`);
if (deliverableType && !DELIV_TYPES.has(deliverableType)) die(`--deliverable-type "${deliverableType}" not in {${[...DELIV_TYPES].join(", ")}}`);
if (!writeScript.endsWith(".mjs")) die(`--write-script must end in .mjs (got "${writeScript}")`);

const owners = ownersRaw.split(",").map((s) => s.trim()).filter(Boolean);
if (owners.length === 0) die("--owners resolved to an empty list");
const knownAgents = existsSync(AGENTS_DIR)
  ? new Set(readdirSync(AGENTS_DIR).filter((d) => statSync(join(AGENTS_DIR, d)).isDirectory()))
  : new Set();
for (const o of owners) {
  if (!/^[a-z]+$/.test(o)) die(`owner "${o}" must match ^[a-z]+$`);
  if (knownAgents.size > 0 && !knownAgents.has(o)) die(`owner "${o}" is not an existing agent under workforce/agents/`);
}

// Env var the write script reads the injected credential into. Derived from the
// credential field (workforce.feed_write_token → FEED_WRITE_TOKEN) unless given.
const envToken = arg("env-token") ?? credBase.split(".")[1].toUpperCase();
const apiUrl = endpoint ?? "TODO_REPLACE_WITH_AUTHENTICATED_ENDPOINT_URL";

const outDir = join(SKILLS_DIR, name);
if (existsSync(outDir) && !force) die(`workforce/skills/${name}/ already exists — pass --force to overwrite, or pick another --name`);

const today = new Date().toISOString().slice(0, 10);

// meta.json is built programmatically (conditional deliverable block, arrays) —
// the schema + C-* invariants are satisfied by construction.
const meta = {
  name,
  version: "0.1.0",
  status: "active",
  archetype: "cadence",
  ...(deliverableType ? { deliverable: { type: deliverableType, publish_notion: false } } : {}),
  cost_class: costClass,
  owners,
  improvement_agent: null,
  created_at: today,
  requires: [credential],
};

const subs = {
  NAME: name,
  DESCRIPTION: description,
  WRITE_SCRIPT: writeScript,
  CREDENTIAL_KEY: credential,
  ENV_TOKEN: envToken,
  DEFAULT_API_URL: apiUrl,
  TODAY: today,
};
const fill = (text) => text.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in subs ? subs[k] : m));

const skillMd = fill(readFileSync(join(TEMPLATE_DIR, "SKILL.md.tmpl"), "utf8"));
const scriptBody = fill(readFileSync(join(TEMPLATE_DIR, "write-script.mjs.tmpl"), "utf8"));
const metaJson = JSON.stringify(meta, null, 2) + "\n";

const files = [
  { path: join(outDir, "SKILL.md"), body: skillMd },
  { path: join(outDir, "meta.json"), body: metaJson },
  { path: join(outDir, writeScript), body: scriptBody },
];

if (dryRun) {
  console.log(`cadence-forge: DRY RUN — would write workforce/skills/${name}/:\n`);
  for (const f of files) console.log(`  • ${f.path.replace(REPO_ROOT + "/", "")} (${f.body.length} bytes)`);
  console.log(`\nmeta.json:\n${metaJson}`);
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
for (const f of files) writeFileSync(f.path, f.body);

console.log(`cadence-forge: scaffolded workforce/skills/${name}/ (archetype=cadence)`);
for (const f of files) console.log(`  ✓ ${f.path.replace(REPO_ROOT + "/", "")}`);
console.log(`
Next steps (see .claude/skills/cadence-forge/SKILL.md):
  1. Write the real SKILL.md body — the judgment the LLM performs each fire,
     the recall packet it reads, the skip rule, the length/W-1 guards.
  2. Confirm/replace DEFAULT_API_URL in ${writeScript} (currently: ${apiUrl}).
  3. Validate:   npm run workforce:skills && npm run workforce:skill-registry:check
  4. Wire a binding into an agent's workforce/agents/{slug}/agent.json — see
     references/binding-and-cron.md (executor=claude-code-routine, scheduler=external,
     invoked_by=api, a staggered cron, routine_spec=agent-runner.md, project_id).
  5. Open a draft PR (Rule-11: new SKILL.md body is its own PR).`);
