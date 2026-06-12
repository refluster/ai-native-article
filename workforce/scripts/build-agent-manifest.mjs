#!/usr/bin/env node
// Build-time manifests of workforce personas + skills — emits
// workforce-agents.json (both SPAs) and workforce-skills.json
// (workforce SPA only) into the matching public/ directories.
//
// AGENTS are sourced from the live agents-api (ADR-0007 step 6a): the
// AGENT#{slug}/META rows are the single source of truth and the
// workforce/agents/ git tree is retired. The manifest keeps the exact
// pre-6a shape (including the derived about / direct_reports / depth
// fields) so neither SPA changes. Base URL resolution:
//   WF_AGENTS_API_BASE > VITE_WORKFORCE_AGENTS_API_BASE >
//   https://workforce-api.kohuehara.xyz   (the stable custom domain —
//   workforce/infra/sam-api-domain — reachable without AWS credentials,
//   which the article-site deploy does not have).
// Fail-loud (C-4): an unreachable API turns the build red rather than
// shipping a stale or empty manifest.
//
// SKILLS remain file-sourced from workforce/skills/ — ADR-0007 covers
// agent config only; skills are still git-owned.
//
// Why both apps for agents? The workforce SPA renders the manifest in
// full; the article SPA reads a small subset (slug / name / role) to
// power the AuthorChip byline. Skills are workforce-only.
//
// Run automatically before `npm run dev` and `npm run build` via the
// per-app `predev` / `prebuild` lifecycle hooks in each app's
// package.json.

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const SKILLS_DIR = join(REPO_ROOT, "workforce", "skills");
const API_BASE = (
  process.env.WF_AGENTS_API_BASE ??
  process.env.VITE_WORKFORCE_AGENTS_API_BASE ??
  "https://workforce-api.kohuehara.xyz"
).replace(/\/+$/, "");
// Newsletter only (the AuthorChip byline subset of a fully static site).
// The workforce console stopped consuming a baked agents manifest with
// ADR-0008 §7 — it reads GET /agents live, so emitting a snapshot there
// would only re-create the staleness window the ADR removes.
const OUT_PATHS = [
  join(REPO_ROOT, "newsletter", "app", "public", "workforce-agents.json"),
];
const SKILLS_OUT_PATH = join(
  REPO_ROOT,
  "workforce",
  "app",
  "public",
  "workforce-skills.json",
);

async function apiGet(path) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`build-agent-manifest: GET ${url} -> HTTP ${res.status}`);
  }
  return res.json();
}

/** Page through GET /agents, then hydrate each slug via GET /agents/{slug}
 *  (the list strips system_prompt + the profile decks to stay lean; the
 *  detail route carries them). */
async function fetchAgentRows() {
  const summaries = [];
  let cursor;
  do {
    const qs = new URLSearchParams({ page_size: "100" });
    if (cursor) qs.set("cursor", cursor);
    const page = await apiGet(`/agents?${qs}`);
    summaries.push(...(page.items ?? []));
    cursor = page.next_cursor;
  } while (cursor);
  if (summaries.length === 0) {
    throw new Error(
      "build-agent-manifest: agents-api returned 0 agents — refusing to ship an empty manifest (C-4)",
    );
  }
  const details = await Promise.all(
    summaries.map((s) => apiGet(`/agents/${encodeURIComponent(s.slug)}`)),
  );
  return details.sort((a, b) => a.slug.localeCompare(b.slug));
}

function toManifestAgent(row) {
  return {
    slug: row.slug,
    first_name: row.first_name,
    last_name: row.last_name,
    residence: row.residence,
    role: row.role,
    model: row.model,
    prompt_version: row.prompt_version,
    // Manifest keeps the pre-6a field name; the row splits default/override.
    budget_monthly_usd: row.budget_monthly_usd_default,
    default_project: row.default_project,
    streams: row.streams,
    bindings: row.bindings,
    created_at: row.created_at,
    // "About" snippet: first prose paragraph of the persona prompt (the
    // former system.md body, now row.system_prompt per ADR-0007).
    about: pickAboutSnippet(row.system_prompt ?? ""),
    // Optional structured profile blocks — JD, OpenClaw IDENTITY, the
    // LinkedIn-style experience track record, and the MEMORY.md analogue.
    // Each is null-safe in the SPA.
    jd: row.jd ?? null,
    identity: row.identity ?? null,
    experience: row.experience ?? null,
    memory: row.memory ?? null,
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

const agentRows = await fetchAgentRows();
const slugs = agentRows.map((r) => r.slug);
const agents = agentRows.map(toManifestAgent);

// Merge org topology (reports_to / lateral) and compute direct_reports
// as the inverse of reports_to. `depth` is derived from the same graph:
// 0 for roots (reports_to=[]), 1 + min(parent depth) otherwise. The edge
// list lives on each agent's META row (ADR-0007 step 6a — formerly
// workforce/agents/_org.json); the derivation is unchanged.
const topology = Object.fromEntries(
  agentRows.map((r) => [r.slug, { reports_to: r.reports_to ?? [], lateral: r.lateral ?? [] }]),
);
const directReports = Object.fromEntries(slugs.map((s) => [s, []]));
for (const [child, edges] of Object.entries(topology)) {
  for (const parent of edges.reports_to ?? []) {
    if (directReports[parent]) directReports[parent].push(child);
  }
}

// W-4 flat-org guard: a roster of >1 agents with ZERO reports_to edges is
// not a plausible org — it means the META rows lost (or never received)
// their org edges, and `?? []` above would silently publish every agent
// as a depth-0 root. computeDepths can't catch this (an all-roots graph
// resolves cleanly), which is exactly how the ADR-0007 step-6a miss
// shipped. Repair path: workforce/scripts/restore-agent-profile-fields.mjs.
// A deliberately flat org can bypass with WF_ALLOW_FLAT_ORG=1.
const reportsToEdgeCount = Object.values(topology).reduce(
  (n, t) => n + (t.reports_to?.length ?? 0),
  0,
);
if (agents.length > 1 && reportsToEdgeCount === 0 && process.env.WF_ALLOW_FLAT_ORG !== "1") {
  throw new Error(
    `build-agent-manifest: ${agents.length} agents but 0 reports_to edges — the agents-api rows are missing their org topology. ` +
      `Refusing to ship a flat org (C-4/W-4). Run workforce/scripts/restore-agent-profile-fields.mjs, ` +
      `or set WF_ALLOW_FLAT_ORG=1 if the flat org is intentional.`,
  );
}

const depths = computeDepths(slugs, topology);

for (const a of agents) {
  const node = topology[a.slug] ?? {};
  a.reports_to = node.reports_to ?? [];
  a.lateral = node.lateral ?? [];
  a.direct_reports = directReports[a.slug] ?? [];
  a.depth = depths[a.slug];
}

function computeDepths(allSlugs, topo) {
  // Forward BFS from roots through reports_to edges, taking min over
  // parents when a slug has more than one. Throws if the graph contains
  // a cycle or an unreachable node — both are W-4 fail-loud cases the
  // operator wants to see immediately.
  const out = {};
  const queue = [];
  for (const s of allSlugs) {
    const parents = topo[s]?.reports_to ?? [];
    if (parents.length === 0) {
      out[s] = 0;
      queue.push(s);
    }
  }
  while (queue.length > 0) {
    const s = queue.shift();
    const myDepth = out[s];
    // Push every child whose parents are all assigned, picking min+1.
    for (const c of directReports[s] ?? []) {
      const parentDepths = (topo[c]?.reports_to ?? []).map((p) => out[p]);
      if (parentDepths.some((d) => d === undefined)) continue;
      const next = Math.min(...parentDepths) + 1;
      if (out[c] === undefined || next < out[c]) {
        out[c] = next;
        queue.push(c);
      }
    }
    void myDepth;
  }
  const unresolved = allSlugs.filter((s) => out[s] === undefined);
  if (unresolved.length > 0) {
    throw new Error(
      `build-agent-manifest: depth unresolved for [${unresolved.join(", ")}] — the META rows' reports_to edges likely contain a cycle or a dangling slug (PATCH the offending agent via agents-api)`,
    );
  }
  return out;
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

// Cap embedded file payloads to ~256 KiB so a stray large blob can't bloat
// workforce-skills.json indefinitely. Anything past the cap shows path + size
// only and the SPA renders a "file too large to preview" placeholder.
const SKILL_FILE_MAX_BYTES = 256 * 1024;

function detectLanguage(path) {
  if (path === "SKILL.md") return "markdown";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs"))
    return "javascript";
  if (path.endsWith(".py")) return "python";
  if (path.endsWith(".sh")) return "shell";
  if (path.endsWith(".yml") || path.endsWith(".yaml")) return "yaml";
  return "text";
}

function isLikelyText(buf) {
  // Heuristic: a NUL byte in the first 4 KiB usually means binary. Skills are
  // expected to be text-only (SKILL.md + meta.json + optional handler) so
  // anything binary is a misconfiguration; surface it via path+size only.
  const probe = buf.subarray(0, Math.min(buf.length, 4096));
  return !probe.includes(0);
}

function walkSkillDir(skillDir) {
  // Recursive walk so future nested skills (e.g. examples/) still surface
  // in the UI. Entries are sorted with SKILL.md first, then alphabetical.
  const out = [];
  function recurse(absDir, relDir) {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const abs = join(absDir, entry.name);
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        recurse(abs, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = statSync(abs);
      const buf = readFileSync(abs);
      const language = detectLanguage(rel);
      const text = isLikelyText(buf);
      const truncated = stat.size > SKILL_FILE_MAX_BYTES;
      out.push({
        path: rel,
        size: stat.size,
        language,
        contents: text && !truncated ? buf.toString("utf8") : null,
        truncated,
        binary: !text,
      });
    }
  }
  recurse(skillDir, "");
  out.sort((a, b) => {
    if (a.path === "SKILL.md") return -1;
    if (b.path === "SKILL.md") return 1;
    return a.path.localeCompare(b.path);
  });
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
    deliverable: meta.deliverable ?? null,
    cost_class: meta.cost_class,
    owners: meta.owners ?? [],
    improvement_agent: meta.improvement_agent ?? null,
    created_at: meta.created_at,
    description: fm.description ?? "",
    files: walkSkillDir(dir),
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
