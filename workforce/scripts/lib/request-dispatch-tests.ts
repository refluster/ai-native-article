// Unit tests for scripts/lib/request-dispatch.mjs (adr-0025 client side).
//
// The property under test is the one the lane depends on: this call is an
// accelerator, never a gate. No configuration, a 4xx, a 5xx, a timeout — every
// one of them returns a no-op result rather than throwing into a caller that
// has already written the hand-off comment and moved the labels.
import { afterEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error — .mjs helper without types; exercised as a JS module.
import { requestDispatch, DEFAULT_API_BASE } from "./request-dispatch.mjs";

const quiet = () => vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WF_DISPATCH_TOKEN;
  delete process.env.WF_AGENTS_API_BASE;
});

describe("requestDispatch", () => {
  it("POSTs (skill, project_id, reason) to /dispatch with the capability bearer", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 202, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    const out = await requestDispatch({
      skill: "pr-remediate",
      project_id: "asp-cloud",
      reason: "author-lane hand-off on PSVL/asp-cloud#693",
      token: "tok",
      log: quiet(),
    });
    expect(out.dispatched).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${DEFAULT_API_BASE}/dispatch`);
    expect(init.headers.authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({
      agent_slug: undefined,
      skill: "pr-remediate",
      project_id: "asp-cloud",
      reason: "author-lane hand-off on PSVL/asp-cloud#693",
    });
  });

  it("reads the token and base from the environment when not passed", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 202, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    process.env.WF_DISPATCH_TOKEN = "env-tok";
    process.env.WF_AGENTS_API_BASE = "https://example.test/prod/";
    await requestDispatch({ skill: "pr-autopilot", project_id: "asp-cloud", log: quiet() });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://example.test/prod/dispatch");
    expect(init.headers.authorization).toBe("Bearer env-tok");
  });

  it("no-ops without a token instead of failing the hand-off that called it", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const out = await requestDispatch({ skill: "pr-remediate", project_id: "asp-cloud", log: quiet() });
    expect(out.dispatched).toBe(false);
    expect(out.why).toContain("no WF_DISPATCH_TOKEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a 409 debounce as a normal no-op — a live run already owns the queue", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 409, text: async () => '{"error":"debounced"}' }));
    const out = await requestDispatch({ skill: "pr-remediate", project_id: "asp-cloud", token: "t", log: quiet() });
    expect(out).toMatchObject({ dispatched: false, status: 409 });
    expect(out.why).toContain("debounced");
  });

  it("surfaces a 404 (cadence not wired for this project) without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 404, text: async () => '{"error":"binding_not_found"}' }));
    const out = await requestDispatch({ skill: "pr-remediate", project_id: "asp-cloud", token: "t", log: quiet() });
    expect(out).toMatchObject({ dispatched: false, status: 404 });
    expect(out.why).toContain("binding_not_found");
  });

  it("swallows a network failure — latency degrades, the hand-off does not", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => { throw new Error("ECONNRESET"); }));
    const out = await requestDispatch({ skill: "pr-remediate", project_id: "asp-cloud", token: "t", log: quiet() });
    expect(out).toEqual({ dispatched: false, why: "network error: ECONNRESET" });
  });

  it("refuses an incomplete request rather than POSTing a partial one", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const out = await requestDispatch({ skill: "pr-remediate", token: "t", log: quiet() });
    expect(out.dispatched).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
