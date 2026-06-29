#!/usr/bin/env node
// podcast-publish / synthesize — trigger the deterministic wf-podcast Lambda to
// turn `approved` episodes into MP3s (Epic-017). This script carries NO judgment:
// it SigV4-POSTs to the IAM-authorized /podcast/synthesize route, and the Lambda
// does all the work (read podcastScript from Notion → Polly Neural JA voice
// [Odette's podcastVoice param, else random] → MP3 on the wf bucket's
// podcast/audio/ prefix → write audioUrl + podcastStatus=audio-ready). Up to 5
// oldest approved episodes per call.
//
// Auth is IAM (the CI OIDC role / the operator's AWS credentials sign the
// request) — NOT the CCR cadence, which is Notion-only and never touches AWS.
// The Notion token lives in the Lambda (its IAM role), never in this session.
// No new project credential type.
//
// Usage:
//   aws-vault exec <profile> -- node workforce/skills/podcast-publish/synthesize.mjs            # oldest approved (≤5)
//   aws-vault exec <profile> -- node workforce/skills/podcast-publish/synthesize.mjs --slug c91368439868
//
// Env:
//   WF_PODCAST_API_BASE  override the API base (default: prod execute-api URL)
//   AWS_REGION           SigV4 region (default us-west-2)
//
// Exit codes:
//   0  — synthesised (or a skip: no approved episode) — read the JSON
//   1  — bad env / missing AWS creds
//   2  — Lambda returned 4xx (bad request / auth)
//   3  — Lambda 5xx / network error (fail loud — a Polly/synthesis error)

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_PODCAST_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";

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

const body = JSON.stringify(slug ? { slug } : {});
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
  console.error(`synthesize.mjs: curl failed: ${res.stderr}`);
  process.exit(3);
}
const out = res.stdout;
const nl = out.lastIndexOf("\n");
const status = Number(out.slice(nl + 1));
const text = out.slice(0, nl);
console.log(text);
if (status >= 200 && status < 300) process.exit(0);
if (status >= 400 && status < 500) { console.error(`synthesize.mjs: HTTP ${status}`); process.exit(2); }
console.error(`synthesize.mjs: HTTP ${status} (fail loud)`);
process.exit(3);
