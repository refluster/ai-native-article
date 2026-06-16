#!/usr/bin/env node
// log-workforce-engagements — batch the ad-hoc engagement sink.
//
// Records ONE EXEC row per contributor for a session's work by looping the
// canonical writer (workforce/scripts/record-engagement.mjs) over a rows
// file. It does NOT re-implement the token mint / POST — record-engagement.mjs
// owns that (ADR-0005 / ADR-0009). This wrapper only (1) resolves a reachable
// API base and (2) drives the loop with a per-row report.
//
// Why the API-base resolution matters (the load-bearing lesson):
//   record-engagement.mjs defaults WF_API_BASE to the custom domain
//   https://workforce-api.kohuehara.xyz — which is NOT in a remote Claude
//   Code session's network egress allowlist (POST → "403 Host not in
//   allowlist"). The API Gateway execute-api host IS reachable, so when
//   WF_API_BASE is unset we resolve it from the live stack output
//   (wf-data-plane-{stage} → AgentsApiUrl) using the session's AWS creds
//   (the same creds that are the mint trust gate).
//
// Usage:
//   node .claude/skills/log-workforce-engagements/scripts/log-engagements.mjs \
//     --rows /tmp/engagements.json [--project agent-workforce] [--stage prod] [--dry-run]
//
// rows file = JSON array of objects:
//   [{ "agent": "maya", "skill": "pr-review",
//      "summary": "title-first business sentence", "uri": "https://…",
//      "status": "ok", "project": "agent-workforce" }, …]
//   status defaults to "ok"; project falls back to --project then "agent-workforce".
//
// Exit: 0 = every row recorded; 1 = one or more rows failed (the rest still ran).

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
// .claude/skills/log-workforce-engagements/scripts/ → repo root is 4 up.
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");
const RECORDER = join(REPO_ROOT, "workforce", "scripts", "record-engagement.mjs");

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const DRY_RUN = process.argv.includes("--dry-run");
const ROWS_FILE = arg("rows");
const DEFAULT_PROJECT = arg("project", "agent-workforce");
const STAGE = arg("stage", "prod");

if (!ROWS_FILE) {
  console.error("required: --rows <file.json> (see header for the row shape)");
  process.exit(2);
}

// Resolve a reachable API base once for the whole batch.
function resolveApiBase() {
  if (process.env.WF_API_BASE) return process.env.WF_API_BASE.replace(/\/+$/, "");
  try {
    const url = execFileSync(
      "aws",
      [
        "cloudformation", "describe-stacks",
        "--region", process.env.AWS_REGION || "us-west-2",
        "--stack-name", `wf-data-plane-${STAGE}`,
        "--query", "Stacks[0].Outputs[?OutputKey=='AgentsApiUrl'].OutputValue",
        "--output", "text",
      ],
      { encoding: "utf8" },
    ).trim();
    if (url && url !== "None") return url.replace(/\/+$/, "");
  } catch (err) {
    console.warn(`could not resolve AgentsApiUrl from CloudFormation (${err.message ?? err}); falling back to the custom domain — note it may be egress-blocked in a remote session`);
  }
  return "https://workforce-api.kohuehara.xyz";
}

let rows;
try {
  rows = JSON.parse(readFileSync(ROWS_FILE, "utf8"));
} catch (err) {
  console.error(`rows file unreadable / not JSON: ${ROWS_FILE} — ${err.message ?? err}`);
  process.exit(2);
}
if (!Array.isArray(rows) || rows.length === 0) {
  console.error("rows file must be a non-empty JSON array");
  process.exit(2);
}

const API_BASE = resolveApiBase();
console.log(`API base: ${API_BASE}${DRY_RUN ? "  (dry-run)" : ""}`);

let failed = 0;
rows.forEach((r, i) => {
  const tag = `[${i + 1}/${rows.length}] ${r.agent} · ${r.skill}`;
  if (!r.agent || !r.skill || !r.summary) {
    console.error(`✗ ${tag}: each row needs agent + skill + summary`);
    failed++;
    return;
  }
  const args = [
    RECORDER,
    "--agent", r.agent,
    "--skill", r.skill,
    "--project", r.project || DEFAULT_PROJECT,
    "--status", r.status || "ok",
    "--summary", r.summary,
  ];
  if (r.uri) args.push("--uri", r.uri);
  if (DRY_RUN) {
    console.log(`  [dry-run] ${tag} → "${r.summary.slice(0, 60)}${r.summary.length > 60 ? "…" : ""}"`);
    return;
  }
  const res = spawnSync("node", args, {
    encoding: "utf8",
    env: { ...process.env, WF_API_BASE: API_BASE },
  });
  if (res.status === 0) {
    console.log(`✓ ${tag}`);
  } else {
    failed++;
    const msg = (res.stderr || res.stdout || "").trim().split("\n").pop();
    console.error(`✗ ${tag}: ${msg}`);
  }
});

if (failed > 0) {
  console.error(`\n${failed} of ${rows.length} row(s) failed.`);
  process.exit(1);
}
console.log(DRY_RUN ? "\nDry run complete." : `\nLogged ${rows.length} engagement(s).`);
