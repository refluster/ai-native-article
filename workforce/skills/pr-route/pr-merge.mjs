#!/usr/bin/env node
// pr-route/pr-merge.mjs — the shared, deterministic **safe-class merge engine**
// for the workforce's R-N10 delegated-external-merge lane.
//
// Two skills share this one engine (the merge logic lives here once; callers
// only assemble the decisions payload from their own judgment):
//   • pr-route   — cycle-2 "verdict mode": after reviewers post, on a 🟢 verdict
//                  AND an R-N10-safe-class PR, it merges; otherwise comment-only.
//   • dependabot-triage — the no-review Cadence fast path for Dependabot security
//                  PRs (its apply-triage.mjs is a thin wrapper over main() here).
//
// R-N10 (workforce/docs/governance.md) clause 2: this engine RE-VERIFIES the
// eligibility predicate SERVER-SIDE and FAILS CLOSED. A decision marked
// action:"merge" is honoured only if, at apply time, the live PR is: authored by
// dependabot[bot]; open + mergeable + mergeStateStatus CLEAN; lockfile/manifest-
// only (no L1-binding path); a semver-patch or minor-on->=1.0 bump (never a
// major or 0.x-minor crossing); all checks green; and the target repo's
// AUTOPILOT_PR kill-switch == "on". Any failure → that PR is REFUSED (left
// untouched). Escalations (issue filing) are unconditional. The narrowness of
// this predicate IS the "merge stays gated to a safe class" decision — review
// generalises to all PRs (pr-route routing/review), merge does not.
//
// CLI usage (both callers invoke this exact surface):
//   TOKEN=<github.token> node .../pr-merge.mjs \
//     --repo <owner>/<repo> --decisions /tmp/decisions.json [--skill-version x.y.z]
//
// Decisions file shape:
//   { "decisions": [
//       { "pr": 499, "action": "merge",
//         "comment": "<CVE-cited triage comment>",
//         "squash_subject": "chore(deps): bump … (#499)",
//         "squash_body": "Security update. Fixes CVE-… (GHSA-…)." },
//       { "pr": 506, "action": "escalate",
//         "issue_title": "Hold #506: …", "issue_body": "<why held + next step>",
//         "issue_labels": ["security","dependencies","area:backend","type:chore","priority:P2"] }
//   ] }
//
// Exit codes: 0 all applied · 1 bad args/file · 2 a decision refused or a GitHub
// write rejected · 3 network/unexpected.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const LOCKFILES =
  /(^|\/)(yarn\.lock|package-lock\.json|pnpm-lock\.yaml|package\.json|uv\.lock|pyproject\.toml|requirements[^/]*\.txt|Pipfile\.lock|poetry\.lock|go\.(mod|sum)|Cargo\.(toml|lock))$/;
// Never-merge paths (defence-in-depth on top of the lockfile allowlist above).
export const L1_DENY = [
  /restapi\/src\/handlers\/(auth|user|device)/i,
  /adapter-[^/]+\/src\/.*control/i,
  /(^|\/)template\.ya?ml$/i,
  /docs\/adr_/i,
  /docs\/governance\.md$/i,
];

// W-1 editorial guard: a degraded body fails loud here, never lands on GitHub.
const ARTEFACTS = ["as an ai", "i apologize", "i'm sorry", "certainly!", "here is the", "here's the"];
export function w1(text, label) {
  const t = (text || "").trim();
  if (!t) throw { code: 2, msg: `${label} is empty (W-1)` };
  const head = t.slice(0, 50).toLowerCase();
  if (ARTEFACTS.some((a) => head.startsWith(a))) throw { code: 2, msg: `${label} opens with an LLM-failure artefact (W-1): "${head}"` };
  return t;
}

export function parseSemver(v) {
  const m = String(v).trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? { major: +m[1], minor: +m[2], patch: +m[3] } : null;
}
// Eligible = semver-patch, OR minor on a >=1.0 package. Major bumps and any
// 0.x-minor crossing are excluded (the esbuild 0.21->0.28 case).
export function eligibleBump(title) {
  const m = String(title).match(/from\s+(\S+)\s+to\s+(\S+)/i);
  if (!m) return { ok: false, why: "cannot parse 'from A to B' from title" };
  const a = parseSemver(m[1]), b = parseSemver(m[2]);
  if (!a || !b) return { ok: false, why: `unparseable semver (${m[1]} -> ${m[2]})` };
  if (b.major !== a.major) return { ok: false, why: `major bump ${m[1]} -> ${m[2]}` };
  if (a.major === 0 && b.minor !== a.minor) return { ok: false, why: `0.x minor crossing ${m[1]} -> ${m[2]}` };
  return { ok: true, why: `patch/minor ${m[1]} -> ${m[2]}` };
}

// Build a thin GitHub REST client bound to one token + repo.
export function makeGh({ token, api = process.env["GITHUB_API_URL"] || "https://api.github.com", userAgent = "workforce-pr-merge" }) {
  return async function gh(method, path, body) {
    let res;
    try {
      res = await fetch(`${api}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": userAgent,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) { throw { code: 3, msg: `network error on ${method} ${path}: ${e?.message || e}` }; }
    const text = await res.text().catch(() => "");
    let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { _raw: text }; }
    return { status: res.status, json };
  };
}

export async function autopilotOn(gh, repo) {
  const { status, json } = await gh("GET", `/repos/${repo}/actions/variables/AUTOPILOT_PR`);
  return status === 200 && json?.value === "on";
}

// Server-side predicate re-check. Returns {ok, why, sha}.
export async function verifyMergeable(gh, repo, pr) {
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

// Apply one decisions payload. Returns { merged, escalated, refused, autopilot_switch }.
export async function applyDecisions(gh, repo, decisions) {
  let refused = 0, merged = 0, escalated = 0;
  const switchOn = await autopilotOn(gh, repo);

  for (const d of decisions) {
    const pr = d.pr;
    if (d.action === "escalate") {
      const title = w1(d.issue_title, `#${pr} issue_title`);
      const body = w1(d.issue_body, `#${pr} issue_body`);
      const { status, json } = await gh("POST", `/repos/${repo}/issues`, { title, body, labels: Array.isArray(d.issue_labels) ? d.issue_labels : undefined });
      if (status === 201) { escalated++; console.error(`pr-merge: escalated #${pr} -> issue ${json.html_url}`); }
      else { refused++; console.error(`pr-merge: FAILED to file issue for #${pr}: HTTP ${status} ${JSON.stringify(json).slice(0, 300)}`); }
      continue;
    }
    if (d.action !== "merge") { refused++; console.error(`pr-merge: #${pr} unknown action "${d.action}"`); continue; }

    // ── R-N10 fail-closed gate ──────────────────────────────────────────────
    if (!switchOn) { refused++; console.error(`pr-merge: REFUSE merge #${pr}: AUTOPILOT_PR kill-switch is not "on"`); continue; }
    const comment = w1(d.comment, `#${pr} comment`);
    const subject = w1(d.squash_subject, `#${pr} squash_subject`);
    const verdict = await verifyMergeable(gh, repo, pr);
    if (!verdict.ok) { refused++; console.error(`pr-merge: REFUSE merge #${pr}: ${verdict.why}`); continue; }

    const c = await gh("POST", `/repos/${repo}/issues/${pr}/comments`, { body: comment });
    if (c.status !== 201) { refused++; console.error(`pr-merge: REFUSE merge #${pr}: comment failed HTTP ${c.status}`); continue; }
    const rv = await gh("POST", `/repos/${repo}/pulls/${pr}/reviews`, { event: "APPROVE", body: "Autopilot-eligible (R-N10). Approving + squash-merging." });
    if (rv.status !== 200) { refused++; console.error(`pr-merge: REFUSE merge #${pr}: approve failed HTTP ${rv.status} ${JSON.stringify(rv.json).slice(0, 200)}`); continue; }
    const mg = await gh("PUT", `/repos/${repo}/pulls/${pr}/merge`, { merge_method: "squash", sha: verdict.sha, commit_title: subject, commit_message: d.squash_body || "" });
    if (mg.status === 200) { merged++; console.error(`pr-merge: MERGED #${pr} (${verdict.why})`); }
    else { refused++; console.error(`pr-merge: merge #${pr} REJECTED HTTP ${mg.status}: ${JSON.stringify(mg.json).slice(0, 300)}`); }
  }
  return { repo, merged, escalated, refused, autopilot_switch: switchOn ? "on" : "off" };
}

function arg(argv, n) { const i = argv.indexOf(`--${n}`); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined; }

// Shared CLI entry. Returns a process exit code (does not call process.exit so
// callers can wrap it). TOKEN or GITHUB_TOKEN env supplies the credential.
export async function main(argv, env) {
  const token = env["TOKEN"] || env["GITHUB_TOKEN"];
  const repo = arg(argv, "repo");
  const decisionsFile = arg(argv, "decisions");
  if (!token) { console.error("pr-merge: TOKEN (or GITHUB_TOKEN) env var is required (from credentials['github.token'])"); return 1; }
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) { console.error("pr-merge: --repo <owner>/<repo> is required"); return 1; }
  if (!decisionsFile) { console.error("pr-merge: --decisions <file> is required"); return 1; }

  let payload;
  try { payload = JSON.parse(readFileSync(decisionsFile, "utf8")); }
  catch (e) { console.error(`pr-merge: cannot read/parse --decisions "${decisionsFile}": ${e?.message || e}`); return 1; }
  const decisions = Array.isArray(payload?.decisions) ? payload.decisions : null;
  if (!decisions) { console.error("pr-merge: decisions file must be { decisions: [...] }"); return 1; }

  const gh = makeGh({ token, userAgent: "workforce-pr-merge" });
  let result;
  try { result = await applyDecisions(gh, repo, decisions); }
  catch (e) { console.error(`pr-merge: ${e?.msg || e?.message || e}`); return e?.code || 3; }
  console.log(JSON.stringify(result));
  return result.refused > 0 ? 2 : 0;
}

// Run as a CLI when invoked directly (pr-route verdict mode calls this path).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(await main(process.argv, process.env));
}
