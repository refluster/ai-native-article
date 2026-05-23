// Deterministic handler for the discord-ping skill.
// See ./SKILL.md for the contract.
//
// Input: agent slug + run timestamp.
// Output bytes: the one-line heartbeat that was posted.
// Side effect: POST {content} to the Discord webhook URL behind the
// secrets-manager id given by DISCORD_WEBHOOK_SECRET.
//
// Lives alongside SKILL.md (Anthropic-Skills bundle convention) — the
// workforce agent-runner picks it up via the build-time generated
// skill-registry-generated.ts. Adding a new deterministic skill means
// dropping a folder under workforce/skills/{name}/ with SKILL.md +
// meta.json + handler.ts — no edits to lambdas/.

import type { DeterministicResult, RunnerContext } from "../../lambdas/shared/skill-types.js";
import { postToWebhook } from "../../lambdas/shared/webhook.js";

export async function dispatchDiscordPing(ctx: RunnerContext): Promise<DeterministicResult> {
  const secretName = process.env.DISCORD_WEBHOOK_SECRET;
  if (!secretName) {
    throw new Error("DISCORD_WEBHOOK_SECRET env var is required for discord-ping handler");
  }

  // Strip sub-second precision — heartbeats don't need millis and the
  // SKILL.md contract says "second precision".
  const isoSecond = ctx.startedAt.replace(/\.\d+Z$/, "Z");
  const line = `[wf-pulse] ${ctx.slug} alive at ${isoSecond}`;

  const { status } = await postToWebhook(secretName, line);

  return {
    output: line,
    outputExt: "txt",
    summary: line,
    side_effect: { kind: "discord-webhook", status },
  };
}
