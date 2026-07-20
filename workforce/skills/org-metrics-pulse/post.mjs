#!/usr/bin/env node
// org-metrics-pulse/post.mjs — deterministic write for the "org-metrics-pulse" Cadence,
// invoked by the CCR agent-runner AFTER it has *generated* the content. The LLM
// owns the judgment (body / structured fields); this script owns the
// structurally-exact write so the failure class "LLM hand-edits JSON and
// guesses the schema wrong" cannot recur. Modeled on
// workforce/skills/feed-post/post-feed.mjs — the canonical Cadence write.
//
// It POSTs to an authenticated endpoint with the project-scoped credential
// injected per-fire (credentials['workforce.feed_write_token']). The script does NOT
// touch the repo, does NOT open a PR — the write lands directly in the backing
// store. No human approval gate.
//
// Body is read from a FILE (not an arg) so multi-line / Unicode prose can't be
// mangled by shell quoting. The write CREDENTIAL is injected per-fire; the
// endpoint URL is NOT a secret and is the single source of truth right here.
//
// Usage:
//   FEED_WRITE_TOKEN=<from credentials['workforce.feed_write_token']> \
//     node workforce/skills/org-metrics-pulse/post.mjs \
//       --agent <slug> --body-file /tmp/body.md [--skill-version 0.1.0]
//
// Exit codes:
//   0  — written (HTTP 2xx)
//   1  — bad args / env / body-file unreadable
//   2  — endpoint rejected (HTTP 401 auth / 422 validation)
//   3  — network / unexpected error

import { readFileSync } from "node:fs";

// Single source of truth for this Cadence's write endpoint. Override with
// FEED_WRITE_TOKEN_API_URL only for non-prod / dev stages.
const DEFAULT_API_URL = "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod/feed";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const apiUrl = process.env["FEED_WRITE_TOKEN_API_URL"] || DEFAULT_API_URL;
const token = process.env["FEED_WRITE_TOKEN"];
const agent = arg("agent");
const bodyFile = arg("body-file");
const skillVersion = arg("skill-version");

if (!token) { console.error("post.mjs: FEED_WRITE_TOKEN env var is required (from credentials['workforce.feed_write_token'])"); process.exit(1); }
if (!agent) { console.error("post.mjs: --agent <slug> is required"); process.exit(1); }
if (!bodyFile) { console.error("post.mjs: --body-file <path> is required"); process.exit(1); }
if (apiUrl.startsWith("TODO_")) { console.error("post.mjs: DEFAULT_API_URL is still a scaffold placeholder — set the real endpoint"); process.exit(1); }

let body;
try {
  body = readFileSync(bodyFile, "utf8");
} catch (err) {
  console.error(`post.mjs: cannot read --body-file "${bodyFile}": ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

// W-1 editorial guard (client side; the endpoint should re-run it server side).
// A degraded body fails loud here rather than landing on the backing store.
const ARTEFACTS = ["as an ai", "i apologize", "i'm sorry", "certainly!", "sure, ", "here is the", "here's the"];
const head = body.trimStart().slice(0, 50).toLowerCase();
if (body.trim().length === 0) { console.error("post.mjs: body is empty (W-1)"); process.exit(1); }
if (ARTEFACTS.some((a) => head.startsWith(a))) { console.error(`post.mjs: body opens with an LLM-failure artefact (W-1): "${head}"`); process.exit(1); }

// POST /feed requires a `kind` from the Epic-011 set {reflection, friction,
// improvement, observation}. A weekly org-metrics note is measurement, not
// friction or proposal — it is ALWAYS an observation; the constant lives
// here (the deterministic layer) so the LLM cannot mis-tag it.
const payload = { agent_slug: agent, kind: "observation", body };
if (skillVersion) payload.skill_version = skillVersion;

console.error(`post.mjs: POST ${apiUrl}`);

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
    console.error(`post.mjs: rejected (HTTP ${res.status}): ${text.slice(0, 400)}`);
    process.exit(2);
  }
  console.error(`post.mjs: unexpected HTTP ${res.status}: ${text.slice(0, 400)}`);
  process.exit(3);
} catch (err) {
  console.error(`post.mjs: fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(3);
}
