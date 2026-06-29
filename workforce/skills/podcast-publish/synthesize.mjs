#!/usr/bin/env node
// podcast-publish / synthesize — trigger the deterministic wf-podcast Lambda to
// turn `approved` episodes into MP3s (Epic-017). This script carries NO judgment.
//
// Two-phase, because Amazon Polly synthesis of a full episode takes longer than
// the API Gateway HTTP-API hard 30s integration timeout (a real batch ran ~55s
// → the old single synchronous POST 503'd at 30s even though synthesis
// succeeded). So:
//   1. KICKOFF  — POST {} → the Lambda StartSpeechSynthesisTask's up to 5 oldest
//      `approved` episodes (Polly does the waiting, not the Lambda) and returns
//      202 with the task handles. Fast, well under 30s.
//   2. POLL     — POST {finalize:[handles]} on an interval; the Lambda finalizes
//      each completed Polly task (copy MP3 → public key, write audioUrl +
//      podcastStatus=audio-ready to Notion) and reports {done,pending}. Each
//      poll call is fast too. Loop until done or the poll budget is exhausted.
// The taskId is the only state and it lives in THIS caller — no per-Lambda
// nested invocation (R-N1).
//
// Auth is IAM (the CI OIDC role / the operator's AWS credentials sign each
// request) — NOT the CCR cadence, which is Notion-only and never touches AWS.
// The Notion token lives in the Lambda (its IAM role), never in this session.
//
// Usage:
//   aws-vault exec <profile> -- node workforce/skills/podcast-publish/synthesize.mjs            # oldest approved (≤5)
//   aws-vault exec <profile> -- node workforce/skills/podcast-publish/synthesize.mjs --slug c91368439868
//
// Env:
//   WF_PODCAST_API_BASE   override the API base (default: prod execute-api URL)
//   AWS_REGION            SigV4 region (default us-west-2)
//   PODCAST_POLL_BUDGET_MS  total poll budget (default 840000 = 14 min, under the
//                           20 min CI job timeout)
//   PODCAST_POLL_INTERVAL_MS  poll interval (default 8000 = 8s)
//
// Exit codes:
//   0  — synthesised (or a skip: no approved episode) — read the JSON
//   1  — bad env / missing AWS creds
//   2  — Lambda returned 4xx (bad request / auth)
//   3  — Lambda 5xx / network / a Polly failure, or the poll budget expired with
//        episodes still un-synthesised (fail loud — C-4)

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_PODCAST_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";
const POLL_BUDGET_MS = Number(process.env.PODCAST_POLL_BUDGET_MS ?? "840000");
const POLL_INTERVAL_MS = Number(process.env.PODCAST_POLL_INTERVAL_MS ?? "8000");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
const slug = arg("slug");

const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN } = process.env;
if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
  console.error("synthesize.mjs: AWS credentials missing — run under CI OIDC or `aws-vault exec <profile> --` (the route is IAM-authorized)");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One SigV4-signed POST to /podcast/synthesize. Returns {status, text, json}.
function post(payload) {
  const body = JSON.stringify(payload);
  const args = [
    "-sS",
    "-X", "POST",
    "-H", "content-type: application/json",
    "-w", "\n%{http_code}",
    `${API_BASE}/podcast/synthesize`,
    "--aws-sigv4", `aws:amz:${REGION}:execute-api`,
    "--user", `${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}`,
  ];
  if (AWS_SESSION_TOKEN) args.push("-H", `x-amz-security-token: ${AWS_SESSION_TOKEN}`);
  args.push("--data-binary", body);

  const res = spawnSync("curl", args, { encoding: "utf8" });
  if (res.status !== 0) {
    return { status: 0, text: `curl failed: ${res.stderr}`, json: undefined };
  }
  const out = res.stdout;
  const nl = out.lastIndexOf("\n");
  const status = Number(out.slice(nl + 1));
  const text = out.slice(0, nl);
  let parsed;
  try { parsed = JSON.parse(text); } catch { /* non-JSON error body */ }
  return { status, text, json: parsed };
}

// Map a non-2xx response to the documented exit code (fail loud on 5xx).
function bail(label, res) {
  if (res.status >= 400 && res.status < 500) { console.error(`synthesize.mjs: ${label} HTTP ${res.status}: ${res.text}`); process.exit(2); }
  console.error(`synthesize.mjs: ${label} HTTP ${res.status} (fail loud): ${res.text}`);
  process.exit(3);
}

// ── 1. Kickoff ────────────────────────────────────────────────────────────────
const kicked = post(slug ? { slug } : {});
if (kicked.status === 200 && kicked.json?.skip) {
  console.log(kicked.text); // {skip:true,…}
  process.exit(0);
}
if (kicked.status !== 202) bail("kickoff", kicked);

const handles = Array.isArray(kicked.json?.started) ? kicked.json.started : [];
if (handles.length === 0) {
  console.error("synthesize.mjs: kickoff returned 202 with no handles");
  process.exit(3);
}
console.error(`synthesize.mjs: started ${handles.length} Polly task(s); polling for completion (budget ${Math.round(POLL_BUDGET_MS / 1000)}s)…`);

// ── 2. Poll until every started task is finalized → audio-ready ─────────────────
let pending = handles;
const deadline = Date.now() + POLL_BUDGET_MS;
while (pending.length > 0) {
  if (Date.now() > deadline) {
    console.error(`synthesize.mjs: poll budget expired with ${pending.length} episode(s) still un-synthesised (fail loud)`);
    process.exit(3);
  }
  await sleep(POLL_INTERVAL_MS);
  const res = post({ finalize: pending });
  if (res.status !== 200) bail("finalize", res); // a Polly failure throws → 5xx → exit 3
  const results = Array.isArray(res.json?.results) ? res.json.results : [];
  const doneIds = new Set(results.filter((r) => r.done).map((r) => r.pageId));
  pending = pending.filter((h) => !doneIds.has(h.pageId));
  console.error(`  audio-ready ${handles.length - pending.length}/${handles.length}`);
}

console.log(JSON.stringify({ synthesized: handles.length, slugs: handles.map((h) => h.slug) }));
process.exit(0);
