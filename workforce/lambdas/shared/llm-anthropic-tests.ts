// Unit tests for shared/llm-anthropic.ts — the two failure modes that made
// /messaging look silently dead from the operator's seat (Epic-013 launch):
//   1. an extended-thinking budget below Anthropic's 1024 floor (every call
//      400'd at the API), and
//   2. the API key hardcoded to the legacy `wf/anthropic` secret name while
//      Epic-010 §6 moved credentials to wf/projects/_default/anthropic.api_key.
// Both now fail loudly with readable messages / resolve across names+shapes.

import { beforeEach, describe, expect, it, vi } from "vitest";

const getSecretRaw = vi.fn();
vi.mock("./secrets.js", () => ({
  getSecretRaw: (...args: unknown[]) => getSecretRaw(...args),
}));

import {
  complete,
  resolveAnthropicApiKey,
  extractApiKey,
  ANTHROPIC_MIN_THINKING_BUDGET_TOKENS,
} from "./llm-anthropic.js";

function notFound(): Error {
  const err = new Error("Secrets Manager can't find the specified secret.");
  err.name = "ResourceNotFoundException";
  return err;
}

beforeEach(() => {
  getSecretRaw.mockReset();
  // resolveAnthropicApiKey caches module-wide; force misses to differ per
  // test via distinct return values — the cache only stores successes, and
  // each test that expects success seeds the same key to stay stable.
});

describe("complete — thinking-budget floor", () => {
  it("throws loudly (before secret/network I/O) when 0 < budget < 1024", async () => {
    await expect(
      complete({
        model: "anthropic:claude-sonnet-4-6",
        system: "s",
        user: "u",
        maxTokens: 400,
        reasoningBudgetTokens: 1000,
      }),
    ).rejects.toThrow(/reasoningBudgetTokens=1000 is below Anthropic's/);
    expect(getSecretRaw).not.toHaveBeenCalled();
  });

  it("documents the floor as 1024", () => {
    expect(ANTHROPIC_MIN_THINKING_BUDGET_TOKENS).toBe(1024);
  });
});

describe("extractApiKey — value-shape tolerance (pure)", () => {
  it("accepts the vault JSON shape {apiKey}", () => {
    expect(extractApiKey('{"apiKey":"sk-ant-x"}')).toBe("sk-ant-x");
  });
  it("accepts a bare key string", () => {
    expect(extractApiKey("sk-ant-bare\n")).toBe("sk-ant-bare");
  });
  it("accepts a JSON-quoted string", () => {
    expect(extractApiKey('"sk-ant-quoted"')).toBe("sk-ant-quoted");
  });
  it("rejects empty payloads and wrong-field JSON", () => {
    expect(extractApiKey("   ")).toBeUndefined();
    expect(extractApiKey('{"token":"nope"}')).toBeUndefined();
    expect(extractApiKey('{"apiKey":""}')).toBeUndefined();
  });
});

describe("resolveAnthropicApiKey", () => {
  // NOTE: the resolver caches the first success for the module lifetime
  // (cold-start cache, mirrors getSecret). All success-path tests therefore
  // use the same key value, and the order of tests matters only up to the
  // first success — the miss/shape tests run against the mock BEFORE any
  // success is cached, expressed here by asserting the thrown message first.

  it("throws a readable, every-name-tried error when no secret exists", async () => {
    getSecretRaw.mockRejectedValue(notFound());
    await expect(resolveAnthropicApiKey()).rejects.toThrow(
      /tried: wf\/projects\/_default\/anthropic\.api_key \(not found\), wf\/anthropic \(not found\)/,
    );
  });

  it("rejects unrecognised value shapes rather than sending garbage to the API", async () => {
    getSecretRaw.mockReset();
    getSecretRaw.mockResolvedValueOnce('{"token":"wrong-field"}'); // typed: wrong shape
    getSecretRaw.mockRejectedValueOnce(notFound()); // legacy missing
    await expect(resolveAnthropicApiKey()).rejects.toThrow(/unrecognised value shape/);
  });

  it("prefers the typed Epic-010 name and accepts the {apiKey} JSON shape", async () => {
    getSecretRaw.mockReset();
    getSecretRaw.mockResolvedValueOnce('{"apiKey":"sk-ant-test-1"}');
    await expect(resolveAnthropicApiKey()).resolves.toBe("sk-ant-test-1");
    expect(getSecretRaw).toHaveBeenCalledWith("wf/projects/_default/anthropic.api_key");
    expect(getSecretRaw).toHaveBeenCalledTimes(1); // legacy never consulted
  });

  it("caches the resolved key (no second SecretsManager hit)", async () => {
    getSecretRaw.mockReset();
    await expect(resolveAnthropicApiKey()).resolves.toBe("sk-ant-test-1");
    expect(getSecretRaw).not.toHaveBeenCalled();
  });
});

describe("complete — per-model wire shape (the Maya incident)", () => {
  // Anthropic removed the legacy thinking shape AND sampling params on
  // Opus 4.7+ (400 if sent); Haiku has no thinking at all. These tests pin
  // the request body per model class. The resolver's key is already cached
  // by the tests above, so only fetch needs mocking.
  let lastBody: Record<string, unknown>;
  const okFetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
    lastBody = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
      { status: 200 },
    );
  });

  const base = { system: "s", user: "u", maxTokens: 400 };

  it("opus-4-7 + reasoning → adaptive thinking, NO budget_tokens, NO temperature", async () => {
    vi.stubGlobal("fetch", okFetch);
    const out = await complete({ ...base, model: "anthropic:claude-opus-4-7", reasoningBudgetTokens: 2048 });
    expect(lastBody.thinking).toEqual({ type: "adaptive" });
    expect(lastBody).not.toHaveProperty("temperature");
    expect(JSON.stringify(lastBody)).not.toContain("budget_tokens");
    expect(lastBody.max_tokens).toBe(400 + 2048);
    expect(out.cost_usd).toBeGreaterThan(0); // opus-4-7 pricing present (5/25)
    vi.unstubAllGlobals();
  });

  it("opus-4-7 WITHOUT reasoning → no thinking field and still no temperature", async () => {
    vi.stubGlobal("fetch", okFetch);
    await complete({ ...base, model: "anthropic:claude-opus-4-7" });
    expect(lastBody).not.toHaveProperty("thinking");
    expect(lastBody).not.toHaveProperty("temperature");
    vi.unstubAllGlobals();
  });

  it("sonnet-4-6 + reasoning → adaptive thinking (legacy enabled+budget shape gone)", async () => {
    vi.stubGlobal("fetch", okFetch);
    await complete({ ...base, model: "anthropic:claude-sonnet-4-6", reasoningBudgetTokens: 2048 });
    expect(lastBody.thinking).toEqual({ type: "adaptive" });
    expect(lastBody).not.toHaveProperty("temperature");
    vi.unstubAllGlobals();
  });

  it("haiku + reasoning request → thinking omitted entirely, sampling kept", async () => {
    vi.stubGlobal("fetch", okFetch);
    await complete({
      ...base,
      model: "anthropic:claude-haiku-4-5-20251001",
      reasoningBudgetTokens: 2048,
    });
    expect(lastBody).not.toHaveProperty("thinking");
    expect(lastBody.temperature).toBe(0.7);
    expect(lastBody.max_tokens).toBe(400); // no headroom without thinking
    vi.unstubAllGlobals();
  });
});
