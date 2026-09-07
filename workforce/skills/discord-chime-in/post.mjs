#!/usr/bin/env node
// discord-chime-in/post.mjs — deterministic WRITE for the "discord-chime-in"
// Cadence, invoked by the CCR agent-runner AFTER it has generated the comment.
// The LLM owns the judgment (what to react to, in whose voice); this script
// owns the structurally-exact write, so "LLM hand-builds the Discord payload
// and guesses the schema wrong" cannot recur.
//
// Two things differ from the discord-digest/discord-heartbeat siblings:
//
//   1. The credential is a BOT TOKEN, not a webhook URL. The token is not the
//      destination — it is an Authorization header (`Bot <token>`), and the
//      destination is the channel id passed by the binding config. So the
//      channel is an explicit arg, never baked into the URL constant.
//   2. The output is a PLAIN MESSAGE, not an embed. A persona speaking in a
//      chat channel should look like a participant; an embed card reads as a
//      bot notification. That moves the hard cap from the embed description's
//      4096 to a message's 2000 characters.
//
// Body is read from a FILE (not an arg) so multi-line / Unicode prose can't be
// mangled by shell quoting — load-bearing here, since these comments are
// Japanese.
//
// Usage:
//   BOT_TOKEN=<from credentials['discord.bot_token'].token> \
//     node workforce/skills/discord-chime-in/post.mjs \
//       --channel <channel_id> --agent <slug> --body-file /tmp/comment.txt \
//       [--min-chars 100] [--reply-to <message_id>] [--skill-version 0.1.0] \
//       [--dry-run]
//
// --dry-run runs every W-1 guard and prints the exact payload that WOULD be
// sent, then exits 0 without touching Discord. It needs no token, so the write
// path can be rehearsed before the credential exists. Pair it with
// preflight.mjs, which rehearses the read path against the live API.
//
// Exit codes:
//   0  — posted (Discord returned 2xx)
//   1  — bad args / env / body-file unreadable / body fails W-1
//   2  — Discord rejected the write (401 bad token, 403 missing permission,
//        404 unknown channel, 400 malformed)
//   3  — network / unexpected error

import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { readFileSync } from "node:fs";

const API_BASE = "https://discord.com/api/v10";
// Discord's hard cap on a plain message's content. We fail loud rather than
// truncate — a comment cut mid-sentence is exactly the C-1 failure class.
const DISCORD_MESSAGE_MAX = 2000;
// Generic floor against degenerate output ("うん。"). A persona whose prompt
// demands more (Nobita's 100 chars) raises it via the binding's
// config.min_chars, passed through as --min-chars.
const DEFAULT_MIN_CHARS = 20;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
function fail(code, message) {
  console.error(`post.mjs: ${message}`);
  process.exit(code);
}

const token = process.env.BOT_TOKEN;
const channelId = arg("channel");
const agent = arg("agent");
const bodyFile = arg("body-file");
const replyTo = arg("reply-to");
const skillVersion = arg("skill-version");
const minChars = Number(arg("min-chars") ?? DEFAULT_MIN_CHARS);
const dryRun = process.argv.includes("--dry-run");

// A dry run exercises the guards and the payload build, so it deliberately
// does NOT require the credential — that is the whole point of being able to
// rehearse before the token is provisioned.
if (!token && !dryRun) fail(1, "BOT_TOKEN env var is required (from credentials['discord.bot_token'].token)");
if (!channelId) fail(1, "--channel <channel_id> is required (from the binding's config.channel_id)");
if (!/^\d{5,}$/.test(channelId)) fail(1, `--channel "${channelId}" is not a Discord snowflake — pass the channel ID, not the channel URL`);
if (!agent) fail(1, "--agent <slug> is required");
if (!bodyFile) fail(1, "--body-file <path> is required");
if (!Number.isFinite(minChars) || minChars < 0) fail(1, `--min-chars must be a non-negative number (got "${arg("min-chars")}")`);

let body;
try {
  body = readFileSync(bodyFile, "utf8").trim();
} catch (err) {
  fail(1, `cannot read --body-file "${bodyFile}": ${err instanceof Error ? err.message : String(err)}`);
}

// ── W-1 editorial guard (client side) ───────────────────────────────────────
// A degraded comment fails loud here rather than landing in a channel humans
// read. The artefact list carries Japanese openers as well as English: this is
// the first Cadence whose output is Japanese by default, and the English-only
// list inherited from discord-digest would pass "申し訳ありませんが、私はAIなので"
// straight through.
const ARTEFACTS = [
  "as an ai",
  "i apologize",
  "i'm sorry",
  "certainly!",
  "sure, ",
  "here is the",
  "here's the",
  "申し訳ありません",
  "申し訳ございません",
  "私はaiな",
  "私はaiアシスタント",
  "以下のとおり",
  "以下の通り",
  "承知しました",
  "かしこまりました",
];
const head = body.slice(0, 50).toLowerCase();

// The two length checks deliberately measure differently, and the asymmetry
// is load-bearing — do NOT "fix" it by making them match.
//   floor: codepoints ([...body].length). A persona's "at least N characters"
//     means N characters as a human counts them.
//   cap:   UTF-16 units (body.length), which is >= the codepoint count. Whether
//     Discord's 2000 counts codepoints or UTF-16 units, the larger measure
//     rejects at or before Discord would, so a body full of astral-plane
//     characters (emoji) fails here with a clear message instead of taking an
//     HTTP 400 on the wire. Switching this to codepoints would be the unsafe
//     direction.
const bodyCodepoints = [...body].length;

if (body.length === 0) fail(1, "comment body is empty (W-1)");
if (ARTEFACTS.some((a) => head.startsWith(a))) {
  fail(1, `body opens with an LLM-failure artefact (W-1): "${head}"`);
}
if (bodyCodepoints < minChars) {
  fail(1, `comment is ${bodyCodepoints} char(s); the floor for this binding is ${minChars} (W-1). Write a fuller comment — do not pad.`);
}
if (body.length > DISCORD_MESSAGE_MAX) {
  fail(1, `comment is ${body.length} chars; Discord's plain-message hard cap is ${DISCORD_MESSAGE_MAX}. Shorten it (do not truncate — C-1) and re-run.`);
}

const payload = {
  content: body,
  // A persona commenting on what people said must never be able to ping the
  // channel. Suppressing every mention type means a literal "@everyone" in the
  // generated prose renders as text instead of notifying the server.
  allowed_mentions: { parse: [] },
};
if (replyTo) {
  // fail_if_not_exists:false — a deleted target degrades to a plain message
  // rather than failing the whole fire.
  payload.message_reference = { message_id: replyTo, fail_if_not_exists: false };
}

if (dryRun) {
  console.log(`post.mjs: DRY RUN — every W-1 guard passed; nothing was sent.`);
  console.log(`  POST ${API_BASE}/channels/${channelId}/messages`);
  console.log(`  agent          ${agent}${skillVersion ? ` (skill v${skillVersion})` : ""}`);
  console.log(`  length         ${bodyCodepoints} codepoints / ${body.length} UTF-16 units (floor ${minChars}, cap ${DISCORD_MESSAGE_MAX})`);
  console.log(`  payload        ${JSON.stringify(payload)}`);
  process.exit(0);
}

try {
  const res = await fetch(`${API_BASE}/channels/${channelId}/messages`, {
    method: "POST",
    headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text().catch(() => "");
  if (res.status < 200 || res.status >= 300) {
    fail(2, `Discord rejected the message: HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const posted = JSON.parse(text || "{}");
  console.log(
    `post.mjs: posted ${[...body].length} chars as ${agent}${skillVersion ? ` (skill v${skillVersion})` : ""} → channel ${channelId}, message ${posted.id ?? "?"}`,
  );
  process.exit(0);
} catch (err) {
  fail(3, `fetch failed: ${err instanceof Error ? err.message : String(err)}`);
}
