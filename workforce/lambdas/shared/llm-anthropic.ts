// Anthropic Claude API wrapper. Direct fetch (no SDK) so the bundle stays
// thin. Enforces W-1 (editorial integrity) by throwing on
// stop_reason==="max_tokens" — the truncation case the L2 bug was caused
// by, surfaced as a loud failure here instead of silently shipping a
// half-written article.

import { getSecret, type AnthropicSecret } from "./secrets.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export interface CompletionRequest {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
}

export interface CompletionResponse {
  text: string;
  tokens_in: number;
  tokens_out: number;
  stop_reason: string;
  cost_usd: number;
}

// USD per million tokens — keep in sync with Anthropic pricing.
// https://www.anthropic.com/pricing — Sonnet 4.6 / Opus 4.7 figures.
const PRICING: Record<string, { in: number; out: number }> = {
  "claude-sonnet-4-6": { in: 3.0, out: 15.0 },
  "claude-opus-4-7": { in: 15.0, out: 75.0 },
};

export async function complete(req: CompletionRequest): Promise<CompletionResponse> {
  const { apiKey } = await getSecret<AnthropicSecret>("wf/anthropic");
  const modelKey = req.model.replace(/^anthropic:/, "");

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: modelKey,
      max_tokens: req.maxTokens,
      temperature: req.temperature ?? 0.7,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`anthropic ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
    stop_reason: string;
    usage: { input_tokens: number; output_tokens: number };
  };

  if (data.stop_reason === "max_tokens") {
    // W-1 / W-4. Loud failure — no truncated article ever ships.
    throw new Error(
      `anthropic stop_reason=max_tokens (truncated). model=${modelKey} max_tokens=${req.maxTokens} out=${data.usage.output_tokens}`,
    );
  }

  const text = data.content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!)
    .join("");

  const price = PRICING[modelKey];
  const cost_usd = price
    ? (data.usage.input_tokens * price.in + data.usage.output_tokens * price.out) / 1_000_000
    : 0;

  return {
    text,
    tokens_in: data.usage.input_tokens,
    tokens_out: data.usage.output_tokens,
    stop_reason: data.stop_reason,
    cost_usd,
  };
}
