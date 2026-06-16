#!/usr/bin/env node
// dependabot-triage/apply-triage.mjs — the deterministic write for the
// "dependabot-triage" Cadence. The LLM (Farah) produces a decisions payload;
// THIS script owns every GitHub mutation (comment / approve / squash-merge /
// issue) so the failure class "the model hallucinates a merge" cannot recur.
//
// R-N10 (workforce/docs/governance.md) clause 2: this script RE-VERIFIES the
// eligibility predicate SERVER-SIDE and FAILS CLOSED. A decision marked
// action:"merge" is only honoured if, at apply time, the live PR is: authored by
// dependabot[bot]; open + mergeable + mergeStateStatus CLEAN; lockfile/manifest-
// only (no L1-binding path); a semver-patch or minor-on->=1.0 bump (never a
// major or 0.x-minor crossing); all checks green; and the target repo's
// AUTOPILOT_PR kill-switch == "on". Any failure → that PR is REFUSED (left
// untouched) and the script exits non-zero. Escalations are filed unconditionally.
//
// Usage:
//   TOKEN=<credentials['github.token']> \
//     node workforce/skills/dependabot-triage/apply-triage.mjs \
//       --repo <owner>/<repo> --decisions /tmp/decisions.json [--skill-version 0.1.0]
//
// Decisions file shape:
//   {
//     "decisions": [
//       { "pr": 499, "action": "merge",
//         "comment": "<CVE-cited triage comment>",
//         "squash_subject": "chore(deps): bump … (#499)",
//         "squash_body": "Security update. Fixes CVE-… (GHSA-…)." },
//       { "pr": 506, "action": "escalate",
//         "issue_title": "Hold #506: …", "issue_body": "<why held + next step>",
//         "issue_labels": ["security","dependencies","area:backend","type:chore","priority:P2"] }
//     ]
//   }
//
// Exit codes: 0 all applied · 1 bad args/file · 2 a decision refused or a GitHub
// write rejected · 3 network/unexpected.

import { readFileSync } from "node:fs";

const API = process.env["GITHUB_API_URL"] || "https://api.github.com";
const TOKEN = process.env["TOKEN"];
const LOCKFILES = /(^|\/)(yarn\.lock|package-lock\.json|pnpm-lock\.yaml|package\.json|uv\.lock|pyproject\.toml|requirements[^/]*\.txt|Pipfile\.lock|poetry\.lock|go\.(mod|sum)|Cargo\.(toml|lock))$/;
// Never-merge paths (defence-in-depth on top of the allowlist above).
const L1_DENY = [/restapi\/src\/handlers\/(auth|user|device)/i, /adapter-[^/]+\/src\/.*control/i, /(^|\/)template\.ya?ml$/i, /docs\/adr_/i, /docs\/governance\.md$/i];

function arg(n) { const i = process.argv.indexOf(`--${n}`); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined; }
function die(code, msg) { console.error(`apply-triage.mjs: ${msg}`); process.exit(code); }

const repo = arg("repo");
const decisionsFile = arg("decisions");
if (!TOKEN) die(1, "TOKEN env var is required (from credentials['github.token'])");
if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) die(1, "--repo <owner>/<repo> is required");
if (!decisionsFile) die(1, "--decisions <file> is required");

let payload;
try { payload = JSON.parse(readFileSync(decisionsFile, "utf8")); }
catch (e) { die(1, `cannot read/parse --decisions "${decisionsFile}": ${e?.message || e}`); }
const decisions = Array.isArray(payload?.decisions) ? payload.decisions : null;
if (!decisions) die(1, "decisions file must be { decisions: [...] }");

// W-1 editorial guard: a degraded body fails loud here, never lands on GitHub.
const ARTEFACTS = ["as an ai", "i apologize", "i'm sorry", "certainly!", "here is the", "here's the"];
function w1(text, label) {
  const t = (text || "").trim();
  if (!t) die(2, `${label} is empty (W-1)`);
  const head = t.slice(0, 50).toLowerCase();
  if (ARTEFACTS.some((a) => head.startsWith(a))) die(2, `${label} opens with an LLM-failure artefact (W-1): "${head}"`);
  return t;
}

async function gh(method, path, body) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "workforce-dependabot-triage",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) { die(3, `network error on ${method} ${path}: ${e?.message || e}`); }
  const text = await res.text().catch(() => "");
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { _raw: text }; }
  return { status: res.status, json };
}

function parseSemver(v) {
  const m = String(v).trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? { major: +m[1], minor: +m[2], patch: +m[3] } : null;
}
// Eligible = semver-patch, OR minor on a >=1.0 package. Major bumps and any
// 0.x-minor crossing are excluded (the esbuild 0.21->0.28 case).
function eligibleBump(title) {
  const m = String(title).match(/from\s+(\S+)\s+to\s+(\S+)/i);
  if (!m) return { ok: false, why: "cannot parse 'from A to B' from title" };
  const a = parseSemver(m[1]), b = parseSemver(m[2]);
  if (!a || !b) return { ok: false, why: `unparseable semver (${m[1]} -> ${m[2]})` };
  if (b.major !== a.major) return { ok: false, why: `major bump ${m[1]} -> ${m[2]}` };
  if (a.major === 0 && b.minor !== a.minor) return { ok: false, why: `0.x minor crossing ${m[1]} -> ${m[2]}` };
  return { ok: true, why: `patch/minor ${m[1]} -> ${m[2]}` };
}

async function autopilotOn() {
  const { status, json } = await gh("GET", `/repos/${repo}/actions/variables/AUTOPILOT_PR`);
  return status === 200 && json?.value === "on";
}

// Server-side predicate re-check. Returns {ok, why, sha}.
async function verifyMergeable(pr) {
  const { status, json: p } = await gh("GET", `/repos/${repo}/pulls/${pr}`);
  if (status !== 200) return { ok: false, why: `GET pull ${pr} -> HTTP ${status}` };
  if (p.state !== "open") return { ok: false, why: `PR #${pr} is ${p.state}` };
  if (p.user?.login !== "dependabot[bot]") return { ok: false, why: `author is ${p.user?.login}, not dependabot[bot]` };
  if (p.mergeable !== true || p.mergeable_state !== "clean") return { ok: false, why: `not clean (mergeable=${p.mergeable}, state=${p.mergeable_state})` };
  const bump = eligibleBump(p.title);
  if (!bump.ok) return { ok: false, why: bump.why };

  const { status: fs, json: files } = await gh("GET", `/repos/${repo}/pulls/${pr}/files?per_page=100`);
  if (fs !== 200 || !Array.isArray(files)) return { ok: false, why: `GET files -> HTTP ${fs}` };
  for (const f of files) {
    if (L1_DENY.some((re) => re.test(f.filename))) return { ok: false, why: `touches L1-binding path ${f.filename}` };
    if (!LOCKFILES.test(f.filename)) return { ok: false, why: `non-lockfile change ${f.filename}` };
  }

  const { status: cs, json: checks } = await gh("GET", `/repos/${repo}/commits/${p.head.sha}/check-runs?per_page=100`);
  if (cs !== 200) return { ok: false, why: `GET check-runs -> HTTP ${cs}` };
  for (const c of checks.check_runs || []) {
    if (c.status !== "completed") return { ok: false, why: `check '${c.name}' is ${c.status}` };
    if (!["success", "neutral", "skipped"].includes(c.conclusion)) return { ok: false, why: `check '${c.name}' = ${c.conclusion}` };
  }
  return { ok: true, why: bump.why, sha: p.head.sha };
}

let refused = 0, merged = 0, escalated = 0;
const switchOn = await autopilotOn();

for (const d of decisions) {
  const pr = d.pr;
  if (d.action === "escalate") {
    const title = w1(d.issue_title, `#${pr} issue_title`);
    const body = w1(d.issue_body, `#${pr} issue_body`);
    const { status, json } = await gh("POST", `/repos/${repo}/issues`, { title, body, labels: Array.isArray(d.issue_labels) ? d.issue_labels : undefined });
    if (status === 201) { escalated++; console.error(`apply-triage.mjs: escalated #${pr} -> issue ${json.html_url}`); }
    else { refused++; console.error(`apply-triage.mjs: FAILED to file issue for #${pr}: HTTP ${status} ${JSON.stringify(json).slice(0, 300)}`); }
    continue;
  }
  if (d.action !== "merge") { refused++; console.error(`apply-triage.mjs: #${pr} unknown action "${d.action}"`); continue; }

  // ── R-N10 fail-closed gate ──────────────────────────────────────────────
  if (!switchOn) { refused++; console.error(`apply-triage.mjs: REFUSE merge #${pr}: AUTOPILOT_PR kill-switch is not "on"`); continue; }
  const comment = w1(d.comment, `#${pr} comment`);
  const subject = w1(d.squash_subject, `#${pr} squash_subject`);
  const verdict = await verifyMergeable(pr);
  if (!verdict.ok) { refused++; console.error(`apply-triage.mjs: REFUSE merge #${pr}: ${verdict.why}`); continue; }

  const c = await gh("POST", `/repos/${repo}/issues/${pr}/comments`, { body: comment });
  if (c.status !== 201) { refused++; console.error(`apply-triage.mjs: REFUSE merge #${pr}: comment failed HTTP ${c.status}`); continue; }
  const rv = await gh("POST", `/repos/${repo}/pulls/${pr}/reviews`, { event: "APPROVE", body: "Autopilot-eligible (R-N10). Approving + squash-merging." });
  if (rv.status !== 200) { refused++; console.error(`apply-triage.mjs: REFUSE merge #${pr}: approve failed HTTP ${rv.status} ${JSON.stringify(rv.json).slice(0, 200)}`); continue; }
  const mg = await gh("PUT", `/repos/${repo}/pulls/${pr}/merge`, { merge_method: "squash", sha: verdict.sha, commit_title: subject, commit_message: d.squash_body || "" });
  if (mg.status === 200) { merged++; console.error(`apply-triage.mjs: MERGED #${pr} (${verdict.why})`); }
  else { refused++; console.error(`apply-triage.mjs: merge #${pr} REJECTED HTTP ${mg.status}: ${JSON.stringify(mg.json).slice(0, 300)}`); }
}

console.log(JSON.stringify({ repo, merged, escalated, refused, autopilot_switch: switchOn ? "on" : "off" }));
if (refused > 0) process.exit(2);
process.exit(0);
