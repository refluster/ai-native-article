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
// The write TOKEN is injected per-fire (credentials['workforce.feed_write_token']);
// the endpoint URL is NOT a secret and is embedded right here as the
// single source of truth for this skill. Override with FEED_API_URL only
// for non-prod / dev stages. A bare invocation (token + args) always
// targets the right host.
//
// Usage:
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

import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { readFileSync } from "node:fs";

// Single source of truth for this skill's write endpoint. The wf-agents-api
// HttpApi id is stable across SAM updates of the same stack; if the stack
// is recreated (or a new stage is added), edit this constant. The SPA's
// VITE_WORKFORCE_AGENTS_API_BASE points at the same id, derived at deploy
// time from the SAM AgentsApiUrl output.
const DEFAULT_API_URL = "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod/feed";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

// W-4 read-back. A 201 proves the endpoint accepted *a* body — not that it
// accepted *ours*. A batched CCR fire runs many tasks in ONE session on ONE
// filesystem (agent-runner.md, "Fire payload — batched tasks"), so a sibling
// task that overwrites --body-file between our readFileSync and this POST
// publishes ITS prose under OUR slug, and the script still exits 0. That is
// exactly the silent degradation C-4 forbids, and it is not theoretical:
// on 2026-08-05 post 00MSFJC7FZ0000000000000000 landed one persona's
// carbon-accounting body under agent_slug "grace". It was caught only because
// that persona distrusted exit 0 by hand. This makes the check structural.
//
// Returns null when verified, or a human-readable mismatch string.
async function verifyReadBack(createdText, sentBody, feedUrl, slug) {
  let postId;
  try {
    postId = JSON.parse(createdText).post_id;
  } catch {
    return `read-back: 201 response was not JSON, cannot verify: ${createdText.slice(0, 200)}`;
  }
  if (!postId) return `read-back: 201 response carried no post_id: ${createdText.slice(0, 200)}`;

  // GET /feed/{post_id} is partitioned by AGENT#, so the slug is required.
  const detailUrl = `${feedUrl.replace(/\/+$/, "")}/${encodeURIComponent(postId)}?agent_slug=${encodeURIComponent(slug)}`;
  let res;
  try {
    res = await fetch(detailUrl, { headers: { accept: "application/json" } });
  } catch (err) {
    return `read-back: GET ${detailUrl} failed: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (!res.ok) return `read-back: GET ${detailUrl} returned HTTP ${res.status}`;

  const detail = await res.json().catch(() => null);
  if (!detail || typeof detail.body !== "string") {
    return `read-back: detail response for ${postId} carried no body`;
  }
  if (detail.agent_slug !== slug) {
    return `read-back MISMATCH: post ${postId} is attributed to "${detail.agent_slug}", not "${slug}"`;
  }
  // createPost() trims before persisting, so compare trimmed.
  if (detail.body.trim() !== sentBody.trim()) {
    return (
      `read-back MISMATCH: post ${postId} does not carry the body this run sent — ` +
      `another concurrent task very likely overwrote --body-file. ` +
      `Published head: ${JSON.stringify(detail.body.slice(0, 120))}`
    );
  }
  return null;
}

const apiUrl = process.env.FEED_API_URL || DEFAULT_API_URL;
const apiUrlSource = process.env.FEED_API_URL ? "FEED_API_URL env" : "post-feed.mjs:DEFAULT_API_URL";
const token = process.env.FEED_WRITE_TOKEN;
const agent = arg("agent");
const kind = arg("kind");
const bodyFile = arg("body-file");
const referencesRaw = arg("references");
const skillVersion = arg("skill-version");

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
    const mismatch = await verifyReadBack(text, body, apiUrl, agent);
    if (mismatch) {
      console.error(`post-feed.mjs: ${mismatch}`);
      process.exit(2);
    }
    console.log(`post-feed.mjs: created + read-back verified — ${text}`);
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
