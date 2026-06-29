#!/usr/bin/env node
// podcast-publish — Celeste's stage (audio-ready → published). Triggers the
// deterministic wf-podcast Lambda's /podcast/publish route, which flips up to 5
// oldest `audio-ready` episodes to `published` and rebuilds the RSS feed
// (enclosure = public MP3, <description> = Celeste's show-notes + the mandatory
// citations). No judgment here — the judgment (show-notes framing) is a Notion
// parameter Celeste sets beforehand; this only executes the transition.
//
// Auth is IAM (SigV4) — run from CI (OIDC) or by the operator, same pattern as
// build-rss.mjs / synthesize.mjs. No new credential type.
//
// Usage:
//   aws-vault exec <profile> -- node workforce/skills/podcast-rss/publish.mjs
//
// Env: WF_PODCAST_API_BASE (default prod execute-api), AWS_REGION (us-west-2).
//
// Exit codes: 0 published (JSON carries published[] + feedUrl), 1 missing
// creds, 2 Lambda 4xx, 3 Lambda 5xx / network (fail loud).

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_PODCAST_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";

const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN } = process.env;
if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
  console.error("publish.mjs: AWS credentials missing — run under aws-vault / CI OIDC (the route is IAM-authorized)");
  process.exit(1);
}

const args = [
  "-sS", "-X", "POST", "-H", "content-type: application/json", "-w", "\n%{http_code}",
  `${API_BASE}/podcast/publish`,
  "--aws-sigv4", `aws:amz:${REGION}:execute-api`,
  "--user", `${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}`,
];
if (AWS_SESSION_TOKEN) args.push("-H", `x-amz-security-token: ${AWS_SESSION_TOKEN}`);
args.push("--data-binary", "{}");

const res = spawnSync("curl", args, { encoding: "utf8" });
if (res.status !== 0) { console.error(`publish.mjs: curl failed: ${res.stderr}`); process.exit(3); }
const out = res.stdout;
const nl = out.lastIndexOf("\n");
const status = Number(out.slice(nl + 1));
console.log(out.slice(0, nl));
if (status >= 200 && status < 300) process.exit(0);
if (status >= 400 && status < 500) { console.error(`publish.mjs: HTTP ${status}`); process.exit(2); }
console.error(`publish.mjs: HTTP ${status} (fail loud)`);
process.exit(3);
