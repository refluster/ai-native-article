#!/usr/bin/env node
// Deterministic weekly-report publisher — invoked by the CCR agent-runner
// after it has *generated* the report (panel + prose). The LLM owns the
// judgment (body / title / summary / seated authors); this script owns the
// structurally-exact write so the failure class "LLM hand-edits JSON and
// guesses the schema wrong" cannot recur.
//
// It writes TWO objects to the project repo's default branch via the GitHub
// contents API, authenticated with the project-scoped github.token:
//   1. reports/{slug}.md          (create-only — an existing slug is a guard
//                                  failure, which doubles as double-fire
//                                  idempotency)
//   2. reports/manifest.json      (read-modify-write with the blob sha)
//
// Commit = publish: the workforce console reads reports/ at request time
// (agents-api GET /projects/{id}/reports). This is the direct-publish shape
// shared with article-level2/3's publish-notion.mjs, so the same W-1 guard
// family runs here BEFORE any write:
//   G1  body-file readable, frontmatter block present
//   G2  body length (excl. frontmatter + mermaid fences) within [3000, 12000] chars
//   G3  no LLM-failure prelude (refusals / apologies / meta-preambles)
//   G4  not cut off mid-sentence (canonical scripts/lib/truncation.mjs — ML-006)
//   G5  mermaid/code fences balanced (an odd fence count renders the page broken)
//   G6  slug shape ^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$ and date matches the slug prefix
//
// The token is injected per-fire (credentials['github.token'].token); the
// endpoint host is embedded here as the single source of truth. Override with
// GITHUB_API_URL only for GHES/testing.
//
// Usage:
//   GITHUB_TOKEN=<token> node workforce/skills/weekly-project-report/publish-report.mjs \
//     --agent elena --owner PSVL --repo project-ind \
//     --slug 2026-07-28-weekly --title "project-ind 週報 第2号 — …" \
//     --date 2026-07-28 --kind weekly --lang ja \
//     --summary "…" --authors elena,anjali,grace \
//     --body-file /tmp/weekly-project-report-body.md [--skill-version 0.1.0]
//
// Exit codes:
//   0 — published (report + manifest row committed)
//   1 — bad args / env / body-file unreadable
//   2 — guard rejected (G1–G6, slug already exists, or GitHub 4xx)
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
const kind = arg("kind") || "weekly";
const lang = arg("lang") || "ja";
const summary = arg("summary");
const authorsRaw = arg("authors");
const bodyFile = arg("body-file");
const skillVersion = arg("skill-version");

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

// G2 — length bounds on prose (mermaid/code fences excluded).
const prose = body.replace(/```[\s\S]*?```/g, "");
if (prose.length < 3000) fail(2, `G2: body too short (${prose.length} chars excl. fences; floor 3000)`);
if (prose.length > 12000) fail(2, `G2: body too long (${prose.length} chars excl. fences; ceiling 12000)`);

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

const commitMeta = ` (weekly-project-report cadence, agent=${agent}${skillVersion ? `, skill v${skillVersion}` : ""})`;

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

  console.log(`publish-report.mjs: published reports/${slug}.md + manifest row (${owner}/${repo}, ${prose.length} prose chars, authors=${authors.join("/")})`);
  process.exit(0);
} catch (e) {
  if (e && e.code === "ERR_INVALID_ARG_TYPE") fail(3, `unexpected: ${e.message}`);
  fail(3, `network/unexpected error: ${e.message || e}`);
}
