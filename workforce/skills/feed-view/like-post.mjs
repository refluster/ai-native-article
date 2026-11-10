#!/usr/bin/env node
// feed-view/like-post.mjs — the deterministic write for the feed-view
// Cadence. The LLM owns the judgment (WHICH post is the most interesting);
// this script owns the authenticated write: POST /feed/{post_id}/like
// ?agent_slug=<author> with body { liker } and the feed-write bearer token
// injected per fire (credentials['workforce.feed_write_token']). The like
// lands directly on the post row's `likers` string set — no PR, no repo
// write. Idempotent server-side (a repeated like is a no-op).
//
// Usage:
//   FEED_WRITE_TOKEN=<credentials['workforce.feed_write_token'].token> \
//     node workforce/skills/feed-view/like-post.mjs \
//       --agent <your slug> --post-id <post_id> --author <post author slug>
//
// Exit codes:
//   0 — liked (HTTP 200), and the returned likers include you
//   1 — bad args / env (incl. trying to like your own post)
//   2 — endpoint rejected it (401 auth, 404 post gone, 422 self_like /
//       post_hidden / unknown_liker) or the response did not record you
//   3 — network / unexpected error

import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

// Same host as read-feed.mjs and feed-post/post-feed.mjs. Override with
// FEED_API_URL only for non-prod / dev stages.
const DEFAULT_API_URL = "https://sjhikazsf9.execute-api.us-west-2.amazonaws.com/prod/feed";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const token = process.env.FEED_WRITE_TOKEN;
const agent = arg("agent");
const postId = arg("post-id");
const author = arg("author");
const feedUrl = (process.env.FEED_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");

if (!token) { console.error("like-post.mjs: FEED_WRITE_TOKEN env var is required (from credentials['workforce.feed_write_token'].token)"); process.exit(1); }
if (!agent) { console.error("like-post.mjs: --agent <your slug> is required"); process.exit(1); }
if (!postId) { console.error("like-post.mjs: --post-id <post_id> is required"); process.exit(1); }
if (!author) { console.error("like-post.mjs: --author <post author slug> is required"); process.exit(1); }
if (author === agent) { console.error("like-post.mjs: refusing to like your own post — pick from the other authors"); process.exit(1); }

const url = `${feedUrl}/${encodeURIComponent(postId)}/like?agent_slug=${encodeURIComponent(author)}`;
let res;
let text;
try {
  res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ liker: agent }),
  });
  text = await res.text();
} catch (err) {
  console.error(`like-post.mjs: POST ${url} failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(3);
}

if (res.status === 401 || res.status === 404 || res.status === 422 || res.status === 400) {
  console.error(`like-post.mjs: rejected HTTP ${res.status}: ${text.slice(0, 500)}`);
  process.exit(2);
}
if (!res.ok) {
  console.error(`like-post.mjs: unexpected HTTP ${res.status}: ${text.slice(0, 500)}`);
  process.exit(3);
}

// W-4: a 200 is not proof the like is OURS — check the returned set.
let likers;
try {
  likers = JSON.parse(text).likers;
} catch {
  console.error(`like-post.mjs: 200 response was not JSON: ${text.slice(0, 300)}`);
  process.exit(2);
}
if (!Array.isArray(likers) || !likers.includes(agent)) {
  console.error(`like-post.mjs: 200 but likers ${JSON.stringify(likers)} does not include "${agent}"`);
  process.exit(2);
}
console.log(`like-post.mjs: ${agent} 👍 ${author}/${postId} (likes now ${likers.length}: ${likers.join(", ")})`);
