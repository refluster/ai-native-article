#!/usr/bin/env node
// budget-runway-review/post.mjs — deterministic write for the
// "budget-runway-review" Cadence (Epic-021 §A.2, issue #456), invoked by the
// CCR agent-runner AFTER it has *generated* the review. The LLM owns the
// judgment (the utilisation read and the cap recommendation); this script owns
// the structurally-exact write, so "LLM hand-edits JSON and guesses the schema
// wrong" cannot recur. Modeled on workforce/skills/org-metrics-pulse/post.mjs —
// the canonical internal-periodic-note Cadence write.
//
// Surface choice (why the feed and not Notion / reports/):
//   - The unified Articles DB is the PUBLIC surface: newsletter/pipeline/
//     fetch-notion.mjs exports every Articles-DB row to kohuehara.xyz, so an
//     internal spend artefact must not land there.
//   - reports/{slug}.md (weekly-project-report) commits to the target repo's
//     DEFAULT BRANCH. For project agent-workforce the target IS this repo,
//     whose root CLAUDE.md is PR-only — a Cadence must not push main.
//   - The workforce feed is the established internal-periodic surface
//     (attention-ledger, org-metrics-pulse, skill-maturity-report) and its
//     post_id is a stable citable link for the Epic-021 §A.1 investor letter,
//     which must CITE this review rather than re-derive its figures.
//
// It POSTs to the authenticated feed endpoint with the project-scoped
// credential injected per-fire (credentials['workforce.feed_write_token']).
// The script does NOT touch the repo and does NOT open a PR.
//
// GUARDS (all run BEFORE any network call; a degraded review fails loud):
//   G1  --body-file readable and non-empty
//   G2  body length within [600, 2000] chars — a review below the floor is not
//       a reconciliation model; 2000 is the feed endpoint's hard cap
//   G3  no LLM-failure prelude in the first 50 chars
//   G4  not cut off mid-sentence (canonical scripts/lib/truncation.mjs, ML-006)
//   G5  --sources non-empty and every entry citation-shaped (URL or repo path).
//       Epic-021 mandates "empty citations → exit 2": a spend figure with no
//       source is the failure this Cadence exists to prevent.
//   G6  --cap-usd is a positive number AND --cap-source is citation-shaped.
//       The cap is NEVER hard-coded here: Epic-021 §A.2 says "$250 per team"
//       while workforce/docs/governance.md W-3 says "USD 500/month combined".
//       Which figure is live is an operator fact, so the script refuses a cap
//       that does not arrive with the document it was read from.
//   G7  the standing no-revenue/no-investor disclosure is present in the body
//       (silas's phantom-financials guard, mechanised rather than trusted).
//
// Usage:
//   FEED_WRITE_TOKEN=<from credentials['workforce.feed_write_token']> \
//     node workforce/skills/budget-runway-review/post.mjs \
//       --agent silas \
//       --body-file /tmp/budget-runway-review.md \
//       --cap-usd 500 \
//       --cap-source "workforce/docs/governance.md#w-3" \
//       --sources "https://workforce-api.kohuehara.xyz/stats,workforce/docs/governance.md#w-3" \
//       [--skill-version 0.1.0]
//
// Exit codes:
//   0  — written (HTTP 2xx)
//   1  — bad args / env / body-file unreadable
//   2  — guard rejected (G2–G7) or endpoint rejected (HTTP 401 auth / 422)
//   3  — network / unexpected error

import { readFileSync } from "node:fs";
import { isTruncatedMarkdown } from "../../../scripts/lib/truncation.mjs";

// Single source of truth for this Cadence's write endpoint. Override with
// FEED_WRITE_TOKEN_API_URL only for non-prod / dev stages.
const DEFAULT_API_URL = "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod/feed";

// G2 bounds. The ceiling mirrors the feed endpoint's server-side hard cap; the
// floor is this Cadence's own — a monthly reconciliation model shorter than
// this is a status line, not a review.
const BODY_MIN = 600;
const BODY_MAX = 2000;

// G7 — the standing disclosure every finance artefact carries (Epic-021 §A.1,
// silas's phantom-financials guard). Matched case-insensitively, whitespace
// collapsed, so the persona may punctuate the sentence around it.
const DISCLOSURE = "no revenue, no investors, and no external funding";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function fail(code, msg) {
  console.error(`post.mjs: ${msg}`);
  process.exit(code);
}

// A citation is either an absolute URL or a repo-relative path (optionally with
// a #anchor). Deliberately strict about the two shapes the review actually
// cites, so "Epic-016 data" — a claim, not a source — cannot pass.
const CITATION = /^(https?:\/\/\S+|[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+(?:#[A-Za-z0-9._-]+)?)$/;

const apiUrl = process.env["FEED_WRITE_TOKEN_API_URL"] || DEFAULT_API_URL;
const token = process.env["FEED_WRITE_TOKEN"];
const agent = arg("agent");
const bodyFile = arg("body-file");
const capUsdRaw = arg("cap-usd");
const capSource = arg("cap-source");
const sourcesRaw = arg("sources");
const skillVersion = arg("skill-version");

if (!token) fail(1, "FEED_WRITE_TOKEN env var is required (from credentials['workforce.feed_write_token'])");
if (!agent) fail(1, "--agent <slug> is required");
if (!bodyFile) fail(1, "--body-file <path> is required");
if (capUsdRaw === undefined) fail(1, "--cap-usd <number> is required");
if (!capSource) fail(1, "--cap-source <url-or-repo-path> is required");
if (!sourcesRaw) fail(1, "--sources <comma-separated> is required");

// ── G6 — cap provenance ─────────────────────────────────────────────────────
const capUsd = Number(capUsdRaw);
if (!Number.isFinite(capUsd) || capUsd <= 0) {
  fail(2, `G6: --cap-usd "${capUsdRaw}" must be a positive number`);
}
if (!CITATION.test(capSource)) {
  fail(2, `G6: --cap-source "${capSource}" must be a URL or a repo path (the cap is never asserted without the document it was read from)`);
}

// ── G5 — mandatory citations ────────────────────────────────────────────────
const sources = sourcesRaw.split(",").map((s) => s.trim()).filter(Boolean);
if (sources.length === 0) fail(2, "G5: --sources is empty (every figure in this review must carry a source)");
for (const s of sources) {
  if (!CITATION.test(s)) fail(2, `G5: source "${s}" is not citation-shaped (expected a URL or a repo path)`);
}

// ── G1 — body readable + non-empty ──────────────────────────────────────────
let body;
try {
  body = readFileSync(bodyFile, "utf8");
} catch (err) {
  fail(1, `G1: cannot read --body-file "${bodyFile}": ${err instanceof Error ? err.message : String(err)}`);
}
const trimmed = body.trim();
if (trimmed.length === 0) fail(2, "G1: body is empty");

// ── G3 — LLM-failure prelude ────────────────────────────────────────────────
const ARTEFACTS = ["as an ai", "i apologize", "i'm sorry", "certainly!", "sure, ", "here is the", "here's the"];
const head = trimmed.slice(0, 50).toLowerCase();
if (ARTEFACTS.some((a) => head.startsWith(a))) {
  fail(2, `G3: body opens with an LLM-failure artefact: "${head}"`);
}

// ── G2 — length bounds ──────────────────────────────────────────────────────
if (trimmed.length < BODY_MIN) fail(2, `G2: body too short (${trimmed.length} chars; floor ${BODY_MIN})`);
if (trimmed.length > BODY_MAX) fail(2, `G2: body too long (${trimmed.length} chars; ceiling ${BODY_MAX})`);

// ── G4 — cut off mid-sentence ───────────────────────────────────────────────
if (isTruncatedMarkdown(trimmed)) fail(2, "G4: body looks cut off mid-sentence (canonical truncation heuristic)");

// ── G7 — standing phantom-financials disclosure ─────────────────────────────
const collapsed = trimmed.replace(/\s+/g, " ").toLowerCase();
if (!collapsed.includes(DISCLOSURE)) {
  fail(2, `G7: the standing disclosure is missing — the body must contain "${DISCLOSURE}"`);
}

// POST /feed requires a `kind` from the Epic-011 set {reflection, friction,
// improvement, observation}. A budget review is measurement plus a written
// recommendation, not friction — it is ALWAYS an observation; the constant
// lives here (the deterministic layer) so the LLM cannot mis-tag it.
const payload = { agent_slug: agent, kind: "observation", body };
if (skillVersion) payload.skill_version = skillVersion;

console.error(`post.mjs: POST ${apiUrl} (cap USD ${capUsd} per ${capSource}, ${sources.length} source(s))`);

try {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text().catch(() => "");
  if (res.status >= 200 && res.status < 300) {
    console.log(`post.mjs: written — ${text}`);
    process.exit(0);
  }
  if (res.status === 401 || res.status === 422) {
    fail(2, `rejected (HTTP ${res.status}): ${text.slice(0, 400)}`);
  }
  fail(3, `unexpected HTTP ${res.status}: ${text.slice(0, 400)}`);
} catch (err) {
  fail(3, `fetch failed: ${err instanceof Error ? err.message : String(err)}`);
}
