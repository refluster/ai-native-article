#!/usr/bin/env node
// Build-time manifests of workforce personas + skills — reads
// workforce/agents/{slug}/ and workforce/skills/{name}/, then emits
// workforce-agents.json (both SPAs) and workforce-skills.json
// (workforce SPA only) into the matching public/ directories.
//
// Why both apps for agents? The workforce SPA renders the manifest in
// full; the article SPA reads a small subset (slug / name / role) to
// power the AuthorChip byline. Skills are workforce-only — the article
// SPA doesn't surface them.
//
// Run automatically before `npm run dev` and `npm run build` via the
// per-app `predev` / `prebuild` lifecycle hooks in each app's
// package.json. When the live agents-api is configured the SPA still
// reads these manifests for the static fields (about, system.md
// snippet, the SKILL.md description) the API doesn't currently return.

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const AGENTS_DIR = join(REPO_ROOT, "workforce", "agents");
const SKILLS_DIR = join(REPO_ROOT, "workforce", "skills");
const ORG_PATH = join(AGENTS_DIR, "_org.json");
const OUT_PATHS = [
  join(REPO_ROOT, "apps", "article", "public", "workforce-agents.json"),
  join(REPO_ROOT, "apps", "workforce", "public", "workforce-agents.json"),
];
const SKILLS_OUT_PATH = join(
  REPO_ROOT,
  "apps",
  "workforce",
  "public",
  "workforce-skills.json",
);

function listSlugDirs() {
  if (!existsSync(AGENTS_DIR)) return [];
  return readdirSync(AGENTS_DIR)
    .filter((name) => /^[a-z]+$/.test(name))
    .filter((name) => statSync(join(AGENTS_DIR, name)).isDirectory())
    .sort();
}

function loadOrgTopology() {
  if (!existsSync(ORG_PATH)) return { topology: {} };
  return JSON.parse(readFileSync(ORG_PATH, "utf8"));
}

function loadOne(slug) {
  const dir = join(AGENTS_DIR, slug);
  const cfg = JSON.parse(readFileSync(join(dir, "agent.json"), "utf8"));
  const systemMd = readFileSync(join(dir, "system.md"), "utf8");

  // "About" snippet: first non-empty paragraph after the title block.
  // Skips the H1 and any subsequent "You are X" framing line; takes the
  // next prose paragraph that explains the role.
  const aboutSnippet = pickAboutSnippet(systemMd);

  return {
    slug: cfg.slug,
    first_name: cfg.first_name,
    last_name: cfg.last_name,
    residence: cfg.residence,
    role: cfg.role,
    model: cfg.model,
    prompt_version: cfg.prompt_version,
    budget_monthly_usd: cfg.budget_monthly_usd,
    default_project: cfg.default_project,
    streams: cfg.streams,
    bindings: cfg.bindings,
    created_at: cfg.created_at,
    about: aboutSnippet,
  };
}

function pickAboutSnippet(md) {
  const paragraphs = md
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  for (const p of paragraphs) {
    if (p.startsWith("#")) continue; // headings
    if (p.startsWith("You are")) continue; // framing
    return p.replace(/\s+/g, " ").slice(0, 400);
  }
  return "";
}

const slugs = listSlugDirs();
const agents = slugs.map(loadOne);

// Merge org topology (reports_to / lateral / tier) and compute direct_reports
// as the inverse of reports_to. This means agent.json stays focused on
// per-agent config; relationships live in _org.json so they're auditable
// as a single graph.
const org = loadOrgTopology();
const topology = org.topology ?? {};
const directReports = Object.fromEntries(slugs.map((s) => [s, []]));
for (const [child, edges] of Object.entries(topology)) {
  for (const parent of edges.reports_to ?? []) {
    if (directReports[parent]) directReports[parent].push(child);
  }
}
for (const a of agents) {
  const node = topology[a.slug] ?? {};
  a.tier = node.tier ?? "ic";
  a.reports_to = node.reports_to ?? [];
  a.lateral = node.lateral ?? [];
  a.direct_reports = directReports[a.slug] ?? [];
}

const manifest = {
  generated_at: new Date().toISOString(),
  agents,
};

const body = JSON.stringify(manifest, null, 2) + "\n";
for (const out of OUT_PATHS) {
  const dir = dirname(out);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(out, body);
  console.log(`build-agent-manifest: wrote ${agents.length} agent(s) -> ${out.replace(REPO_ROOT + "/", "")}`);
}

// ----- Skills manifest (workforce SPA only) ----------------------------------

function listSkillDirs() {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR)
    .filter((name) => /^[a-z][a-z0-9-]*$/.test(name))
    .filter((name) => statSync(join(SKILLS_DIR, name)).isDirectory())
    .sort();
}

function parseFrontmatter(md) {
  // Minimal YAML-ish frontmatter parser: only handles `key: value` lines
  // (one per key). Skills frontmatter is constrained to `name` + a
  // single-line `description` per the Anthropic Agent Skills spec.
  if (!md.startsWith("---")) return {};
  const end = md.indexOf("\n---", 3);
  if (end === -1) return {};
  const block = md.slice(3, end);
  const out = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim();
  }
  return out;
}

function loadOneSkill(name) {
  const dir = join(SKILLS_DIR, name);
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
  const md = readFileSync(join(dir, "SKILL.md"), "utf8");
  const fm = parseFrontmatter(md);
  return {
    name: meta.name,
    version: meta.version,
    status: meta.status,
    executor: meta.executor,
    deliverable: meta.deliverable ?? null,
    cost_class: meta.cost_class,
    owners: meta.owners ?? [],
    improvement_agent: meta.improvement_agent ?? null,
    created_at: meta.created_at,
    description: fm.description ?? "",
  };
}

const skills = listSkillDirs().map(loadOneSkill);
const skillsManifest = {
  generated_at: new Date().toISOString(),
  skills,
};
const skillsBody = JSON.stringify(skillsManifest, null, 2) + "\n";
{
  const dir = dirname(SKILLS_OUT_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(SKILLS_OUT_PATH, skillsBody);
  console.log(
    `build-agent-manifest: wrote ${skills.length} skill(s) -> ${SKILLS_OUT_PATH.replace(REPO_ROOT + "/", "")}`,
  );
}
