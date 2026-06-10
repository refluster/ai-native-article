// Anthropic Claude API wrapper. Direct fetch (no SDK) so the bundle stays
// thin. Enforces W-1 (editorial integrity) by throwing on
// stop_reason==="max_tokens" — the truncation case the L2 bug was caused
// by, surfaced as a loud failure here instead of silently shipping a
// half-written article.

import { getSecretRaw } from "./secrets.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export interface CompletionRequest {
  model: string;
  system: string;
  user: string;
  /**
   * Cap on visible-output tokens. With `reasoningBudgetTokens` unset (default
   * behaviour, preserved for existing callers), this is the single
   * `max_tokens` value passed to Anthropic — reasoning and visible output
   * share it. With `reasoningBudgetTokens` set, this becomes the visible-
   * output portion only; the reasoning budget is allocated separately
   * (see below). Total wire-level `max_tokens` is `maxTokens +
   * reasoningBudgetTokens` in that case.
   */
  maxTokens: number;
  temperature?: number;
  /**
   * Optional separate reasoning budget. When set, enables Anthropic's
   * extended-thinking mode (`thinking: { type: "enabled", budget_tokens }`).
   * This decouples hidden-reasoning consumption from the visible-output cap,
   * which is the same class of bug as the L2 truncation fix described in
   * the root CLAUDE.md: with a shared cap, a model that reasons heavily
   * can leave too few tokens for the visible body and the response gets
   * truncated mid-sentence (surfaces as `stop_reason="max_tokens"`).
   *
   * For short-form outputs (e.g. feed-post at ~200 tokens visible),
   * Sonnet/Opus callers SHOULD set this to ≥ `maxTokens` so reasoning
   * cannot starve the prose budget. Haiku does not use extended thinking
   * — leave unset for Haiku.
   *
   * Note: Anthropic requires `temperature=1` when `thinking` is enabled
   * (the API throws 400 otherwise). The wrapper forces temperature=1
   * when this is set, regardless of the caller-provided temperature.
   */
  reasoningBudgetTokens?: number;
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

/** Anthropic's documented floor for `thinking.budget_tokens`. A request
 *  below this is rejected by the API with a 400 — which, on an async
 *  invoke path, surfaces only as a CloudWatch error and looks like a
 *  silent no-reply from the operator's seat (the Epic-013 launch bug:
 *  messaging-reply shipped with budget 1000). Validate before the wire
 *  call so the mistake fails loudly with a readable message (C-4). */
export const ANTHROPIC_MIN_THINKING_BUDGET_TOKENS = 1024;

/** Where the Anthropic key may live, in resolution order. Epic-010 §6 moved
 *  credentials to typed per-project secrets (`wf/projects/_default/
 *  anthropic.api_key` is the shared bag) with the bare `wf/anthropic` kept
 *  only for a deprecation window — so the typed home is tried first and the
 *  legacy name is the fallback, mirroring project.ts getCredential(). */
const ANTHROPIC_KEY_SECRET_NAMES = [
  "wf/projects/_default/anthropic.api_key",
  "wf/anthropic",
] as const;

let cachedApiKey: string | null = null;

function isResourceNotFound(err: unknown): boolean {
  return err instanceof Error && err.name === "ResourceNotFoundException";
}

/** Accept both value shapes the credentials-api can store: a JSON object
 *  carrying `apiKey` (the vault's anthropic shape) or the bare key string.
 *  Returns undefined when the payload matches neither. Exported for tests
 *  (pure — the resolver's cold-start cache makes it awkward to exercise
 *  shape variants through resolveAnthropicApiKey itself). */
export function extractApiKey(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as { apiKey?: unknown };
      return typeof obj.apiKey === "string" && obj.apiKey.length > 0 ? obj.apiKey : undefined;
    } catch {
      return undefined;
    }
  }
  // A bare string; tolerate a JSON-quoted string too.
  if (trimmed.startsWith('"')) {
    try {
      const s = JSON.parse(trimmed) as unknown;
      return typeof s === "string" && s.length > 0 ? s : undefined;
    } catch {
      return undefined;
    }
  }
  return trimmed;
}

/** Resolve the Anthropic API key across the typed/legacy secret names,
 *  tolerating both storage shapes. A total miss throws with every name
 *  tried and the expected shapes — the W-4 readable-failure contract
 *  (the Epic-013 follow-up bug: replies kept failing when the key wasn't
 *  readable at the single hardcoded legacy name). Exported for tests. */
export async function resolveAnthropicApiKey(): Promise<string> {
  if (cachedApiKey) return cachedApiKey;
  const tried: string[] = [];
  for (const name of ANTHROPIC_KEY_SECRET_NAMES) {
    let raw: string;
    try {
      raw = await getSecretRaw(name);
    } catch (err) {
      if (isResourceNotFound(err)) {
        tried.push(`${name} (not found)`);
        continue;
      }
      throw err;
    }
    const key = extractApiKey(raw);
    if (key) {
      if (name === "wf/anthropic") {
        console.warn(JSON.stringify({ event: "anthropic_key_legacy_name_used", name }));
      }
      cachedApiKey = key;
      return key;
    }
    tried.push(`${name} (unrecognised value shape)`);
  }
  throw new Error(
    `anthropic api key unresolvable; tried: ${tried.join(", ")}. ` +
      `Store it via the credential vault as anthropic.api_key (value {"apiKey":"sk-ant-…"} ` +
      `or the bare key string) under wf/projects/_default/, or keep legacy wf/anthropic.`,
  );
}

export async function complete(req: CompletionRequest): Promise<CompletionResponse> {
  if (
    req.reasoningBudgetTokens !== undefined &&
    req.reasoningBudgetTokens > 0 &&
    req.reasoningBudgetTokens < ANTHROPIC_MIN_THINKING_BUDGET_TOKENS
  ) {
    throw new Error(
      `complete: reasoningBudgetTokens=${req.reasoningBudgetTokens} is below Anthropic's ` +
        `thinking.budget_tokens minimum (${ANTHROPIC_MIN_THINKING_BUDGET_TOKENS}); ` +
        `raise it or unset it to disable extended thinking`,
    );
  }
  const apiKey = await resolveAnthropicApiKey();
  const modelKey = req.model.replace(/^anthropic:/, "");

  // Extended-thinking ("reasoning") wiring. When the caller has set
  // `reasoningBudgetTokens`, we enable Anthropic's `thinking` mode and
  // pass `max_tokens = visible + reasoning` so the API knows the total
  // budget. The visible-output portion stays bounded by `req.maxTokens`
  // — when the model exhausts the visible budget, `stop_reason` becomes
  // `"max_tokens"` and the throw below catches it (W-4 / R-9).
  const thinkingEnabled = (req.reasoningBudgetTokens ?? 0) > 0;
  const wireMaxTokens = thinkingEnabled
    ? req.maxTokens + (req.reasoningBudgetTokens as number)
    : req.maxTokens;
  // Anthropic requires temperature=1 when thinking is enabled.
  const wireTemperature = thinkingEnabled ? 1 : (req.temperature ?? 0.7);

  const body: Record<string, unknown> = {
    model: modelKey,
    max_tokens: wireMaxTokens,
    temperature: wireTemperature,
    system: req.system,
    messages: [{ role: "user", content: req.user }],
  };
  if (thinkingEnabled) {
    body.thinking = {
      type: "enabled",
      budget_tokens: req.reasoningBudgetTokens,
    };
  }

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
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
    // When thinking is enabled, both budgets are surfaced separately so
    // the operator can tell whether reasoning or visible-output starved.
    const budgetMsg = thinkingEnabled
      ? `visible_max=${req.maxTokens} reasoning_max=${req.reasoningBudgetTokens} wire_max=${wireMaxTokens}`
      : `max_tokens=${req.maxTokens}`;
    throw new Error(
      `anthropic stop_reason=max_tokens (truncated). model=${modelKey} ${budgetMsg} out=${data.usage.output_tokens}`,
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
