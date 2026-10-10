#!/usr/bin/env node
// project-brief-pr/open-pr.mjs — deterministic write for the
// "project-brief-pr" Cadence, invoked by the CCR agent-runner AFTER the
// LLM has generated the brief body. The LLM owns the judgment (the analysis,
// the structure, the framing); this script owns the structurally-exact write,
// so the failure class "LLM hand-rolls a GitHub API call and guesses headers
// or pagination wrong" cannot recur.
//
// This script is the first consumer of the workforce API's
// POST /agents/{slug}/open-external-pr endpoint (Phase 7 PR6). It calls the
// Lambda — not GitHub directly — so the CCR session NEVER holds a GitHub
// credential. The Lambda resolves the project's github.token from Secrets
// Manager using the Epic-010 project-scoped path, R-N9 compliant.
//
// Auth model:
//   ENGAGEMENT_WRITE_TOKEN — the per-fire token the orchestrator mints in DDB
//   and injects into every CCR task's credentials bag as
//   credentials['engagement_write_token']. The same token that authorises
//   POST /agents/{slug}/engagements authorises POST /agents/{slug}/open-external-pr.
//   External (non-orchestrator) callers use the static fallback token from
//   wf/api/engagements-write-token; same env var name either way.
//
// Usage:
//   ENGAGEMENT_WRITE_TOKEN="<credentials['engagement_write_token']>" \
//     node workforce/skills/project-brief-pr/open-pr.mjs \
//       --agent nadia \
//       --project asp-cloud \
//       --run-id <ULID or UUID> \
//       --path docs/briefs/2026-10-10-brief.md \
//       --body-file /tmp/project-brief-pr-nadia-<run_id>.md \
//       [--api-base https://workforce-api.kohuehara.xyz] \
//       [--dry-run]
//
// Exit codes:
//   0 — PR opened; outputs "pr_url=<url>  pr_number=<n>  branch=<name>" on stdout
//   1 — bad args / env / body-file unreadable
//   2 — guard rejected (G1–G6: empty/short body, LLM-failure prelude, cut-off,
//       malformed path, malformed --agent / --run-id) or API returned a hard 4xx (invalid_field, agent_not_found,
//       project_not_found, credential_not_provisioned)
//   3 — network / unexpected error / 5xx from the workforce API

import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { readFileSync } from "node:fs";
import { isTruncatedMarkdown } from "../../../scripts/lib/truncation.mjs";

const DEFAULT_API_BASE = "https://workforce-api.kohuehara.xyz";

// G2 bounds. The floor catches a brief that is really a stub; the ceiling is
// a practical cap so a runaway generation doesn't push a giant PR body
// (GitHub's PR body limit is 65536 chars).
const BODY_MIN = 500;
const BODY_MAX = 8000;

// Mirrors SAFE_IDENT in workforce/lambdas/agents-api/handler.ts. agent and
// run-id become the URL path and the deterministic branch name
// (workforce/{agent}/{run_id}); a bad value is caught here as exit 2 rather
// than costing a round-trip that ends in a 400.
const SAFE_IDENT = /^[A-Za-z0-9_-]{1,64}$/;

// G4 — LLM-failure preludes. Matched against the first non-blank, non-heading
// line so a title + prelude (e.g. "# Brief\n\nSure! Here is...") is caught.
const PRELUDES = [
  /^\s*(i('|')?m sorry|i apologi[sz]e|as an ai\b|i cannot|sure[,!]|here (is|'s) (the|your))/i,
  /^\s*(申し訳|すみません|承知(しました|いたしました)|かしこまりました|以下(が|に).*(資料|ブリーフ|概要).*(です|します))/,
];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
const flag = (n) => process.argv.includes(`--${n}`);

function fail(code, msg) {
  console.error(`open-pr.mjs: ${msg}`);
  process.exit(code);
}

const agentSlug = arg("agent");
const projectId = arg("project");
const runId = arg("run-id");
const filePath = arg("path");
const bodyFile = arg("body-file");
const apiBase = (arg("api-base") || process.env.WORKFORCE_AGENTS_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, "");
const dryRun = flag("dry-run");

for (const [k, v] of Object.entries({ agent: agentSlug, project: projectId, "run-id": runId, path: filePath, "body-file": bodyFile })) {
  if (!v) fail(1, `--${k} is required`);
}

// ── G6 — identifier safety (before the dry-run exit) ─────────────────────────
if (!SAFE_IDENT.test(agentSlug)) fail(2, `G6: --agent "${agentSlug}" must match ${SAFE_IDENT}`);
if (!SAFE_IDENT.test(runId)) fail(2, `G6: --run-id "${runId}" must match ${SAFE_IDENT}`);

const token = process.env.ENGAGEMENT_WRITE_TOKEN;
if (!dryRun && !token) fail(1, "ENGAGEMENT_WRITE_TOKEN env var is required (from credentials['engagement_write_token'])");

// ── Read body ────────────────────────────────────────────────────────────────
let body;
try {
  body = readFileSync(bodyFile, "utf8");
} catch (e) {
  fail(1, `could not read --body-file "${bodyFile}": ${e.message}`);
}

// ── G1 — non-empty ───────────────────────────────────────────────────────────
if (!body || body.trim().length === 0) fail(2, "G1: body is empty");

// ── G2 — length band ─────────────────────────────────────────────────────────
const trimmed = body.trim();
if (trimmed.length < BODY_MIN) fail(2, `G2: body too short (${trimmed.length} chars; floor ${BODY_MIN})`);
if (trimmed.length > BODY_MAX) fail(2, `G2: body too long (${trimmed.length} chars; ceiling ${BODY_MAX})`);

// ── G4 — LLM-failure prelude ─────────────────────────────────────────────────
const firstProseLine = body.split("\n").map((l) => l.trim()).find((l) => l.length > 0 && !l.startsWith("#")) || "";
for (const re of PRELUDES) {
  if (re.test(firstProseLine)) fail(2, `G4: LLM-failure prelude detected: "${firstProseLine.slice(0, 60)}"`);
}

// ── G5 — cut-off (ML-006 / canonical truncation heuristic) ───────────────────
if (isTruncatedMarkdown(body)) fail(2, "G5: body looks cut off mid-sentence (canonical truncation heuristic)");

// ── G3 — path safety (mirrors the Lambda's own A1 guard) ─────────────────────
// The Lambda will also reject these, but catching them here gives a cleaner
// exit-2 rather than a network round-trip that ends in a 400.
if (
  !filePath ||
  filePath.startsWith("/") ||
  filePath.split("/").some((seg) => seg === ".." || seg === ".git" || seg === ".github")
) {
  fail(2, `G3: --path "${filePath}" must be a relative path with no .. / .git / .github segments`);
}

console.log(`open-pr.mjs: guards passed (${trimmed.length} chars, path="${filePath}", agent=${agentSlug}, project=${projectId})`);
if (dryRun) {
  console.log("open-pr.mjs: --dry-run — stopping before the API call");
  process.exit(0);
}

// ── Call POST /agents/{slug}/open-external-pr ────────────────────────────────
const url = `${apiBase}/agents/${encodeURIComponent(agentSlug)}/open-external-pr`;
let res;
try {
  res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      project_id: projectId,
      skill_name: "project-brief-pr",
      run_id: runId,
      path: filePath,
      body,
    }),
  });
} catch (e) {
  fail(3, `network error calling ${url}: ${e.message}`);
}

let json;
try {
  json = await res.json();
} catch {
  fail(3, `could not parse response from ${url} (status ${res.status})`);
}

if (res.status === 201) {
  // W-4 read-back: verify the shape the Lambda promised. The response carries
  // pr_url, pr_number, and branch_name. A missing field means the Lambda
  // returned a malformed 201 — surface it loudly (C-4).
  if (typeof json.pr_url !== "string" || typeof json.pr_number !== "number" || typeof json.branch_name !== "string") {
    fail(3, `workforce API returned 201 but response is malformed: ${JSON.stringify(json).slice(0, 300)}`);
  }
  console.log(`open-pr.mjs: opened draft PR #${json.pr_number} ${json.pr_url} (branch=${json.branch_name})`);
  process.exit(0);
}

// Map known 4xx to exit 2 (caller misconfiguration / guard failures)
const HARD_4XX = new Set([400, 401, 404, 422, 424]);
if (HARD_4XX.has(res.status)) {
  const detail = json.error ?? json.detail ?? JSON.stringify(json).slice(0, 300);
  fail(2, `workforce API returned ${res.status}: ${detail}`);
}

// 5xx and unexpected codes → exit 3
fail(3, `workforce API returned ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
