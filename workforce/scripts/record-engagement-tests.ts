// Unit tests for the #684 engagement-summary truncation + read-back guard
// (record-engagement.mjs). The CLI body (token mint, POST) requires AWS
// creds and network access and is wrapped in main(), which is guarded to
// run only when the file is invoked directly — importing here has no side
// effect (same convention as check-cycle-count-tests.ts).

// @ts-nocheck — the script under test is dependency-free ESM, not TS.
import { describe, it, expect, vi, afterEach } from "vitest";
import { truncateSummary, verifyEngagementReadBack } from "./record-engagement.mjs";

describe("truncateSummary (#684 — deliberate caller-side truncation)", () => {
  it("leaves a short summary untouched", () => {
    const r = truncateSummary("PR #123 review: fixed R1, deferred R2.");
    expect(r).toEqual({ text: "PR #123 review: fixed R1, deferred R2.", truncated: false });
  });

  it("leaves a summary exactly at the cap untouched", () => {
    const exact = "x".repeat(512);
    const r = truncateSummary(exact);
    expect(r.truncated).toBe(false);
    expect(r.text).toBe(exact);
  });

  it("cuts an over-long summary at a word boundary and marks it", () => {
    const words = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" "); // well over 512 chars
    const r = truncateSummary(words);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(512);
    expect(r.text.endsWith("…[truncated]")).toBe(true);
    // The cut must land on a word boundary — the char right before the
    // marker must not split a `wordNN` token in half.
    const body = r.text.slice(0, -"…[truncated]".length).trimEnd();
    expect(words.startsWith(body)).toBe(true);
    expect(words[body.length]).toBe(" ");
  });

  it("never silently mid-word slices the way the server's bare .slice(0,512) does", () => {
    // A single 1000-char token with no spaces at all: no word boundary
    // exists, so a hard cut is correct, but it must still carry the marker
    // (the loss must be visible even when a clean boundary isn't available).
    const noSpaces = "a".repeat(1000);
    const r = truncateSummary(noSpaces);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(512);
    expect(r.text.endsWith("…[truncated]")).toBe(true);
  });

  it("respects a custom maxLen", () => {
    const r = truncateSummary("one two three four five six seven eight", 20);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(20);
  });
});

describe("verifyEngagementReadBack (#684 — ML-020/R-18 pattern ported to engagements)", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("returns null when the stored summary matches what was sent", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ exec_ulid: "ENG1", summary: "hello world" }] }),
    });
    const result = await verifyEngagementReadBack("https://api.example", "ren", "ENG1", "hello world");
    expect(result).toBeNull();
  });

  it("flags a mismatch instead of trusting the 2xx", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ exec_ulid: "ENG1", summary: "hello wor" }] }), // server-side mid-word cut
    });
    const result = await verifyEngagementReadBack("https://api.example", "ren", "ENG1", "hello world");
    expect(result).toMatch(/MISMATCH/);
  });

  it("retries when the row hasn't shown up yet (GSI propagation), then succeeds", async () => {
    let calls = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      calls += 1;
      const items = calls < 3 ? [] : [{ exec_ulid: "ENG1", summary: "hello world" }];
      return { ok: true, json: async () => ({ items }) };
    });
    const result = await verifyEngagementReadBack("https://api.example", "ren", "ENG1", "hello world");
    expect(result).toBeNull();
    expect(calls).toBe(3);
  });

  it("fails loud (non-null) when the row never appears", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    const result = await verifyEngagementReadBack("https://api.example", "ren", "ENG1", "hello world");
    expect(result).toMatch(/not found/);
  });

  it("fails loud on a non-2xx read", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const result = await verifyEngagementReadBack("https://api.example", "ren", "ENG1", "hello world");
    expect(result).toMatch(/HTTP 500/);
  });
});
