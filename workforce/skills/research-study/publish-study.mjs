#!/usr/bin/env node
// Deterministic study publisher — invoked by the research lead session after
// the twelve stages of `research-study` have produced the study directory.
// The LLM owns the judgment (brief / hypotheses / sources / prose); this script
// owns the structurally-exact write: it re-runs the W-1 guard family and the
// study-specific gates, pushes the study directory to a NEW branch through the
// GitHub Git Data API, and opens a DRAFT pull request carrying `autopilot:off`.
// It never commits to the base branch (R-N9: the external git surface is
// PR-only; the `conference` project is draft-only — the operator alone acts).
//
// Adapted from workforce/skills/regulatory-situation-report/publish-report.mjs
// (same G1–G5 family) with study gates G6–G10 that give the SKILL.md stage
// table mechanical teeth.
//
// Usage:
//   GITHUB_TOKEN=<token> node workforce/skills/research-study/publish-study.mjs \
//     --agent beatriz --owner refluster --repo conference \
//     --dir /path/to/research/202609-ieej-california-der \
//     --path research/202609-ieej-california-der \
//     --base main --branch workforce/research-study/202609-ieej-california-der \
//     --title "content: 米国カリフォルニア州等 … 調査報告書 (research-study v0.1.0)" \
//     --authors beatriz,amara,grace,sneha,sofia,owen,rafael,ingrid,aoi,nadia \
//     [--min-sources 40] [--min-chars 20000] [--max-chars 200000] \
//     [--skill-version 0.1.0] [--dry-run]
//
// Exit codes:
//   0 — published (branch pushed + draft PR opened), or dry-run passed
//   1 — bad args / env / unreadable study directory
//   2 — guard rejected (G1–G10, branch already exists, or GitHub 4xx)
//   3 — network / unexpected error

import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, posix, sep } from "node:path";
import { isTruncatedMarkdown } from "../../../scripts/lib/truncation.mjs";

const DEFAULT_API_URL = "https://api.github.com";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
const flag = (name) => process.argv.includes(`--${name}`);

const apiUrl = (process.env.GITHUB_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
const token = process.env.GITHUB_TOKEN;
const agent = arg("agent");
const owner = arg("owner");
const repo = arg("repo");
const dir = arg("dir");
const repoPath = (arg("path") || "").replace(/^\/+|\/+$/g, "");
const base = arg("base") || "main";
const branch = arg("branch");
const title = arg("title");
const authorsRaw = arg("authors");
const skillVersion = arg("skill-version");
const minSources = Number(arg("min-sources") ?? 40);
const minChars = Number(arg("min-chars") ?? 20000);
const maxChars = Number(arg("max-chars") ?? 200000);
const dryRun = flag("dry-run");

function fail(code, msg) {
  console.error(`publish-study.mjs: ${msg}`);
  process.exit(code);
}

for (const [k, v] of Object.entries({ agent, owner, repo, dir, path: repoPath, branch, title, authors: authorsRaw })) {
  if (!v) fail(1, `--${k} is required`);
}
if (!dryRun && !token) fail(1, "GITHUB_TOKEN env var is required (from credentials['github.token'].token)");
if (!/^research\/\d{6}-[a-z0-9-]+$/.test(repoPath)) fail(2, `--path "${repoPath}" must match research/YYYYMM-<kebab>`);
if (!/^[A-Za-z0-9._\/-]+$/.test(branch) || branch === base) fail(2, `--branch "${branch}" is not a valid non-base branch name`);
if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(1, `--dir "${dir}" is not a directory`);

const read = (rel) => {
  const p = join(dir, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};

// ---- G9 — artefact floor: every stage left its file ---------------------
const REQUIRED = [
  ["brief.md", 800],
  ["issue-tree.md", 800],
  ["workplan.md", 500],
  ["sources/register.md", 800],
  ["storyline.md", 800],
  ["report.md", minChars],
  ["review/factcheck.md", 500],
  ["review/panel-r1.md", 800],
  ["retro.md", 400],
];
for (const [rel, floor] of REQUIRED) {
  const t = read(rel);
  if (t === null) fail(2, `G9: missing stage artefact ${rel}`);
  if (t.replace(/```[\s\S]*?```/g, "").trim().length < floor) fail(2, `G9: ${rel} is trivial (< ${floor} chars) — the stage was not really run`);
}

const raw = read("report.md");

// ---- G1 — metadata block (the report's front matter is a bullet list under the H1) ----
if (!/^#\s+.+\n(?:\s*\n)?(?:- \*\*[^*]+\*\*:.*\n){4,}/m.test(raw)) {
  fail(2, "G1: report.md lacks the metadata block (H1 followed by ≥4 `- **key**: value` lines)");
}

// ---- G5 — balanced fences BEFORE the length math --------------------------
const fenceCount = (raw.match(/^```/gm) || []).length;
if (fenceCount % 2 !== 0) fail(2, `G5: unbalanced code fences (${fenceCount} markers)`);

// ---- G2 — length band on prose -------------------------------------------
const prose = raw.replace(/```[\s\S]*?```/g, "");
if (prose.length < minChars) fail(2, `G2: report too short (${prose.length} chars excl. fences; floor ${minChars})`);
if (prose.length > maxChars) fail(2, `G2: report too long (${prose.length} chars excl. fences; ceiling ${maxChars})`);

// ---- G3 — LLM-failure preludes -------------------------------------------
const PRELUDES = [
  /^\s*(i('|’)?m sorry|i apologi[sz]e|as an ai\b|i cannot|sure[,!]|here (is|'s) (the|your))/i,
  /^\s*(申し訳|すみません|承知(しました|いたしました)|かしこまりました|以下(が|に).*(レポート|報告).*(です|します))/,
];
const firstProseLine = prose.split("\n").map((l) => l.trim()).find((l) => l.length > 0 && !l.startsWith("#")) || "";
for (const re of PRELUDES) {
  if (re.test(firstProseLine)) fail(2, `G3: LLM-failure prelude detected: "${firstProseLine.slice(0, 60)}"`);
}

// ---- G4 — cut-off heuristic (ML-006 lineage) ------------------------------
if (isTruncatedMarkdown(prose)) fail(2, "G4: report looks cut off mid-sentence (canonical truncation heuristic)");

// ---- G6 — required sections ----------------------------------------------
const REQUIRED_HEADINGS = [
  [/^##\s+目次/m, "目次"],
  [/^##\s+エグゼクティブ・サマリ/m, "エグゼクティブ・サマリ"],
  [/^##+\s+.*限界/m, "本調査の限界"],
  [/^##+\s+.*用語集/m, "用語集"],
  [/^##+\s+.*(情報源一覧|出典一覧)/m, "情報源一覧"],
];
for (const [re, label] of REQUIRED_HEADINGS) {
  if (!re.test(prose)) fail(2, `G6: required section missing: ${label}`);
}

// ---- G7 — citation floor: distinct [S-x.y] markers, each resolving --------
const cited = new Set(prose.match(/\[S-\d+\.\d+\]/g) || []);
if (cited.size < minSources) {
  fail(2, `G7: only ${cited.size} distinct [S-x.y] markers in report.md; floor ${minSources}. Resolve sources before publishing (stage S3/S6).`);
}
const register = read("sources/register.md") + "\n" + prose;
const defined = new Set((register.match(/\bS-\d+\.\d+\b/g) || []).map((s) => `[${s}]`));
const unresolved = [...cited].filter((c) => !defined.has(c));
if (unresolved.length) fail(2, `G7: ${unresolved.length} citation(s) do not resolve to a register row: ${unresolved.slice(0, 8).join(" ")}`);

// ---- G8 — verdict floor: every hypothesis carries 判定 + 確度 --------------
const tree = read("issue-tree.md");
const hyps = [...new Set(tree.match(/\bH-\d+\.\d+\b/g) || [])];
if (hyps.length === 0) fail(2, "G8: issue-tree.md defines no H-x.y hypothesis IDs");
const VERDICT = /(支持|一部支持|不支持|未検証)/;
const CONF = /確度[:：]?\s*(高|中|低)|\|\s*(高|中|低)\s*\|/;
const missing = [];
for (const h of hyps) {
  const rows = prose.split("\n").filter((l) => l.includes(h));
  const ok = rows.some((l) => VERDICT.test(l) && CONF.test(l));
  if (!ok) missing.push(h);
}
if (missing.length) fail(2, `G8: ${missing.length} hypothesis(es) lack a line carrying both 判定 and 確度 in report.md: ${missing.slice(0, 8).join(" ")}`);

// ---- G10 — built HTML present and not older than the source ----------------
const htmlPath = join(dir, "report.html");
if (!existsSync(htmlPath)) fail(2, "G10: report.html is missing — run the repo's build-html script (stage S10)");
if (statSync(htmlPath).mtimeMs + 1000 < statSync(join(dir, "report.md")).mtimeMs) fail(2, "G10: report.html is older than report.md — rebuild before publishing");

const authors = authorsRaw.split(",").map((s) => s.trim()).filter(Boolean);
if (authors.length === 0) fail(1, "--authors must contain at least one slug");

console.log(`publish-study.mjs: guards passed (${prose.length} prose chars, ${cited.size} sources, ${hyps.length} hypotheses, ${authors.length} authors)`);
if (dryRun) {
  console.log("publish-study.mjs: --dry-run — stopping before the push");
  process.exit(0);
}

// ---- GitHub Git Data API --------------------------------------------------
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

// Files to ship: everything under --dir except build caches and the node
// modules a local build might have left. Binary files (png/jpg/pdf) go as
// base64 blobs; text as utf-8.
const SKIP = new Set(["node_modules", ".DS_Store"]);
function walk(root) {
  const out = [];
  for (const name of readdirSync(root)) {
    if (SKIP.has(name)) continue;
    const p = join(root, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
const files = walk(dir);
if (files.length === 0) fail(1, "study directory is empty");

const commitMeta = ` (research-study, agent=${agent}${skillVersion ? `, skill v${skillVersion}` : ""})`;

try {
  // Refuse to reuse a branch: a second publish is a new branch, never a force.
  const ref = await gh("GET", `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  if (ref.status === 200) fail(2, `branch already exists: ${branch} (pick a new --branch; never force-push a study)`);
  if (ref.status !== 404) fail(2, `GitHub GET ref ${ref.status}: ${JSON.stringify(ref.json).slice(0, 200)}`);

  const baseRef = await gh("GET", `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`);
  if (baseRef.status !== 200) fail(2, `GitHub GET base ref ${baseRef.status}: base branch "${base}" not found`);
  const baseSha = baseRef.json.object.sha;
  const baseCommit = await gh("GET", `/repos/${owner}/${repo}/git/commits/${baseSha}`);
  if (baseCommit.status !== 200) fail(2, `GitHub GET base commit ${baseCommit.status}`);
  const baseTree = baseCommit.json.tree.sha;

  const treeEntries = [];
  for (const f of files) {
    const rel = relative(dir, f).split(sep).join(posix.sep);
    const buf = readFileSync(f);
    const isText = /\.(md|json|csv|svg|html|txt|mjs|js|css|yml|yaml)$/i.test(rel);
    const blob = await gh("POST", `/repos/${owner}/${repo}/git/blobs`, isText
      ? { content: buf.toString("utf8"), encoding: "utf-8" }
      : { content: buf.toString("base64"), encoding: "base64" });
    if (blob.status !== 201) fail(2, `GitHub POST blob ${blob.status} for ${rel}: ${JSON.stringify(blob.json).slice(0, 200)}`);
    treeEntries.push({ path: `${repoPath}/${rel}`, mode: "100644", type: "blob", sha: blob.json.sha });
  }

  const tree = await gh("POST", `/repos/${owner}/${repo}/git/trees`, { base_tree: baseTree, tree: treeEntries });
  if (tree.status !== 201) fail(2, `GitHub POST tree ${tree.status}: ${JSON.stringify(tree.json).slice(0, 300)}`);

  const commit = await gh("POST", `/repos/${owner}/${repo}/git/commits`, {
    message: `${title}${commitMeta}\n\nStage artefacts: ${REQUIRED.map(([r]) => r).join(", ")}\nAuthors (personas): ${authors.join(", ")}`,
    tree: tree.json.sha,
    parents: [baseSha],
  });
  if (commit.status !== 201) fail(2, `GitHub POST commit ${commit.status}: ${JSON.stringify(commit.json).slice(0, 300)}`);

  const newRef = await gh("POST", `/repos/${owner}/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.json.sha });
  if (newRef.status !== 201) fail(2, `GitHub POST ref ${newRef.status}: ${JSON.stringify(newRef.json).slice(0, 300)}`);

  const body = [
    `## Summary`,
    ``,
    `- Research study delivered by the workforce \`research-study\` skill${skillVersion ? ` v${skillVersion}` : ""} (lead: \`${agent}\`; seated: ${authors.map((a) => `\`${a}\``).join(", ")}).`,
    `- Study directory: \`${repoPath}/\` — brief → issue tree → workplan → fact packs → storyline → report (+ HTML) → fact-check → panel → retro.`,
    `- Guards passed at publish: ${prose.length} prose chars, ${cited.size} distinct sources, ${hyps.length} hypotheses with verdicts.`,
    ``,
    `## Posture`,
    ``,
    `Draft, \`autopilot:off\`. Execution was operator-orchestrated persona role-play; the report does not replace operator review. The operator alone sends anything to the client.`,
    ``,
    `---`,
    `_Generated by [Claude Code](https://claude.ai/code)_`,
  ].join("\n");
  const pr = await gh("POST", `/repos/${owner}/${repo}/pulls`, { title, head: branch, base, body, draft: true });
  if (pr.status !== 201) fail(2, `GitHub POST pull ${pr.status} AFTER the branch was pushed — open the PR by hand from ${branch}: ${JSON.stringify(pr.json).slice(0, 300)}`);

  // Best-effort label; a missing label must not fail a published study.
  const lab = await gh("POST", `/repos/${owner}/${repo}/issues/${pr.json.number}/labels`, { labels: ["autopilot:off"] });
  if (lab.status !== 200 && lab.status !== 201) console.error(`publish-study.mjs: WARN could not add autopilot:off (${lab.status}) — add it by hand`);

  console.log(`publish-study.mjs: opened draft PR #${pr.json.number} ${pr.json.html_url} (${files.length} files on ${branch})`);
  process.exit(0);
} catch (e) {
  fail(3, `network/unexpected error: ${e.message || e}`);
}
