// Azure OpenAI chat-completions wrapper. Direct fetch (no SDK) so the
// bundle stays thin, mirroring shared/llm-anthropic.ts.
//
// This is the SECOND LLM path in the workforce (ADR-0027 §4). The first,
// llm-anthropic.ts, serves agents and cadences and resolves one global
// key. This one serves the interactive project tools and takes its
// credential as an ARGUMENT: a tool run is scoped to a project, so the
// key, endpoint, deployment and api-version all come from that project's
// `azure.openai` secret via the credential injector. Nothing here reads
// Secrets Manager.
//
// Two contracts are shared with the Anthropic wrapper deliberately:
//
//   1. TRUNCATION THROWS (W-1 / W-4). Azure signals it as
//      `finish_reason === "length"`, the exact analogue of Anthropic's
//      `stop_reason === "max_tokens"`. A half-written tool result must
//      never render as if it were complete.
//   2. Token usage comes back on every response so the caller can put it
//      through shared/budget.ts. W-3 does not care which provider spent
//      the money.
//
// Structured output uses FUNCTION CALLING with a forced tool_choice
// (ADR-0027 §5), which is the mechanism the luckyhat mini-apps used and
// the one their prompts were written against. The difference is where
// the schema lives: in `workforce/tools/{id}/tool.json`, reviewable in a
// PR, rather than in a GPT record in another repository's database.

import type { AzureOpenAISecret } from "./secrets.js";

/**
 * USD per million tokens, keyed by DEPLOYMENT name. Azure deployments are
 * operator-named and carry no model id on the wire, so this cannot be
 * derived — an unlisted deployment degrades to cost_usd=0 rather than
 * throwing, matching the Anthropic wrapper. A zero here understates W-3
 * spend, so a new deployment should gain a row; it is not load-bearing
 * for correctness.
 */
const PRICING: Record<string, { in: number; out: number }> = {
  "gpt-5.4": { in: 1.25, out: 10.0 },
};

export interface AzureCompletionRequest {
  /** The project's `azure.openai` credential, injected by the caller. */
  credential: AzureOpenAISecret;
  system: string;
  user: string;
  /** Cap on completion tokens. Exhausting it throws (see file header). */
  maxTokens: number;
  /** Overrides the credential's default deployment (tool.json `model.deployment`). */
  deployment?: string;
  /**
   * Sampling temperature. **Omit it for `gpt-5.4`**, which rejects any
   * non-default value with HTTP 400 `unsupported_value` — see
   * `newsletter/docs/azure-budget-rules.md`, whose instruction on the
   * retired `azureGenerateText` was "do not re-add it". Kept on the
   * request type because this wrapper is a general client and a future
   * deployment may support it; the TOOL REGISTRY cannot set it
   * (validate-tools.mjs T13), so a tool cannot reintroduce the 400.
   *
   * Undefined means the key is absent from the request body entirely,
   * not sent as a default.
   */
  temperature?: number;
  /**
   * When present, the model is forced to answer by calling a single
   * function whose parameters are this JSON Schema, and `data` carries
   * the parsed arguments. Absent means free-text in `text`.
   */
  outputSchema?: { name: string; schema: Record<string, unknown> };
}

export interface AzureCompletionResponse {
  /** Free-text content. Empty string on a structured-output call. */
  text: string;
  /** Parsed function arguments. Present iff `outputSchema` was given. */
  data?: unknown;
  tokens_in: number;
  tokens_out: number;
  finish_reason: string;
  cost_usd: number;
  /** The deployment actually called — useful in the EXEC row. */
  deployment: string;
}

/**
 * Validate the endpoint before it is used to build a URL. The value comes
 * from an operator-provisioned secret rather than from a request, so this
 * is a misconfiguration guard rather than a security boundary: a typo'd
 * endpoint should fail here, legibly, instead of as an opaque fetch error
 * or — worse — a request to somewhere unintended.
 */
function assertUsableEndpoint(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(`azure.openai endpoint is not a valid URL: ${JSON.stringify(endpoint)}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`azure.openai endpoint must be https (got ${url.protocol.replace(":", "")})`);
  }
  return url;
}

/**
 * One chat completion against a project's Azure OpenAI deployment.
 *
 * Throws on: an unusable endpoint, a missing credential field, a non-2xx
 * response, a truncated completion, or a structured-output call the model
 * answered without calling the function. Every one of those is a state
 * the caller must not paper over (C-4 / W-4).
 */
export async function complete(
  req: AzureCompletionRequest,
): Promise<AzureCompletionResponse> {
  const { credential } = req;
  const deployment = req.deployment ?? credential.deployment;
  for (const [field, value] of [
    ["apiKey", credential.apiKey],
    ["endpoint", credential.endpoint],
    ["apiVersion", credential.apiVersion],
    ["deployment", deployment],
  ] as const) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`azure.openai credential is missing a usable "${field}"`);
    }
  }

  const base = assertUsableEndpoint(credential.endpoint);
  const url =
    `${base.origin}/openai/deployments/${encodeURIComponent(deployment)}` +
    `/chat/completions?api-version=${encodeURIComponent(credential.apiVersion)}`;

  const body: Record<string, unknown> = {
    max_completion_tokens: req.maxTokens,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
  };
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.outputSchema) {
    // Forced single-function call: the model cannot answer in prose, so
    // the caller always gets the declared shape or a loud failure.
    body.tools = [
      {
        type: "function",
        function: {
          name: req.outputSchema.name,
          description: "Return the result in this exact structure.",
          parameters: req.outputSchema.schema,
        },
      },
    ];
    body.tool_choice = {
      type: "function",
      function: { name: req.outputSchema.name },
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "api-key": credential.apiKey },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text();
    // The endpoint/deployment pair is named in the message because a
    // mismatched pair returns 404 — the failure ADR-0027 §4 bundles the
    // four fields to prevent, and the one an operator most needs told.
    throw new Error(
      `azure openai ${res.status} (deployment=${deployment} api-version=${credential.apiVersion}): ` +
        detail.slice(0, 500),
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{
      finish_reason?: string;
      message?: {
        content?: string | null;
        tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
      };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const choice = data.choices?.[0];
  if (!choice) throw new Error("azure openai returned no choices");
  const finish_reason = choice.finish_reason ?? "unknown";
  const tokens_in = data.usage?.prompt_tokens ?? 0;
  const tokens_out = data.usage?.completion_tokens ?? 0;

  if (finish_reason === "length") {
    // W-1 / W-4 — the same loud failure the Anthropic wrapper raises on
    // stop_reason=max_tokens. A truncated result never reaches a reader.
    throw new Error(
      `azure openai finish_reason=length (truncated). deployment=${deployment} ` +
        `max_completion_tokens=${req.maxTokens} out=${tokens_out}`,
    );
  }
  if (finish_reason === "content_filter") {
    throw new Error(
      `azure openai finish_reason=content_filter — the deployment's filter blocked the response ` +
        `(deployment=${deployment})`,
    );
  }

  const price = PRICING[deployment];
  const cost_usd = price ? (tokens_in * price.in + tokens_out * price.out) / 1_000_000 : 0;

  let parsed: unknown;
  let text = choice.message?.content ?? "";
  if (req.outputSchema) {
    const call = choice.message?.tool_calls?.[0];
    const rawArgs = call?.function?.arguments;
    if (typeof rawArgs !== "string" || rawArgs.trim().length === 0) {
      throw new Error(
        `azure openai did not call ${req.outputSchema.name} despite a forced tool_choice ` +
          `(finish_reason=${finish_reason}); no structured result to return`,
      );
    }
    try {
      parsed = JSON.parse(rawArgs);
    } catch {
      // Malformed JSON from a forced call is usually a silent truncation
      // that did not set finish_reason=length; surface it as itself.
      throw new Error(
        `azure openai returned unparseable arguments for ${req.outputSchema.name} ` +
          `(${rawArgs.length} chars, finish_reason=${finish_reason})`,
      );
    }
    text = "";
  }

  return { text, data: parsed, tokens_in, tokens_out, finish_reason, cost_usd, deployment };
}
