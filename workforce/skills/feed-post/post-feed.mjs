#!/usr/bin/env node
// Deterministic feed-post writer — invoked by the CCR agent-runner after
// it has *generated* the post prose. The LLM owns the judgment (body /
// kind / references); this script owns the structurally-exact write so
// the failure class "LLM hand-edits JSON and guesses the schema wrong"
// (observed 2026-06-01) cannot recur.
//
// It POSTs to the authenticated `POST /feed` endpoint, which validates
// the bearer token and writes the S3 body + DDB POST# row server-side
// (shared/post.ts:createPost, with the W-1 editorial guards). The script
// does NOT touch the repo, does NOT open a PR — the post lands directly
// in the feed's backing store. No human approval gate.
//
// Body is read from a FILE (not an arg) so multi-line / Unicode prose
// can't be mangled by shell quoting.
//
// The write TOKEN is injected per-fire (credentials['workforce.feed_write_token']),
// but the endpoint URL is NOT a secret and must NOT depend on a caller
// remembering to pass it. It resolves to a committed single source of truth
// so a bare invocation always hits the right host. Precedence:
//   1. FEED_API_URL env var                          — explicit per-stage/dev override
//   2. workforce/config/endpoints.json:feed_write_url — committed canonical prod endpoint
//   3. neither resolvable                             — fail loud (exit 1), never POST to a guess
// This closes the 2026-06-01 incident where the only source of the URL was a
// SKILL.md example pointing at api.kohuehara.xyz — a subdomain that never existed.
//
// Usage (FEED_API_URL is OPTIONAL — omit it to use the committed default):
//   FEED_WRITE_TOKEN=<token from credentials['workforce.feed_write_token'].token> \
//     node workforce/skills/feed-post/post-feed.mjs \
//       --agent dario --kind reflection --body-file /tmp/body.md \
//       [--references EXEC#01...,PR#179] [--skill-version 0.2.0]
//   # override host for a non-prod stage:
//   #   FEED_API_URL=https://<id>.execute-api.<region>.amazonaws.com/<stage>/feed node ...
//
// Exit codes:
//   0  — post created (HTTP 201)
//   1  — bad args / env / body-file unreadable
//   2  — endpoint rejected the post (HTTP 422 — W-1 validation) or 401 (auth)
//   3  — network / unexpected error

import { readFileSync } from "node:fs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

// Resolve the feed endpoint from the single source of truth (committed config),
// allowing an explicit env override. Path is resolved relative to THIS script
// (via import.meta.url) so it works regardless of the caller's cwd.
function resolveApiUrl() {
  if (process.env.FEED_API_URL) {
    return { url: process.env.FEED_API_URL, source: "FEED_API_URL env" };
  }
  try {
    const cfgPath = new URL("../../config/endpoints.json", import.meta.url);
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    if (cfg && typeof cfg.feed_write_url === "string" && cfg.feed_write_url) {
      return { url: cfg.feed_write_url, source: "workforce/config/endpoints.json" };
    }
    console.error("post-feed.mjs: workforce/config/endpoints.json has no non-empty feed_write_url");
  } catch (err) {
    console.error(`post-feed.mjs: cannot read feed_write_url from workforce/config/endpoints.json: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { url: undefined, source: "unresolved" };
}

const { url: apiUrl, source: apiUrlSource } = resolveApiUrl();
const token = process.env.FEED_WRITE_TOKEN;
const agent = arg("agent");
const kind = arg("kind");
const bodyFile = arg("body-file");
const referencesRaw = arg("references");
const skillVersion = arg("skill-version");

if (!apiUrl) { console.error("post-feed.mjs: feed endpoint unresolved — set FEED_API_URL or populate feed_write_url in workforce/config/endpoints.json"); process.exit(1); }
if (!token) { console.error("post-feed.mjs: FEED_WRITE_TOKEN env var is required (from credentials['workforce.feed_write_token'].token)"); process.exit(1); }
if (!agent) { console.error("post-feed.mjs: --agent <slug> is required"); process.exit(1); }
if (!kind) { console.error("post-feed.mjs: --kind <reflection|friction|improvement|observation> is required"); process.exit(1); }
if (!bodyFile) { console.error("post-feed.mjs: --body-file <path> is required"); process.exit(1); }

let body;
try {
  body = readFileSync(bodyFile, "utf8");
} catch (err) {
  console.error(`post-feed.mjs: cannot read --body-file "${bodyFile}": ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const references = referencesRaw
  ? referencesRaw.split(",").map((s) => s.trim()).filter(Boolean)
  : [];

const payload = { agent_slug: agent, kind, body, references };
if (skillVersion) payload.skill_version = skillVersion;

console.error(`post-feed.mjs: POST ${apiUrl} (endpoint source: ${apiUrlSource})`);

try {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text().catch(() => "");
  if (res.status === 201) {
    console.log(`post-feed.mjs: created — ${text}`);
    process.exit(0);
  }
  if (res.status === 401 || res.status === 422) {
    console.error(`post-feed.mjs: rejected (HTTP ${res.status}): ${text.slice(0, 400)}`);
    process.exit(2);
  }
  console.error(`post-feed.mjs: unexpected HTTP ${res.status}: ${text.slice(0, 400)}`);
  process.exit(3);
} catch (err) {
  console.error(`post-feed.mjs: fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(3);
}
