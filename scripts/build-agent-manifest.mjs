#!/usr/bin/env node
// Build-time manifest of workforce personas — reads workforce/agents/{slug}/
// and emits public/workforce-agents.json that the SPA fetches at runtime.
//
// Run automatically before `npm run dev` and `npm run build` via the
// `predev` / `prebuild` lifecycle hooks in package.json.

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const AGENTS_DIR = join(REPO_ROOT, "workforce", "agents");
const OUT_DIR = join(REPO_ROOT, "public");
const OUT_PATH = join(OUT_DIR, "workforce-agents.json");

function listSlugDirs() {
  if (!existsSync(AGENTS_DIR)) return [];
  return readdirSync(AGENTS_DIR)
    .filter((name) => /^[a-z]+$/.test(name))
    .filter((name) => statSync(join(AGENTS_DIR, name)).isDirectory())
    .sort();
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
    schedule_cron: cfg.schedule_cron,
    schedule_note: cfg.schedule_note,
    prompt_version: cfg.prompt_version,
    budget_monthly_usd: cfg.budget_monthly_usd,
    skills: cfg.skills,
    default_project: cfg.default_project,
    streams: cfg.streams,
    primary_deliverable_type: cfg.primary_deliverable_type,
    primary_deliverable_kind: cfg.primary_deliverable_kind,
    code_execution: cfg.code_execution ?? null,
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
const manifest = {
  generated_at: new Date().toISOString(),
  agents,
};

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(manifest, null, 2) + "\n");
console.log(`build-agent-manifest: wrote ${agents.length} agent(s) -> ${OUT_PATH.replace(REPO_ROOT + "/", "")}`);
