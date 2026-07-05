#!/usr/bin/env node
// podcast-publish / trigger-pipeline — fire the `podcast-pipeline.yml` workflow
// (synthesize + publish) via GitHub `workflow_dispatch`, so the publish cadence
// can hand off to the deterministic pipeline in ONE continuous flow instead of
// waiting for the daily cron. This is the optional last leg after the judgment
// half (podcastVoice + podcastShowNotes) has been set on the approved episodes.
//
// GitHub-only — the AWS trust boundary stays closed (R-N1 / ADR-0016). This
// script dispatches the existing CI workflow; that workflow then does all the
// Polly/S3/RSS work via its OWN OIDC→AWS role. The cadence never touches AWS;
// it only asks GitHub to run the workflow.
//
// Auth: the project-scoped github.token (credentials['github.token'].token),
// exported as GITHUB_TOKEN. It MUST carry the `workflow` scope (classic PAT) or
// `Actions: write` (fine-grained) — without it GitHub returns 403
// ("not accessible by integration").
//
// CAVEAT (read before debugging a 403): a Claude Code session's egress proxy
// injects a FIXED session GitHub identity for api.github.com and ignores both
// this token and GITHUB_TOKEN, so this script cannot be smoke-tested from such
// a session (it 403s as the session identity). It works where the PAT is
// actually used: the CCR cadence runner, GitHub Actions/CI, or an operator
// shell.
//
// Usage:
//   GITHUB_TOKEN=<…> node trigger-pipeline.mjs [--ref main] [--workflow podcast-pipeline.yml]
//
// Exit codes:
//   0  — dispatched (HTTP 204) — read the JSON
//   1  — missing GITHUB_TOKEN
//   2  — GitHub 4xx (e.g. 403: token lacks the workflow/Actions:write scope)
//   3  — GitHub 5xx / network error (fail loud)

import { spawnSync } from "node:child_process";

const OWNER = process.env.WF_PODCAST_REPO_OWNER ?? "refluster";
const REPO = process.env.WF_PODCAST_REPO_NAME ?? "ai-native-article";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const ref = arg("ref", "main");
const workflow = arg("workflow", "podcast-pipeline.yml");

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("trigger-pipeline.mjs: GITHUB_TOKEN is required (credentials['github.token'].token; needs the `workflow` scope / Actions:write)");
  process.exit(1);
}

const url = `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${workflow}/dispatches`;
const res = spawnSync("curl", [
  "-sS", "-o", "/dev/null", "-w", "%{http_code}",
  "-X", "POST",
  "-H", `Authorization: Bearer ${token}`,
  "-H", "Accept: application/vnd.github+json",
  "-H", "X-GitHub-Api-Version: 2022-11-28",
  url,
  "-d", JSON.stringify({ ref }),
], { encoding: "utf8" });

if (res.status !== 0) {
  console.error(`trigger-pipeline.mjs: curl failed: ${res.stderr}`);
  process.exit(3);
}
const code = Number(res.stdout.trim());
if (code === 204) {
  console.log(JSON.stringify({ dispatched: true, workflow, ref }));
  process.exit(0);
}
if (code >= 400 && code < 500) {
  console.error(`trigger-pipeline.mjs: HTTP ${code} — the token likely lacks the \`workflow\` scope / Actions:write (or a session proxy is overriding auth)`);
  process.exit(2);
}
console.error(`trigger-pipeline.mjs: HTTP ${code} (fail loud)`);
process.exit(3);
