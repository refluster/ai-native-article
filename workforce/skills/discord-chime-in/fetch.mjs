#!/usr/bin/env node
// discord-chime-in/fetch.mjs — deterministic READ for the "discord-chime-in"
// Cadence. Step 1 of the sandwich: this script owns the authenticated read,
// the LLM owns the judgment, post.mjs owns the authenticated write.
//
// Ported from luckyhat-ms/ai-instances/src/discord-bot/discord-service.ts
// (getMessagesSinceTimestamp) + message-processor.ts, with one deliberate
// simplification: the original tracked `botLastIntervalPostTime` in DynamoDB to
// know where it left off. A Cadence fires on a fixed cron, so the window is
// derived arithmetically from --window-hours instead. That removes the whole
// state store (bot-repository.ts / bot-scheduler.ts) from the port.
//
// Reads are scoped to ONE channel, passed by the binding's config.channel_id —
// never hardcoded here, never read from a secret. The bot token IS the
// capability; the channel id is a parameter.
//
// Usage:
//   BOT_TOKEN=<from credentials['discord.bot_token'].token> \
//     node workforce/skills/discord-chime-in/fetch.mjs \
//       --channel <channel_id> [--window-hours 24] [--max-messages 100] \
//       [--include-bots] [--out /tmp/chime-in-context.json]
//
// Writes the context envelope to --out (default stdout). Exit codes:
//   0  — read succeeded (count MAY be 0 — an empty window is a valid state and
//        the skill's skip path, NOT an error)
//   1  — bad args / env
//   2  — Discord rejected the read (401 bad token, 403 missing permission,
//        404 unknown channel)
//   3  — network / unexpected error

import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { writeFileSync } from "node:fs";

const API_BASE = "https://discord.com/api/v10";
// Discord's own per-request cap on GET /channels/{id}/messages.
const PAGE_LIMIT = 100;
// Hard ceiling on pagination so a busy channel can't blow the prompt budget.
const MAX_PAGES = 5;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}
function fail(code, message) {
  console.error(`fetch.mjs: ${message}`);
  process.exit(code);
}

const token = process.env.BOT_TOKEN;
const channelId = arg("channel");
const windowHours = Number(arg("window-hours") ?? 24);
const maxMessages = Number(arg("max-messages") ?? PAGE_LIMIT);
const includeBots = flag("include-bots");
const outFile = arg("out");

if (!token) fail(1, "BOT_TOKEN env var is required (from credentials['discord.bot_token'].token)");
if (!channelId) fail(1, "--channel <channel_id> is required (from the binding's config.channel_id)");
if (!/^\d{5,}$/.test(channelId)) fail(1, `--channel "${channelId}" is not a Discord snowflake — pass the channel ID, not the channel URL`);
if (!Number.isFinite(windowHours) || windowHours <= 0) fail(1, `--window-hours must be a positive number (got "${arg("window-hours")}")`);
if (!Number.isFinite(maxMessages) || maxMessages <= 0) fail(1, `--max-messages must be a positive number (got "${arg("max-messages")}")`);

async function discordGet(path) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { authorization: `Bot ${token}` },
    });
  } catch (err) {
    fail(3, `network error on GET ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  // One courteous retry on a 429. Anything more is the next fire's job — a
  // Cadence never busy-loops inside a single fire.
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after") ?? 2);
    console.error(`fetch.mjs: rate limited on GET ${path}, retrying once after ${retryAfter}s`);
    await new Promise((r) => setTimeout(r, Math.min(retryAfter, 10) * 1000));
    try {
      res = await fetch(`${API_BASE}${path}`, { headers: { authorization: `Bot ${token}` } });
    } catch (err) {
      fail(3, `network error on GET ${path} (retry): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (res.status < 200 || res.status >= 300) {
    const text = await res.text().catch(() => "");
    fail(2, `Discord returned HTTP ${res.status} on GET ${path}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// Identify ourselves first. Two jobs: it validates the token before we spend a
// read on the channel, and it gives us the id to filter our own past posts out
// of the context (otherwise the persona reads its own last comment as input and
// converges on talking to itself).
const self = await discordGet("/users/@me");
const selfId = self.id;

const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
const collected = [];
let before;
let reachedWindowEdge = false;

for (let page = 0; page < MAX_PAGES && !reachedWindowEdge; page++) {
  const qs = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  if (before) qs.set("before", before);
  const batch = await discordGet(`/channels/${channelId}/messages?${qs}`);
  if (!Array.isArray(batch) || batch.length === 0) break;

  for (const m of batch) {
    if (new Date(m.timestamp) <= since) {
      // Discord returns newest-first, so the first message older than the
      // window means everything after it is older too.
      reachedWindowEdge = true;
      break;
    }
    if (m.author?.id === selfId) continue;
    if (m.author?.bot && !includeBots) continue;
    // A message with no content is an attachment/embed-only post. The REST
    // read also returns empty content when the app lacks the MESSAGE CONTENT
    // intent — see the SKILL.md failure modes; a whole window of empty
    // strings is that misconfiguration, not a quiet channel.
    collected.push({
      id: m.id,
      author_id: m.author?.id ?? null,
      author_name: m.author?.global_name || m.author?.username || null,
      is_bot: Boolean(m.author?.bot),
      timestamp: m.timestamp,
      content: m.content ?? "",
    });
  }

  before = batch[batch.length - 1].id;
  if (batch.length < PAGE_LIMIT) break;
  if (collected.length >= maxMessages) break;
}

// Oldest-first: the persona should read the conversation in the order it
// happened, not backwards.
collected.reverse();
const messages = collected.slice(-maxMessages);

const envelope = {
  channel_id: channelId,
  window_hours: windowHours,
  since: since.toISOString(),
  fetched_at: new Date().toISOString(),
  self_id: selfId,
  self_username: self.username ?? null,
  truncated: collected.length > messages.length,
  count: messages.length,
  empty_content_count: messages.filter((m) => m.content.trim() === "").length,
  messages,
};

const json = JSON.stringify(envelope, null, 2);
if (outFile) {
  writeFileSync(outFile, json, "utf8");
  console.error(`fetch.mjs: ${messages.length} message(s) in the last ${windowHours}h → ${outFile}`);
} else {
  process.stdout.write(json + "\n");
}
process.exit(0);
