#!/usr/bin/env node
// Deterministic situation-report publisher — invoked by the CCR agent-runner
// after it has *generated* the report (harvest + scan + synthesis + prose).
// The LLM owns the judgment (findings / sources / prose); this script owns the
// structurally-exact write, so "LLM hand-edits JSON and guesses the schema
// wrong" cannot recur.
//
// Adapted from workforce/skills/weekly-project-report/publish-report.mjs — same
// write path (GitHub contents API, project-scoped github.token, report file +
// manifest row), same G1-G6 guard family, with two guards specific to this
// skill that give the SKILL.md review rubric mechanical teeth:
//   G7  citation floor    — >= --min-sources distinct [^n] source markers AND a
//                           出典 section. (Rubric L2: every fact carries a source.)
//   G8  implication floor — >= --min-implications 産業への含意 blocks.
//                           (Rubric L3: the reader is an industry executive.)
//
// Length band differs from the weekly: a situation report is [6000, 20000]
// prose chars, not [3000, 12000].
//
// Usage:
//   GITHUB_TOKEN=<token> node workforce/skills/regulatory-situation-report/publish-report.mjs \
//     --agent tessa --owner refluster --repo ai-native-article \
//     --slug 2026-08-27-situation --title "エネルギー規制情勢レポート 2026-08 — …" \
//     --date 2026-08-27 --kind situation --lang ja \
//     --summary "…" --authors tessa,grace,ishaan \
//     --min-sources 40 --min-implications 5 \
//     --body-file /tmp/regulatory-situation-report-body.md [--skill-version 0.1.0]
//
// Exit codes:
//   0 — published (report + manifest row committed)
//   1 — bad args / env / body-file unreadable
//   2 — guard rejected (G1-G8, slug already exists, or GitHub 4xx)
//   3 — network / unexpected error

import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { readFileSync } from "node:fs";
import { isTruncatedMarkdown, stripFrontmatter } from "../../../scripts/lib/truncation.mjs";

const DEFAULT_API_URL = "https://api.github.com";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const apiUrl = (process.env.GITHUB_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
const token = process.env.GITHUB_TOKEN;
const agent = arg("agent");
const owner = arg("owner");
const repo = arg("repo");
const slug = arg("slug");
const title = arg("title");
const date = arg("date");
const kind = arg("kind") || "situation";
const lang = arg("lang") || "ja";
const summary = arg("summary");
const authorsRaw = arg("authors");
const bodyFile = arg("body-file");
const skillVersion = arg("skill-version");
const minSources = Number(arg("min-sources") ?? 40);
const minImplications = Number(arg("min-implications") ?? 5);

function fail(code, msg) {
  console.error(`publish-report.mjs: ${msg}`);
  process.exit(code);
}

if (!token) fail(1, "GITHUB_TOKEN env var is required (from credentials['github.token'].token)");
for (const [k, v] of Object.entries({ agent, owner, repo, slug, title, date, summary, authors: authorsRaw, "body-file": bodyFile })) {
  if (!v) fail(1, `--${k} is required`);
}

// G6 — slug + date coherence (also blocks path traversal by construction).
if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(slug)) fail(2, `G6: slug "${slug}" must match YYYY-MM-DD-<kebab>`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(2, `G6: date "${date}" must be YYYY-MM-DD`);
if (!slug.startsWith(date)) fail(2, `G6: slug "${slug}" must start with date "${date}"`);

let raw;
try {
  raw = readFileSync(bodyFile, "utf8");
} catch (e) {
  fail(1, `G1: body-file unreadable: ${e.message}`);
}

// G1 — frontmatter present (the console viewer strips it; its absence means
// the LLM wrote a fragment, not the contracted document).
if (!/^---\n[\s\S]*?\n---\n/.test(raw)) fail(2, "G1: leading YAML frontmatter block is missing");

const body = stripFrontmatter(raw);

// G5 — balanced fences BEFORE the length math (an odd count corrupts G2 too).
const fenceCount = (body.match(/^```/gm) || []).length;
if (fenceCount % 2 !== 0) fail(2, `G5: unbalanced code fences (${fenceCount} markers)`);

// G2 — length bounds on prose (mermaid/code fences excluded). A situation
// report is longer than a weekly: it carries per-region tables and a source list.
const prose = body.replace(/```[\s\S]*?```/g, "");
if (prose.length < 6000) fail(2, `G2: body too short (${prose.length} chars excl. fences; floor 6000)`);
if (prose.length > 20000) fail(2, `G2: body too long (${prose.length} chars excl. fences; ceiling 20000)`);

// G3 — LLM-failure preludes.
const PRELUDES = [
  /^\s*(i('|’)?m sorry|i apologi[sz]e|as an ai\b|i cannot|sure[,!]|here (is|'s) (the|your))/i,
  /^\s*(申し訳|すみません|承知(しました|いたしました)|かしこまりました|以下(が|に).*(レポート|報告).*(です|します))/,
];
const firstProseLine = prose.split("\n").map(l => l.trim()).find(l => l.length > 0) || "";
for (const re of PRELUDES) {
  if (re.test(firstProseLine)) fail(2, `G3: LLM-failure prelude detected: "${firstProseLine.slice(0, 60)}"`);
}

// G4 — canonical cut-off heuristic (ML-006 lineage).
if (isTruncatedMarkdown(prose)) fail(2, "G4: body looks cut off mid-sentence (canonical truncation heuristic)");

// G7 — citation floor (rubric L2 with teeth). The report's whole claim is that
// every load-bearing fact is traceable; below the floor it is not. Counts
// DISTINCT markers, so one source cited ten times does not inflate the count.
if (!Number.isFinite(minSources) || minSources < 1) fail(1, "--min-sources must be a positive integer");
const sourceMarkers = new Set((prose.match(/\[\^[^\]]{1,32}\]/g) || []));
if (sourceMarkers.size < minSources) {
  fail(2, `G7: only ${sourceMarkers.size} distinct source markers ([^n]); floor ${minSources}. Resolve sources before publishing (SKILL.md phase 6 / rubric L2).`);
}
if (!/出典/.test(prose)) fail(2, "G7: no 出典 section found — the numbered markers need a resolvable list (SKILL.md phase 7 step 7)");

// G8 — implication floor (rubric L3 with teeth). A section with no 産業への含意
// has no value as situation for this audience; the floor forces the author to
// find one or cut the section.
if (!Number.isFinite(minImplications) || minImplications < 1) fail(1, "--min-implications must be a positive integer");
const implications = (prose.match(/産業への含意/g) || []).length;
if (implications < minImplications) {
  fail(2, `G8: only ${implications} 産業への含意 blocks; floor ${minImplications}. The reader is an industry executive, not a policy specialist (rubric L3).`);
}

const authors = authorsRaw.split(",").map(s => s.trim()).filter(Boolean);
if (authors.length === 0) fail(1, "--authors must contain at least one slug");

// ---- GitHub contents API helpers ------------------------------------------

const ghHeaders = {
  authorization: `Bearer ${token}`,
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "content-type": "application/json",
};

async function gh(method, path, bodyObj) {
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: ghHeaders,
    body: bodyObj === undefined ? undefined : JSON.stringify(bodyObj),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { status: res.status, json };
}

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s) => Buffer.from(s, "base64").toString("utf8");

const commitMeta = ` (regulatory-situation-report cadence, agent=${agent}${skillVersion ? `, skill v${skillVersion}` : ""})`;

try {
  // Idempotency: create-only for the report file.
  const reportPath = `/repos/${owner}/${repo}/contents/reports/${slug}.md`;
  const existing = await gh("GET", reportPath);
  if (existing.status === 200) fail(2, `slug already exists: reports/${slug}.md (double fire? skip instead)`);
  if (existing.status !== 404) fail(2, `GitHub GET report ${existing.status}: ${JSON.stringify(existing.json).slice(0, 200)}`);

  // Manifest read-modify-write.
  const manifestPath = `/repos/${owner}/${repo}/contents/reports/manifest.json`;
  const mf = await gh("GET", manifestPath);
  if (mf.status !== 200) fail(2, `GitHub GET manifest ${mf.status} — a project must carry reports/manifest.json before its first cadence fire`);
  let rows;
  try {
    rows = JSON.parse(unb64(mf.json.content));
  } catch {
    fail(2, "manifest.json is not valid JSON — refusing to overwrite a broken manifest (fix it first)");
  }
  if (!Array.isArray(rows)) fail(2, "manifest.json is not an array");
  if (rows.some(r => r && r.slug === slug)) fail(2, `manifest already has a row for slug ${slug}`);

  // 1) report file (create).
  const put1 = await gh("PUT", reportPath, {
    message: `reports: ${title}${commitMeta}`,
    content: b64(raw),
  });
  if (put1.status !== 201) fail(2, `GitHub PUT report ${put1.status}: ${JSON.stringify(put1.json).slice(0, 300)}`);

  // 2) manifest row (newest first; date desc, slug asc tiebreak — the
  //    console re-sorts anyway, but a sorted file diffs cleanly).
  rows.push({ slug, title, date, kind, lang, summary, authors });
  rows.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (a.slug || "").localeCompare(b.slug || ""));
  const put2 = await gh("PUT", manifestPath, {
    message: `reports: manifest row for ${slug}${commitMeta}`,
    content: b64(JSON.stringify(rows, null, 2) + "\n"),
    sha: mf.json.sha,
  });
  if (put2.status !== 200 && put2.status !== 201) {
    // The report file is already committed; a manifest failure must be LOUD —
    // an unlisted report is invisible on the console (silent degrade).
    fail(2, `GitHub PUT manifest ${put2.status} AFTER the report committed — manifest row for ${slug} must be added manually: ${JSON.stringify(put2.json).slice(0, 300)}`);
  }

  console.log(`publish-report.mjs: published reports/${slug}.md + manifest row (${owner}/${repo}, ${prose.length} prose chars, ${sourceMarkers.size} sources, ${implications} implication blocks, authors=${authors.join("/")})`);
  process.exit(0);
} catch (e) {
  if (e && e.code === "ERR_INVALID_ARG_TYPE") fail(3, `unexpected: ${e.message}`);
  fail(3, `network/unexpected error: ${e.message || e}`);
}
