// Webhook side-effect for skills with meta.json:trigger_class=webhook.
//
// The runner calls postToWebhook() AFTER a successful LLM call. The skill
// body (an instruction set, Claude-Skill-compatible) tells the persona to
// produce a single short message; this module ships that message to the
// configured channel. Failure throws — the runner's W-4 path surfaces it.

import { getSecret } from "./secrets.js";

export interface WebhookSecret {
  /** Full webhook URL including any per-channel path/token. */
  webhookUrl: string;
}

/**
 * POST a plain-text body to a Discord-style incoming webhook.
 *
 * Discord (and Slack-compat shims) expect JSON `{content: "..."}`. We
 * truncate to 1900 chars to stay under Discord's 2000-char message cap;
 * the skill's instructions ask for a single line so truncation here is
 * the W-4 belt-and-braces guard, not the normal path.
 */
export async function postToWebhook(
  secretName: string,
  body: string,
): Promise<{ status: number }> {
  const { webhookUrl } = await getSecret<WebhookSecret>(secretName);
  if (!webhookUrl) {
    throw new Error(`webhook secret "${secretName}" missing webhookUrl`);
  }

  const content = body.length > 1900 ? `${body.slice(0, 1897)}...` : body;
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
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
