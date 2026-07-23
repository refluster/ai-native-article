#!/usr/bin/env node
// ops-accountability-watch/notify.mjs — Step 3 of the Cadence pipeline: the
// ONE aggregate chat mirror per fire (never one message per finding — see
// workforce/docs/runbooks/chat-notification-policy.md). Webhook is primary
// (it can set a display name via `username`); a bot-token path is wired for
// completeness but is not provisioned for the agent-workforce project today
// — see the README note in workforce/seed/vp-operations/.
//
// Usage:
//   DISCORD_WEBHOOK_URL=<credentials['discord.webhook_url'].url> \
//     node notify.mjs --findings-file /tmp/findings.json --issue-links-file /tmp/links.json \
//       --swept-surfaces-file /tmp/findings.json --mode observation
//
// Exit codes: 0 posted, 1 bad args/env, 2 endpoint rejected (4xx/5xx), 3 network error.

import { readFileSync } from "node:fs";
import { buildNotificationPayload, toDiscordWebhookBody } from "./payload.mjs";

function parseArgs(argv) {
  const args = { mode: "observation" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--findings-file") args.findingsFile = argv[++i];
    else if (a === "--issue-links-file") args.issueLinksFile = argv[++i];
    else if (a === "--mode") args.mode = argv[++i];
  }
  return args;
}

function fail(code, message) {
  console.error(`notify.mjs: ${message}`);
  process.exit(code);
}

async function postViaWebhook(webhookUrl, body) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res;
}

// Bot-token fallback: posts as the bot's own identity — Discord does not let
// a bot message override its display name per-post (unlike a webhook's
// `username` field), so this path logs that limitation explicitly rather
// than silently pretending parity with the webhook path.
async function postViaBotToken(botToken, channelId, body) {
  console.error(
    "notify.mjs: using discord.bot_token fallback — sender display name is the bot's own identity, NOT overridable per-post (webhook parity is lost on this path).",
  );
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: { authorization: `Bot ${botToken}`, "content-type": "application/json" },
    body: JSON.stringify({ embeds: body.embeds }),
  });
  return res;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.findingsFile) fail(1, "--findings-file is required");

  let findingsEnvelope;
  try {
    findingsEnvelope = JSON.parse(readFileSync(args.findingsFile, "utf8"));
  } catch (err) {
    fail(1, `could not read/parse --findings-file: ${err.message}`);
  }

  let issueLinks = [];
  if (args.issueLinksFile) {
    try {
      issueLinks = JSON.parse(readFileSync(args.issueLinksFile, "utf8"));
    } catch (err) {
      fail(1, `could not read/parse --issue-links-file: ${err.message}`);
    }
  }

  const payload = buildNotificationPayload(
    issueLinks,
    { sweptSurfaces: findingsEnvelope.sweptSurfaces ?? [], mode: args.mode },
    new Date(findingsEnvelope.generatedAt ?? Date.now()),
  );
  const body = toDiscordWebhookBody(payload);

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;

  let res;
  try {
    if (webhookUrl) {
      res = await postViaWebhook(webhookUrl, body);
    } else if (botToken && channelId) {
      res = await postViaBotToken(botToken, channelId, body);
    } else {
      fail(1, "neither DISCORD_WEBHOOK_URL nor (DISCORD_BOT_TOKEN + DISCORD_CHANNEL_ID) is set");
    }
  } catch (err) {
    fail(3, `network error posting to Discord: ${err.message}`);
  }

  if (!res.ok) {
    fail(2, `Discord rejected the notification: HTTP ${res.status} ${await res.text().catch(() => "")}`);
  }

  console.log(JSON.stringify({ posted: true, mode: payload.mode, status: res.status }));
  process.exit(0);
}

main();
