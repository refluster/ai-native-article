#!/usr/bin/env node
// discord-chime-in/preflight.mjs — read-only rehearsal of everything this
// Cadence needs from Discord, so a misconfiguration is caught in seconds
// instead of at the next 01:11 UTC fire.
//
// Why this exists: the cadence's first four scheduled fires all died at
// credential-prep with a CloudWatch-only error and no EXEC row, so from the
// console the cadence looked like it had simply never run. Every check below
// is one the operator would otherwise have to infer from a failed fire.
//
// It NEVER posts. The only writes this skill can perform live in post.mjs.
//
// Usage:
//   BOT_TOKEN="<the discord bot token>" \
//     node workforce/skills/discord-chime-in/preflight.mjs --channel <channel_id>
//
// Exit codes:
//   0  — every check passed; the cadence will work once the token is stored
//        at wf/projects/{project}/discord.bot_token
//   1  — bad args / env
//   2  — a Discord-side check failed (bad token, missing permission, missing
//        MESSAGE CONTENT intent). stderr names which one and the fix.
//   3  — network / unexpected error

import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

const API_BASE = "https://discord.com/api/v10";

// Discord permission bits we need on the target channel.
const PERM_VIEW_CHANNEL = 1n << 10n;
const PERM_SEND_MESSAGES = 1n << 11n;
const PERM_READ_HISTORY = 1n << 16n;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
function fail(code, message, fix) {
  console.error(`\n  FAIL  ${message}`);
  if (fix) console.error(`        fix: ${fix}`);
  process.exit(code);
}
function ok(message) {
  console.log(`  ok    ${message}`);
}

const token = process.env.BOT_TOKEN;
const channelId = arg("channel");
const windowHours = Number(arg("window-hours") ?? 24);

if (!token) fail(1, "BOT_TOKEN env var is required", "BOT_TOKEN=<token> node preflight.mjs --channel <id>");
if (!channelId) fail(1, "--channel <channel_id> is required");
if (!/^\d{5,}$/.test(channelId)) {
  fail(1, `--channel "${channelId}" is not a Discord snowflake`,
    "pass the channel ID, not the channel URL — the ID is the LAST path segment of https://discord.com/channels/<guild>/<channel>");
}

async function get(path) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers: { authorization: `Bot ${token}` } });
  } catch (err) {
    fail(3, `network error on GET ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return res;
}

console.log(`\ndiscord-chime-in preflight — channel ${channelId}\n`);

// 1. Token validity + bot identity.
const meRes = await get("/users/@me");
if (meRes.status === 401) {
  fail(2, "Discord rejected the token (401).",
    "the stored value is not a valid bot token — check it was saved under credential type `discord.bot_token`, not `github.token`, and that it is the BOT token from the Bot tab (not the client secret / application ID)");
}
if (!meRes.ok) fail(2, `GET /users/@me returned HTTP ${meRes.status}: ${(await meRes.text().catch(() => "")).slice(0, 200)}`);
const me = await meRes.json();
ok(`token valid — bot is "${me.username}" (id ${me.id})`);

// 2. Channel reachable.
const chRes = await get(`/channels/${channelId}`);
if (chRes.status === 403) {
  fail(2, "the bot cannot see that channel (403).",
    "invite the bot to the server and grant it View Channel on this channel");
}
if (chRes.status === 404) {
  fail(2, "channel not found (404).",
    "check the channel ID, and that the bot is in the server that owns it");
}
if (!chRes.ok) fail(2, `GET /channels/${channelId} returned HTTP ${chRes.status}`);
const ch = await chRes.json();
ok(`channel reachable — #${ch.name ?? "?"} (type ${ch.type}) in guild ${ch.guild_id ?? "?"}`);

// 3. Effective permissions on the channel, when the API reports them.
if (typeof ch.permissions === "string") {
  const perms = BigInt(ch.permissions);
  const need = [
    ["View Channel", PERM_VIEW_CHANNEL],
    ["Read Message History", PERM_READ_HISTORY],
    ["Send Messages", PERM_SEND_MESSAGES],
  ];
  const missing = need.filter(([, bit]) => (perms & bit) === 0n).map(([n]) => n);
  if (missing.length) {
    fail(2, `the bot is missing channel permission(s): ${missing.join(", ")}`,
      "grant them on the channel (or the role) in Discord's channel settings");
  }
  ok("channel permissions — View Channel, Read Message History, Send Messages all present");
} else {
  console.log("  note  Discord did not report effective permissions on this response;");
  console.log("        the read below still proves View Channel + Read Message History.");
}

// 4. The actual read the cadence performs — and the MESSAGE CONTENT intent.
const msgRes = await get(`/channels/${channelId}/messages?limit=25`);
if (msgRes.status === 403) {
  fail(2, "the bot cannot read message history (403).",
    "grant Read Message History on this channel");
}
if (!msgRes.ok) fail(2, `GET /channels/${channelId}/messages returned HTTP ${msgRes.status}`);
const msgs = await msgRes.json();
ok(`message read works — ${msgs.length} message(s) returned`);

const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
const human = msgs.filter((m) => !m.author?.bot && m.author?.id !== me.id);
const inWindow = human.filter((m) => new Date(m.timestamp) > since);
const emptyContent = msgs.filter((m) => (m.content ?? "") === "");

// The MESSAGE CONTENT intent is the classic silent failure: the read succeeds
// but every `content` comes back "", which is indistinguishable from a quiet
// channel unless you look for it explicitly.
if (msgs.length > 0 && emptyContent.length === msgs.length) {
  fail(2, `all ${msgs.length} message(s) came back with EMPTY content — the app is missing the MESSAGE CONTENT privileged intent.`,
    "Discord Developer Portal → your app → Bot → Privileged Gateway Intents → enable MESSAGE CONTENT INTENT");
}
if (emptyContent.length > 0) {
  console.log(`  note  ${emptyContent.length}/${msgs.length} message(s) have empty content (attachment/embed-only posts are normally empty)`);
}
ok("MESSAGE CONTENT intent — readable message text is present");

console.log(`\n  the cadence's actual input right now:`);
console.log(`    window          last ${windowHours}h (since ${since.toISOString()})`);
console.log(`    human messages  ${inWindow.length}`);
if (inWindow.length === 0) {
  console.log(`\n  Every check passed. Note the window is currently EMPTY, so a fire right`);
  console.log(`  now would correctly SKIP without posting (that is the designed skip path,`);
  console.log(`  not a failure). Post something in the channel to see a real comment.`);
} else {
  const newest = inWindow[0];
  console.log(`    newest          "${(newest.content ?? "").slice(0, 60).replace(/\n/g, " ")}"`);
  console.log(`\n  Every check passed, and there is material in the window — the next fire`);
  console.log(`  should produce a comment.`);
}
console.log();
process.exit(0);
