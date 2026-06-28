#!/usr/bin/env node
// podcast-rss — (re)build the podcast RSS feed by triggering the deterministic
// wf-podcast Lambda (Epic-017 Story 6). No judgment: it SigV4-POSTs to the
// IAM-authorized /podcast/rss route, and the Lambda assembles the feed from
// every audio-ready/published episode (enclosure = the public MP3,
// <description> = the mandatory source citations, GUID = slug) and writes it to
// the public podcast/feed.xml. The operator submits that feed URL to Spotify
// once; subsequent episodes auto-ingest on the next rebuild.
//
// Auth is IAM — the same SigV4 pattern as register.mjs / synthesize.mjs. No new
// project credential type.
//
// Usage:
//   aws-vault exec <profile> -- node workforce/skills/podcast-rss/build-rss.mjs
//
// Env:
//   WF_PODCAST_API_BASE  override the API base (default: prod execute-api URL)
//   AWS_REGION           SigV4 region (default us-west-2)
//
// Exit codes:
//   0  — feed rebuilt (JSON carries the feedUrl + episode count)
//   1  — bad env / missing AWS creds
//   2  — Lambda returned 4xx
//   3  — Lambda 5xx / network error (fail loud — e.g. an uncited episode)

import { spawnSync } from "node:child_process";

const API_BASE = (
  process.env.WF_PODCAST_API_BASE ??
  "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod"
).replace(/\/+$/, "");
const REGION = process.env.AWS_REGION ?? "us-west-2";

const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN } = process.env;
if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
  console.error("build-rss.mjs: AWS credentials missing — run under `aws-vault exec <profile> --` (the route is IAM-authorized)");
  process.exit(1);
}

const args = [
  "-sS",
  "-X", "POST",
  "-H", "content-type: application/json",
  "-w", "\n%{http_code}",
  `${API_BASE}/podcast/rss`,
  "--aws-sigv4", `aws:amz:${REGION}:execute-api`,
  "--user", `${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}`,
];
if (AWS_SESSION_TOKEN) args.push("-H", `x-amz-security-token: ${AWS_SESSION_TOKEN}`);
args.push("--data-binary", "{}");

const res = spawnSync("curl", args, { encoding: "utf8" });
if (res.status !== 0) {
  console.error(`build-rss.mjs: curl failed: ${res.stderr}`);
  process.exit(3);
}
const out = res.stdout;
const nl = out.lastIndexOf("\n");
const status = Number(out.slice(nl + 1));
console.log(out.slice(0, nl));
if (status >= 200 && status < 300) process.exit(0);
if (status >= 400 && status < 500) { console.error(`build-rss.mjs: HTTP ${status}`); process.exit(2); }
console.error(`build-rss.mjs: HTTP ${status} (fail loud)`);
process.exit(3);
