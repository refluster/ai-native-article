#!/usr/bin/env node
// discord-digest/post.mjs — deterministic write for the "discord-digest"
// Cadence, invoked by the CCR agent-runner AFTER it has *generated* the weekly
// digest prose. The LLM owns the judgment (which deliverables/posts/decisions
// matter this week, how to theme and voice them); this script owns the
// structurally-exact write to Discord so a malformed embed can't recur.
//
// Unlike feed-post (Bearer token → wf-agents-api) the Discord credential IS the
// destination: the injected discord.webhook_url is the URL we POST the embed to
// directly — no separate endpoint constant, no bearer header (Discord webhooks
// authenticate by the unguessable URL itself). Mirrors discord-heartbeat/post.mjs.
//
// Body is read from a FILE (not an arg) so multi-line / Unicode prose can't be
// mangled by shell quoting. The webhook URL is injected per-fire
// (credentials['discord.webhook_url'].url) — never read from anywhere else.
//
// Usage:
//   DISCORD_WEBHOOK_URL="<credentials['discord.webhook_url'].url>" \
//     node workforce/skills/discord-digest/post.mjs \
//       --agent priya --body-file /tmp/digest.md \
//       [--title "Weekly workforce digest · week of 2026-06-01"] [--skill-version 0.1.0]
//
// Exit codes:
//   0  — Discord returned 2xx (posted)
//   1  — bad args / env / body-file unreadable / body fails W-1
//   2  — non-2xx response from Discord (e.g. 400 malformed, 401 bad URL)
//   3  — network / fetch error

import "../../../scripts/lib/proxy-bootstrap.mjs";

import { readFileSync } from "node:fs";

const COLOR_DIGEST = 0x9b59b6; // amethyst — distinct from heartbeat's info-blue
// Discord embed description hard cap. We fail loud rather than truncate (C-1).
const DISCORD_EMBED_DESC_MAX = 4096;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
const agent = arg("agent");
const bodyFile = arg("body-file");
const title = arg("title") ?? "Weekly workforce digest";
const skillVersion = arg("skill-version");

if (!webhookUrl) { console.error("post.mjs: DISCORD_WEBHOOK_URL env var is required (from credentials['discord.webhook_url'].url)"); process.exit(1); }
if (!/^https:\/\/discord\.com\/api\/webhooks\//.test(webhookUrl)) {
  console.error(`post.mjs: DISCORD_WEBHOOK_URL does not look like a Discord webhook URL (got "${webhookUrl.slice(0, 60)}...")`);
  process.exit(1);
}
if (!agent) { console.error("post.mjs: --agent <slug> is required"); process.exit(1); }
if (!bodyFile) { console.error("post.mjs: --body-file <path> is required"); process.exit(1); }

let body;
try {
  body = readFileSync(bodyFile, "utf8").trim();
} catch (err) {
  console.error(`post.mjs: cannot read --body-file "${bodyFile}": ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

// W-1 editorial guard (client side). A degraded digest fails loud here rather
// than landing in the channel.
const ARTEFACTS = ["as an ai", "i apologize", "i'm sorry", "certainly!", "sure, ", "here is the", "here's the"];
const head = body.slice(0, 50).toLowerCase();
if (body.length === 0) { console.error("post.mjs: digest body is empty (W-1)"); process.exit(1); }
if (ARTEFACTS.some((a) => head.startsWith(a))) { console.error(`post.mjs: body opens with an LLM-failure artefact (W-1): "${head}"`); process.exit(1); }
if (body.length > DISCORD_EMBED_DESC_MAX) {
  console.error(`post.mjs: digest body is ${body.length} chars; Discord embed description hard cap is ${DISCORD_EMBED_DESC_MAX}. Shorten it (do not truncate — C-1) and re-run.`);
  process.exit(1);
}

const payload = {
  embeds: [
    {
      title: title.slice(0, 256), // Discord title cap
      description: body,
      color: COLOR_DIGEST,
      timestamp: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      footer: { text: `wf-digest · ${agent}${skillVersion ? ` · v${skillVersion}` : ""}` },
    },
  ],
};

try {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.status < 200 || res.status >= 300) {
    const text = await res.text().catch(() => "");
    console.error(`post.mjs: Discord webhook returned HTTP ${res.status}: ${text.slice(0, 256)}`);
    process.exit(2);
  }
  console.log(`post.mjs: posted weekly digest for ${agent} (${body.length} chars)`);
  process.exit(0);
} catch (err) {
  console.error(`post.mjs: fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(3);
}
