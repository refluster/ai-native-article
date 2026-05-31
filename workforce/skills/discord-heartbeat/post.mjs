#!/usr/bin/env node
// Standalone Discord heartbeat poster — invoked by the CCR agent-runner
// session when discord-heartbeat fires. Deterministic by construction:
// same inputs → identical webhook payload, no LLM in this path.
//
// Why a script and not LLM-built JSON: a heartbeat's value is "the
// dispatch chain is alive" — that signal is meaningful only if every
// fire produces structurally identical output. Letting an LLM re-build
// the embed every hour wastes tokens and introduces drift (off-by-one
// hex color, missed field, etc.). The LLM in the CCR session does one
// thing: `execSync('node post.mjs')`, then surfaces the exit code.
//
// The embed shape mirrors workforce/skills/discord-ping/handler.ts so
// the two heartbeat paths look identical in Discord. When the trial
// validates and discord-heartbeat retires discord-ping, this script
// becomes the canonical implementation (the handler.ts can `import`
// from here in a future cleanup PR).
//
// Usage:
//   DISCORD_WEBHOOK_URL=<url> AGENT_SLUG=<slug> [TICKED_AT=<iso>] \
//     node workforce/skills/discord-heartbeat/post.mjs
//
// Exit codes:
//   0   — Discord returned 204 (success)
//   1   — env var missing / malformed
//   2   — non-2xx response from Discord
//   3   — network / fetch error
//
// Stdout: a single human-readable line (the same line format that
// discord-ping writes to S3 for audit). Stderr: error detail.

const COLOR_ALIVE = 0x3498db; // info blue — matches workforce/skills/discord-ping/handler.ts

const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
const agentSlug = process.env.AGENT_SLUG;
const tickedAt = process.env.TICKED_AT ?? new Date().toISOString();

if (!webhookUrl) {
  console.error("post.mjs: DISCORD_WEBHOOK_URL env var is required");
  process.exit(1);
}
if (!agentSlug) {
  console.error("post.mjs: AGENT_SLUG env var is required");
  process.exit(1);
}
if (!/^https:\/\/discord\.com\/api\/webhooks\//.test(webhookUrl)) {
  console.error(`post.mjs: DISCORD_WEBHOOK_URL does not look like a Discord webhook URL (got "${webhookUrl.slice(0, 60)}...")`);
  process.exit(1);
}

// Strip sub-second precision — matches discord-ping/handler.ts "second
// precision" rule for the embed timestamp and the audit line.
const isoSecond = tickedAt.replace(/\.\d+Z$/, "Z");
const line = `[wf-pulse] ${agentSlug} alive at ${isoSecond}`;

const payload = {
  embeds: [
    {
      title: `wf-pulse · ${agentSlug}`,
      color: COLOR_ALIVE,
      timestamp: isoSecond,
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
  console.log(line);
  process.exit(0);
} catch (err) {
  console.error(`post.mjs: fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(3);
}
