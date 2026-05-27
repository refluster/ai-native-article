// Webhook side-effect for skills posting to Discord-style incoming webhooks.
//
// The runner calls postToWebhook() from a skill handler (deterministic
// or after a successful LLM call). Failure throws — the runner's W-4
// path surfaces it.

import { getSecret } from "./secrets.js";

export interface WebhookSecret {
  /** Full webhook URL including any per-channel path/token. */
  webhookUrl: string;
}

/**
 * Discord embed shape — the subset of fields the workforce uses today.
 * Full Discord embed spec has more (footer, fields, image, etc.) — add
 * properties here as a downstream skill needs them.
 */
export interface DiscordEmbed {
  title?: string;
  description?: string;
  /**
   * Sidebar color as a decimal integer (e.g. `0x3498db` = `3447003`,
   * Discord's conventional "info" blue). Discord ignores the alpha channel.
   */
  color?: number;
  /** ISO-8601 timestamp Discord auto-renders at the embed footer. */
  timestamp?: string;
  url?: string;
}

/**
 * Discord webhook payload. Either a plain text body (back-compat shorthand
 * that wraps into `{content}`) or a structured payload supporting embeds.
 * Discord requires at least one of `content` or `embeds`.
 */
export type DiscordPayload =
  | string
  | {
      content?: string;
      embeds?: DiscordEmbed[];
    };

/**
 * POST to a Discord-style incoming webhook. Accepts either a plain string
 * (wrapped into `{content}` per the back-compat shape skills used at v1)
 * or a structured `{content?, embeds?}` payload for color-bar / sidebar
 * formatting (used by deterministic heartbeat skills for at-a-glance health).
 *
 * Discord caps `content` at 2000 chars; we truncate strings to 1900 as a
 * W-4 belt-and-braces against runaway prose. Embeds are NOT truncated —
 * the caller is responsible for keeping embed payloads under Discord's
 * 6000-char aggregate limit (the workforce's heartbeat skills are tiny;
 * if a future skill blows past this, add a guard at the call site, not
 * here, because the cap is per-embed-field, not whole-payload-trivial).
 */
export async function postToWebhook(
  secretName: string,
  payload: DiscordPayload,
): Promise<{ status: number }> {
  const { webhookUrl } = await getSecret<WebhookSecret>(secretName);
  if (!webhookUrl) {
    throw new Error(`webhook secret "${secretName}" missing webhookUrl`);
  }

  const body =
    typeof payload === "string"
      ? JSON.stringify({
          content: payload.length > 1900 ? `${payload.slice(0, 1897)}...` : payload,
        })
      : JSON.stringify(payload);

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    redirect: "follow",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `webhook POST failed: ${res.status} ${res.statusText} — ${text.slice(0, 200)}`,
    );
  }
  return { status: res.status };
}
