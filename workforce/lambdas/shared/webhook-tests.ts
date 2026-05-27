// Tests for webhook.ts — locks the wire shape posted to Discord so a
// future refactor can't silently break the embed format the heartbeat
// channel relies on. Run with `npm test` from workforce/lambdas/.
//
// Filename uses `-tests.ts` per R-N7 + vitest.config.mjs.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the secret loader before importing the SUT so the SUT picks up the mock.
vi.mock("./secrets.js", () => ({
  getSecret: vi.fn().mockResolvedValue({ webhookUrl: "https://example.test/webhook/abc" }),
}));

import { postToWebhook, type DiscordPayload } from "./webhook.js";

interface CapturedRequest {
  url: string;
  method: string;
  contentType: string | null;
  body: unknown;
}

let captured: CapturedRequest | null;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  captured = null;
  originalFetch = globalThis.fetch;
  // Minimal fetch shim — records the call and returns 204.
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    captured = {
      url: String(input),
      method: init?.method ?? "GET",
      contentType:
        init?.headers && typeof init.headers === "object"
          ? (init.headers as Record<string, string>)["content-type"] ?? null
          : null,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    };
    return new Response("ok", { status: 200, statusText: "OK" });
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("postToWebhook", () => {
  it("wraps a string payload into {content}", async () => {
    await postToWebhook("wf/discord-test", "hello");
    expect(captured?.url).toBe("https://example.test/webhook/abc");
    expect(captured?.method).toBe("POST");
    expect(captured?.contentType).toBe("application/json");
    expect(captured?.body).toEqual({ content: "hello" });
  });

  it("truncates string payloads above 1900 chars (W-4 belt-and-braces)", async () => {
    const long = "x".repeat(2500);
    await postToWebhook("wf/discord-test", long);
    const body = captured?.body as { content: string };
    expect(body.content.length).toBe(1900);
    expect(body.content.endsWith("...")).toBe(true);
  });

  it("passes through structured embed payloads without re-wrapping", async () => {
    // This is the discord-ping v0.4 shape — title + color + timestamp.
    // The test locks the wire format so a future webhook.ts refactor
    // can't silently break the at-a-glance health channel.
    const payload: DiscordPayload = {
      embeds: [
        {
          title: "wf-pulse · yuki",
          color: 0x3498db,
          timestamp: "2026-05-27T18:00:00Z",
        },
      ],
    };
    await postToWebhook("wf/discord-test", payload);
    expect(captured?.body).toEqual({
      embeds: [
        {
          title: "wf-pulse · yuki",
          color: 3447003, // 0x3498db
          timestamp: "2026-05-27T18:00:00Z",
        },
      ],
    });
  });

  it("does NOT truncate embed payloads (caller owns embed-size budget)", async () => {
    const longDescription = "y".repeat(5000);
    await postToWebhook("wf/discord-test", {
      embeds: [{ description: longDescription }],
    });
    const body = captured?.body as { embeds: Array<{ description: string }> };
    expect(body.embeds[0]?.description.length).toBe(5000);
  });

  it("throws with a debuggable message on non-2xx response", async () => {
    globalThis.fetch = (async () =>
      new Response("rate limited", { status: 429, statusText: "Too Many Requests" })) as typeof globalThis.fetch;
    await expect(postToWebhook("wf/discord-test", "ping")).rejects.toThrow(
      /webhook POST failed: 429 Too Many Requests/,
    );
  });
});
