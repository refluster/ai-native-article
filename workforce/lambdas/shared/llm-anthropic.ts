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
  /** Ignored when thinking is on, and never sent to models where Anthropic
   *  removed sampling params (Opus 4.7+ / Fable tier — a sent temperature
   *  is a 400 there). */
  temperature?: number;
  /**
   * Reasoning on-switch + headroom. When set (>0), the wrapper enables
   * Anthropic's ADAPTIVE thinking (`thinking: {type: "adaptive"}` — the
   * legacy `{type:"enabled", budget_tokens}` shape is deprecated on
   * Sonnet/Opus 4.6 and REMOVED (400) on Opus 4.7+), and widens the wire
   * `max_tokens` to `maxTokens + reasoningBudgetTokens` so hidden
   * reasoning cannot starve the visible-output floor — the same class of
   * bug as the L2 truncation fix described in the root CLAUDE.md
   * (truncation surfaces as `stop_reason="max_tokens"` and throws).
   *
   * For short-form outputs (e.g. feed-post at ~200 tokens visible),
   * Sonnet/Opus callers SHOULD set this to ≥ `maxTokens`. Haiku has no
   * extended thinking — the wrapper omits the `thinking` field for Haiku
   * models regardless of this setting.
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

// USD per million tokens — keep in sync with Anthropic pricing
// (https://www.anthropic.com/pricing). Covers every model on the roster
// (agents/*/agent.json); a missing entry degrades to cost_usd=0, never a
// throw. Opus 4.7 corrected 2026-06-11: it is $5/$25, not the $15/$75 of
// the older Opus tier.
const PRICING: Record<string, { in: number; out: number }> = {
  "claude-sonnet-4-6": { in: 3.0, out: 15.0 },
  "claude-opus-4-7": { in: 5.0, out: 25.0 },
  "claude-opus-4-8": { in: 5.0, out: 25.0 },
  "claude-haiku-4-5-20251001": { in: 1.0, out: 5.0 },
  "claude-haiku-4-5": { in: 1.0, out: 5.0 },
};

/** Anthropic's documented floor for the legacy `thinking.budget_tokens`
 *  param (the Epic-013 launch bug: messaging-reply shipped with budget
 *  1000 and every call 400'd, invisible from the operator's seat). The
 *  wrapper now sends ADAPTIVE thinking — no budget_tokens on the wire —
 *  but the floor is kept as a sanity check on the caller contract: a
 *  sub-1024 reasoning headroom is a misconfiguration either way, and
 *  failing it loudly here beats discovering it in CloudWatch (C-4). */
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

  // Model-capability gates (the /messaging Maya incident, 2026-06-11):
  // Anthropic REMOVED the legacy `thinking:{type:"enabled",budget_tokens}`
  // shape AND the sampling params (temperature/top_p/top_k) on Opus 4.7+
  // and the Fable/Mythos tier — sending either returns a 400. The roster's
  // one opus-4-7 persona (maya) therefore failed on EVERY reply while the
  // sonnet-4-6 personas worked (the legacy shape is deprecated-but-
  // functional there). Adaptive thinking is the supported replacement on
  // every current non-Haiku model; Haiku has no extended thinking at all,
  // so it must not receive a `thinking` field.
  const adaptiveOnly = /^claude-(opus-4-[789]|fable|mythos)/.test(modelKey);
  const noThinking = /^claude-haiku/.test(modelKey);

  // Reasoning wiring. `reasoningBudgetTokens` is the on-switch plus the
  // max_tokens headroom reserved for thinking: with adaptive thinking the
  // model decides how much to think inside the shared `max_tokens` cap, so
  // we widen the cap by the requested budget to keep the visible-output
  // floor intact. Exhausting the cap still surfaces as
  // `stop_reason==="max_tokens"` and throws below (W-4 / R-9).
  const useThinking = (req.reasoningBudgetTokens ?? 0) > 0 && !noThinking;
  const wireMaxTokens = useThinking
    ? req.maxTokens + (req.reasoningBudgetTokens as number)
    : req.maxTokens;

  const body: Record<string, unknown> = {
    model: modelKey,
    max_tokens: wireMaxTokens,
    system: req.system,
    messages: [{ role: "user", content: req.user }],
  };
  if (useThinking) {
    body.thinking = { type: "adaptive" };
  }
  // Sampling: omitted whenever thinking is on (the API controls sampling
  // under thinking), and omitted entirely on adaptive-only models where
  // the parameter no longer exists (400 if sent).
  if (!useThinking && !adaptiveOnly) {
    body.temperature = req.temperature ?? 0.7;
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
    const budgetMsg = useThinking
      ? `visible_max=${req.maxTokens} reasoning_headroom=${req.reasoningBudgetTokens} wire_max=${wireMaxTokens}`
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
