// Deterministic handler for the discord-ping skill.
// See ./SKILL.md for the contract.
//
// Input: agent slug + run timestamp.
// Output bytes: the human-readable heartbeat line (persisted to S3 for
// audit; identical to the title displayed in the Discord embed).
// Side effect: POST a Discord embed (color-coded sidebar for at-a-glance
// health) to the webhook URL behind DISCORD_WEBHOOK_SECRET.
//
// Lives alongside SKILL.md (Anthropic-Skills bundle convention) — the
// workforce agent-runner picks it up via the build-time generated
// skill-registry-generated.ts. Adding a new deterministic skill means
// dropping a folder under workforce/skills/{name}/ with SKILL.md +
// meta.json + handler.ts — no edits to lambdas/.

import type { DeterministicResult, RunnerContext } from "../../lambdas/shared/skill-types.js";
import { postToWebhook } from "../../lambdas/shared/webhook.js";

/**
 * Discord embed sidebar color for "alive / healthy" heartbeats.
 * 0x3498db is the conventional "info blue" used across Discord bot
 * frameworks. Distinct from Discord's brand blurple (0x5865F2) so
 * heartbeat embeds don't blend into Discord's own UI chrome.
 *
 * Future health states (when discord-ping or a sibling skill grows
 * to report degradation): green 0x2ecc71 = ok, yellow 0xf1c40f = warn,
 * red 0xe74c3c = critical.
 */
const COLOR_ALIVE = 0x3498db;

export async function dispatchDiscordPing(ctx: RunnerContext): Promise<DeterministicResult> {
  const secretName = process.env.DISCORD_WEBHOOK_SECRET;
  if (!secretName) {
    throw new Error("DISCORD_WEBHOOK_SECRET env var is required for discord-ping handler");
  }

  // Strip sub-second precision — heartbeats don't need millis and the
  // SKILL.md contract says "second precision".
  const isoSecond = ctx.startedAt.replace(/\.\d+Z$/, "Z");
  const line = `[wf-pulse] ${ctx.slug} alive at ${isoSecond}`;

  const { status } = await postToWebhook(secretName, {
    embeds: [
      {
        title: `wf-pulse · ${ctx.slug}`,
        color: COLOR_ALIVE,
        timestamp: isoSecond,
      },
    ],
  });

  return {
    output: line,
    outputExt: "txt",
    summary: line,
    side_effect: { kind: "discord-webhook", status },
  };
}
