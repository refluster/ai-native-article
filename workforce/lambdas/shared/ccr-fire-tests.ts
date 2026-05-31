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

const { fireCcrRoutine, routineIdFromSpec } = await import("./ccr-fire.js");

const okSecret = (url = "https://example/fire", token = "tok_X") =>
  Promise.resolve({ SecretString: JSON.stringify({ url, token }) });

describe("routineIdFromSpec", () => {
  it("returns the basename without .md", () => {
    expect(routineIdFromSpec("workforce/docs/routines/agent-runner.md")).toBe("agent-runner");
  });
  it("handles a bare filename with no slash", () => {
    expect(routineIdFromSpec("agent-runner.md")).toBe("agent-runner");
  });
  it("handles a path without an extension", () => {
    expect(routineIdFromSpec("a/b/runner")).toBe("runner");
  });
  it("throws on empty input", () => {
    expect(() => routineIdFromSpec("")).toThrow(/required/);
  });
});

const singleTaskPayload = () => ({
  tasks: [
    {
      agent_slug: "dario",
      binding_idx: 3,
      project_id: "agent-workforce",
      ticked_at: "2026-05-31T08:20:00Z",
      credentials: {},
    },
  ],
});

const minimalPayload = () => ({
  tasks: [
    {
      agent_slug: "x",
      binding_idx: 0,
      project_id: "p",
      ticked_at: "t",
      credentials: {},
    },
  ],
});

describe("fireCcrRoutine", () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockFetch.mockReset();
  });

  it("POSTs with bearer auth + beta/version headers + wraps tasks in `text`", async () => {
    mockSend.mockReturnValueOnce(okSecret("https://api.example/fire", "tok_ABC"));
    mockFetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const res = await fireCcrRoutine("agent-runner", singleTaskPayload());

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://api.example/fire");
    expect((init as RequestInit).method).toBe("POST");
    // /fire requires the beta + version headers; bearer auth + content-type.
    expect((init as RequestInit).headers).toMatchObject({
      authorization: "Bearer tok_ABC",
      "content-type": "application/json",
      "anthropic-beta": "experimental-cc-routine-2026-04-01",
      "anthropic-version": "2023-06-01",
    });
    // Wire shape: top-level body is { text: "<json string>" } — /fire
    // rejects any other top-level key with HTTP 400. The structured
    // envelope round-trips through the string.
    const wire = JSON.parse((init as RequestInit).body as string);
    expect(Object.keys(wire)).toEqual(["text"]);
    const envelope = JSON.parse(wire.text);
    expect(envelope.tasks).toHaveLength(1);
    expect(envelope.tasks[0]).toEqual({
      agent_slug: "dario",
      binding_idx: 3,
      project_id: "agent-workforce",
      ticked_at: "2026-05-31T08:20:00Z",
      credentials: {},
    });
  });

  it("batches multiple tasks into a single POST", async () => {
    mockSend.mockReturnValueOnce(okSecret());
    mockFetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await fireCcrRoutine("agent-runner", {
      tasks: [
        {
          agent_slug: "dario",
          binding_idx: 3,
          project_id: "agent-workforce",
          ticked_at: "t1",
          credentials: {},
        },
        {
          agent_slug: "yuki",
          binding_idx: 2,
          project_id: "agent-workforce",
          ticked_at: "t2",
          credentials: { "discord.webhook_url": { url: "https://discord.com/api/webhooks/X/Y" } },
        },
      ],
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const wire = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(Object.keys(wire)).toEqual(["text"]);
    const envelope = JSON.parse(wire.text);
    expect(envelope.tasks).toHaveLength(2);
    expect(envelope.tasks[0].agent_slug).toBe("dario");
    expect(envelope.tasks[1].agent_slug).toBe("yuki");
    expect(envelope.tasks[1].credentials).toEqual({
      "discord.webhook_url": { url: "https://discord.com/api/webhooks/X/Y" },
    });
  });

  it("returns session_id + session_url when the response includes them", async () => {
    mockSend.mockReturnValueOnce(okSecret());
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          type: "routine_fire",
          claude_code_session_id: "session_01HJK",
          claude_code_session_url: "https://claude.ai/code/session_01HJK",
        }),
        { status: 200 },
      ),
    );

    const res = await fireCcrRoutine("agent-runner", minimalPayload());

    expect(res.status).toBe(200);
    expect(res.session_id).toBe("session_01HJK");
    expect(res.session_url).toBe("https://claude.ai/code/session_01HJK");
  });

  it("reads from wf/ccr/{routine_id}", async () => {
    mockSend.mockReturnValueOnce(okSecret());
    mockFetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await fireCcrRoutine("agent-runner", minimalPayload());

    const cmd = mockSend.mock.calls[0]![0] as { input: { SecretId: string } };
    expect(cmd.input.SecretId).toBe("wf/ccr/agent-runner");
  });

  it("throws on non-2xx", async () => {
    mockSend.mockReturnValueOnce(okSecret());
    mockFetch.mockResolvedValueOnce(new Response("rate limited", { status: 429 }));

    await expect(fireCcrRoutine("agent-runner", minimalPayload())).rejects.toThrow(/HTTP 429/);
  });

  it("throws when the secret is missing SecretString", async () => {
    mockSend.mockReturnValueOnce(Promise.resolve({}));

    await expect(fireCcrRoutine("agent-runner", minimalPayload())).rejects.toThrow(/no SecretString/);
  });

  it("throws when the secret payload misses url/token", async () => {
    mockSend.mockReturnValueOnce(Promise.resolve({ SecretString: JSON.stringify({ url: "u" }) }));

    await expect(fireCcrRoutine("agent-runner", minimalPayload())).rejects.toThrow(/missing url\/token/);
  });

  it("throws when the secret payload is not JSON", async () => {
    mockSend.mockReturnValueOnce(Promise.resolve({ SecretString: "not json" }));

    await expect(fireCcrRoutine("agent-runner", minimalPayload())).rejects.toThrow(/not valid JSON/);
  });
});
