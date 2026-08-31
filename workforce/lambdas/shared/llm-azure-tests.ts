// Unit tests for the Azure OpenAI wrapper.
//
// The load-bearing case is the truncation throw: `finish_reason=length`
// is Azure's analogue of Anthropic's `stop_reason=max_tokens`, and the
// whole reason both wrappers exist rather than a bare fetch is that a
// half-written result must never be returned as if it were whole
// (W-1 / W-4).

import { describe, expect, it, vi, afterEach } from "vitest";
import { complete } from "./llm-azure.js";
import type { AzureOpenAISecret } from "./secrets.js";

const credential: AzureOpenAISecret = {
  apiKey: "test-key",
  endpoint: "https://example-resource.openai.azure.com",
  deployment: "gpt-5.4",
  apiVersion: "2024-10-21",
};

function mockResponse(payload: unknown, ok = true, status = 200) {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  })) as unknown as typeof fetch;
}

function chatPayload(
  over: {
    finish_reason?: string;
    content?: string | null;
    tool_arguments?: string;
    usage?: { prompt_tokens: number; completion_tokens: number };
  } = {},
) {
  const message: Record<string, unknown> = { content: over.content ?? "hello" };
  if (over.tool_arguments !== undefined) {
    message.tool_calls = [{ function: { name: "emit_x", arguments: over.tool_arguments } }];
  }
  return {
    choices: [{ finish_reason: over.finish_reason ?? "stop", message }],
    usage: over.usage ?? { prompt_tokens: 100, completion_tokens: 50 },
  };
}

const base = { credential, system: "s", user: "u", maxTokens: 1000 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("complete — transport", () => {
  it("calls the deployment path built from the credential", async () => {
    const f = mockResponse(chatPayload());
    vi.stubGlobal("fetch", f);
    await complete(base);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(
      "https://example-resource.openai.azure.com/openai/deployments/gpt-5.4" +
        "/chat/completions?api-version=2024-10-21",
    );
    expect((init as RequestInit).headers).toMatchObject({ "api-key": "test-key" });
  });

  it("prefers the tool's deployment override over the credential's", async () => {
    const f = mockResponse(chatPayload());
    vi.stubGlobal("fetch", f);
    const res = await complete({ ...base, deployment: "gpt-5.4-mini" });
    const [url] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/deployments/gpt-5.4-mini/");
    expect(res.deployment).toBe("gpt-5.4-mini");
  });

  it("names the deployment and api-version in a non-2xx error", async () => {
    // A mismatched endpoint/deployment pair 404s; the operator needs to
    // be told which pair failed, not just that something 404'd.
    vi.stubGlobal("fetch", mockResponse({ error: "nope" }, false, 404));
    await expect(complete(base)).rejects.toThrow(/404 \(deployment=gpt-5\.4 api-version=2024-10-21\)/);
  });
});

describe("complete — credential validation", () => {
  it("rejects a non-https endpoint", async () => {
    await expect(
      complete({ ...base, credential: { ...credential, endpoint: "http://example.com" } }),
    ).rejects.toThrow(/must be https/);
  });

  it("rejects an unparseable endpoint", async () => {
    await expect(
      complete({ ...base, credential: { ...credential, endpoint: "not a url" } }),
    ).rejects.toThrow(/not a valid URL/);
  });

  it.each(["apiKey", "apiVersion", "deployment"] as const)(
    "rejects a blank %s before making a request",
    async (field) => {
      const f = mockResponse(chatPayload());
      vi.stubGlobal("fetch", f);
      await expect(
        complete({ ...base, credential: { ...credential, [field]: "  " } }),
      ).rejects.toThrow(new RegExp(`missing a usable "${field}"`));
      expect(f).not.toHaveBeenCalled();
    },
  );
});

describe("complete — failure modes that must be loud", () => {
  it("throws on finish_reason=length rather than returning a truncated result", async () => {
    vi.stubGlobal("fetch", mockResponse(chatPayload({ finish_reason: "length" })));
    await expect(complete(base)).rejects.toThrow(/finish_reason=length \(truncated\)/);
  });

  it("names the token budget in the truncation error", async () => {
    vi.stubGlobal("fetch", mockResponse(chatPayload({ finish_reason: "length" })));
    await expect(complete(base)).rejects.toThrow(/max_completion_tokens=1000 out=50/);
  });

  it("throws on a content filter", async () => {
    vi.stubGlobal("fetch", mockResponse(chatPayload({ finish_reason: "content_filter" })));
    await expect(complete(base)).rejects.toThrow(/content_filter/);
  });

  it("throws when the response carries no choices", async () => {
    vi.stubGlobal("fetch", mockResponse({ choices: [] }));
    await expect(complete(base)).rejects.toThrow(/no choices/);
  });
});

describe("complete — structured output", () => {
  const withSchema = {
    ...base,
    outputSchema: { name: "emit_x", schema: { type: "object", properties: {} } },
  };

  it("forces a single named function call", async () => {
    const f = mockResponse(chatPayload({ tool_arguments: '{"ok":true}' }));
    vi.stubGlobal("fetch", f);
    await complete(withSchema);
    const [, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.tool_choice).toEqual({ type: "function", function: { name: "emit_x" } });
    expect(body.tools[0].function.name).toBe("emit_x");
  });

  it("returns the parsed arguments as data and leaves text empty", async () => {
    vi.stubGlobal("fetch", mockResponse(chatPayload({ tool_arguments: '{"a":[1,2]}' })));
    const res = await complete(withSchema);
    expect(res.data).toEqual({ a: [1, 2] });
    expect(res.text).toBe("");
  });

  it("throws when the model answered in prose despite the forced call", async () => {
    // Returning the prose as if it were the structured result would hand
    // the renderer a shape it cannot draw.
    vi.stubGlobal("fetch", mockResponse(chatPayload({ content: "sure!" })));
    await expect(complete(withSchema)).rejects.toThrow(/did not call emit_x/);
  });

  it("throws on unparseable arguments", async () => {
    // Usually a truncation that did not set finish_reason=length.
    vi.stubGlobal("fetch", mockResponse(chatPayload({ tool_arguments: '{"a":' })));
    await expect(complete(withSchema)).rejects.toThrow(/unparseable arguments for emit_x/);
  });

  it("does not send tools when no schema is requested", async () => {
    const f = mockResponse(chatPayload());
    vi.stubGlobal("fetch", f);
    await complete(base);
    const [, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });
});

describe("complete — usage and cost", () => {
  it("reports token usage", async () => {
    vi.stubGlobal("fetch", mockResponse(chatPayload()));
    const res = await complete(base);
    expect(res).toMatchObject({ tokens_in: 100, tokens_out: 50, finish_reason: "stop" });
  });

  it("prices a listed deployment", async () => {
    vi.stubGlobal("fetch", mockResponse(chatPayload()));
    const res = await complete(base);
    // 100 in @ $1.25/M + 50 out @ $10/M
    expect(res.cost_usd).toBeCloseTo((100 * 1.25 + 50 * 10) / 1_000_000, 12);
  });

  it("degrades an unlisted deployment to zero cost rather than throwing", async () => {
    vi.stubGlobal("fetch", mockResponse(chatPayload()));
    const res = await complete({ ...base, deployment: "some-custom-name" });
    expect(res.cost_usd).toBe(0);
  });

  it("tolerates a response with no usage block", async () => {
    vi.stubGlobal("fetch", mockResponse({ choices: [{ finish_reason: "stop", message: { content: "x" } }] }));
    const res = await complete(base);
    expect(res).toMatchObject({ tokens_in: 0, tokens_out: 0 });
  });
});
