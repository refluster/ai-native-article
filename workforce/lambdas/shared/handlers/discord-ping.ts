// Deterministic handler for the discord-ping skill.
// See workforce/skills/discord-ping/SKILL.md for the contract.
//
// Input: agent slug + run timestamp.
// Output bytes: the one-line heartbeat that was posted.
// Side effect: POST {content} to the Discord webhook URL behind the
// secrets-manager id given by DISCORD_WEBHOOK_SECRET.

import { postToWebhook } from "../webhook.js";

export interface RunnerContext {
  /** Agent slug — fills the {slug} placeholder in the heartbeat line. */
  slug: string;
  /** ISO-8601 timestamp captured when the runner started this RUN. */
  startedAt: string;
}

export interface DeterministicResult {
  /** Bytes the runner persists to S3 as runs/{slug}/{run_id}/output.{ext}. */
  output: string;
  /** File extension hint for the S3 key. */
  outputExt: "txt" | "json" | "md";
  /** Short summary the runner writes into RUN.output_summary. */
  summary: string;
  /** Optional external-publish side-effect status the runner can log. */
  side_effect?: { kind: "discord-webhook"; status: number };
}

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
