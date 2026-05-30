import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock Secrets Manager + global fetch BEFORE importing the module under test.
const mockSend = vi.fn();
vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: class {
    send = mockSend;
  },
  GetSecretValueCommand: class {
    input: { SecretId: string };
    constructor(input: { SecretId: string }) {
      this.input = input;
    }
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { fireCcrRoutine } = await import("./ccr-fire.js");

const okSecret = (url = "https://example/fire", token = "tok_X") =>
  Promise.resolve({ SecretString: JSON.stringify({ url, token }) });

describe("fireCcrRoutine", () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockFetch.mockReset();
  });

  it("POSTs to the configured URL with bearer auth + json payload", async () => {
    mockSend.mockReturnValueOnce(okSecret("https://api.example/fire", "tok_ABC"));
    mockFetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const res = await fireCcrRoutine("feed-post", {
      agent_slug: "dario",
      binding_idx: 3,
      ticked_at: "2026-05-31T08:20:00Z",
    });

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://api.example/fire");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      authorization: "Bearer tok_ABC",
      "content-type": "application/json",
    });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      agent_slug: "dario",
      binding_idx: 3,
      ticked_at: "2026-05-31T08:20:00Z",
    });
  });

  it("reads from wf/ccr/{skill}", async () => {
    mockSend.mockReturnValueOnce(okSecret());
    mockFetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await fireCcrRoutine("feed-post", { agent_slug: "x", binding_idx: 0, ticked_at: "t" });

    const cmd = mockSend.mock.calls[0]![0] as { input: { SecretId: string } };
    expect(cmd.input.SecretId).toBe("wf/ccr/feed-post");
  });

  it("returns execution_id when the response includes one", async () => {
    mockSend.mockReturnValueOnce(okSecret());
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ execution_id: "exec_42" }), { status: 202 }),
    );

    const res = await fireCcrRoutine("feed-post", { agent_slug: "x", binding_idx: 0, ticked_at: "t" });

    expect(res.status).toBe(202);
    expect(res.execution_id).toBe("exec_42");
  });

  it("throws on non-2xx", async () => {
    mockSend.mockReturnValueOnce(okSecret());
    mockFetch.mockResolvedValueOnce(new Response("rate limited", { status: 429 }));

    await expect(
      fireCcrRoutine("feed-post", { agent_slug: "x", binding_idx: 0, ticked_at: "t" }),
    ).rejects.toThrow(/HTTP 429/);
  });

  it("throws when the secret is missing SecretString", async () => {
    mockSend.mockReturnValueOnce(Promise.resolve({}));

    await expect(
      fireCcrRoutine("feed-post", { agent_slug: "x", binding_idx: 0, ticked_at: "t" }),
    ).rejects.toThrow(/no SecretString/);
  });

  it("throws when the secret payload misses url/token", async () => {
    mockSend.mockReturnValueOnce(Promise.resolve({ SecretString: JSON.stringify({ url: "u" }) }));

    await expect(
      fireCcrRoutine("feed-post", { agent_slug: "x", binding_idx: 0, ticked_at: "t" }),
    ).rejects.toThrow(/missing url\/token/);
  });

  it("throws when the secret payload is not JSON", async () => {
    mockSend.mockReturnValueOnce(Promise.resolve({ SecretString: "not json" }));

    await expect(
      fireCcrRoutine("feed-post", { agent_slug: "x", binding_idx: 0, ticked_at: "t" }),
    ).rejects.toThrow(/not valid JSON/);
  });
});
