// Unit tests for the #666 skill-lifecycle reconciliation
// (check-skill-lifecycle.mjs). main() shells out to the live workforce API
// and is guarded to run only when the file is invoked directly (same
// convention as check-cycle-count-tests.ts / record-engagement-tests.ts) —
// importing here has no side effect. These tests exercise the pure pieces
// (boundSkillNames, classifySkill) plus the two fetch-backed helpers with
// global.fetch mocked.

// @ts-nocheck — the script under test is dependency-free ESM, not TS.
import { describe, it, expect, vi, afterEach } from "vitest";
import { boundSkillNames, classifySkill, fetchAllAgents, hasRecentExecutions } from "./check-skill-lifecycle.mjs";

describe("boundSkillNames (#666 — live-binding signal)", () => {
  it("collects every binding.skill across all agents", () => {
    const agents = [
      { slug: "ren", bindings: [{ skill: "issue-implement" }, { skill: "pr-remediate" }] },
      { slug: "nadia", bindings: [{ skill: "pr-autopilot" }] },
    ];
    expect(boundSkillNames(agents)).toEqual(new Set(["issue-implement", "pr-remediate", "pr-autopilot"]));
  });

  it("is robust to agents with no bindings, or malformed binding entries", () => {
    const agents = [
      { slug: "idle" },
      { slug: "weird", bindings: [null, {}, { skill: 123 }, { skill: "feed-post" }] },
    ];
    expect(boundSkillNames(agents)).toEqual(new Set(["feed-post"]));
  });

  it("returns an empty set for no agents", () => {
    expect(boundSkillNames([])).toEqual(new Set());
  });
});

describe("classifySkill (#666 — AND-of-two-signals + grace period)", () => {
  const sinceIso = "2026-08-10T00:00:00.000Z"; // STALE_DAYS ago, in the tests

  it("skips a non-active skill entirely", () => {
    const entry = { name: "retired-thing", meta: { status: "archived", created_at: "2026-01-01" } };
    expect(classifySkill(entry, { bound: new Set(), recentlyRan: false, sinceIso })).toBe("not-active");
  });

  it("exempts a skill created within the grace window", () => {
    const entry = { name: "brand-new", meta: { status: "active", created_at: "2026-09-01" } };
    expect(classifySkill(entry, { bound: new Set(), recentlyRan: false, sinceIso })).toBe("too-new");
  });

  it("does not exempt a skill created exactly on the grace boundary", () => {
    const entry = { name: "boundary", meta: { status: "active", created_at: "2026-08-10" } };
    expect(classifySkill(entry, { bound: new Set(), recentlyRan: false, sinceIso })).toBe("suspect");
  });

  it("flags SUSPECT only when both signals are negative (AND, not OR)", () => {
    const old = { name: "s", meta: { status: "active", created_at: "2026-01-01" } };
    // bound but no recent EXEC rows -> ok (a binding exists; give it time)
    expect(classifySkill(old, { bound: new Set(["s"]), recentlyRan: false, sinceIso })).toBe("ok");
    // unbound but recently ran (e.g. an internal-helper skill someone just used) -> ok
    expect(classifySkill(old, { bound: new Set(), recentlyRan: true, sinceIso })).toBe("ok");
    // both signals present -> ok
    expect(classifySkill(old, { bound: new Set(["s"]), recentlyRan: true, sinceIso })).toBe("ok");
    // neither signal -> suspect
    expect(classifySkill(old, { bound: new Set(), recentlyRan: false, sinceIso })).toBe("suspect");
  });

  it("treats a missing created_at as old enough to evaluate (never exempt by omission)", () => {
    const entry = { name: "no-date", meta: { status: "active" } };
    expect(classifySkill(entry, { bound: new Set(), recentlyRan: false, sinceIso })).toBe("suspect");
  });
});

describe("fetchAllAgents / hasRecentExecutions (#666 — fetch-backed helpers)", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("returns items[] from GET /agents", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ slug: "ren", bindings: [] }], next_cursor: undefined }),
    });
    const agents = await fetchAllAgents("https://api.example");
    expect(agents).toEqual([{ slug: "ren", bindings: [] }]);
  });

  it("fails loud if GET /agents ever stops fully draining server-side", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], next_cursor: "abc" }),
    });
    await expect(fetchAllAgents("https://api.example")).rejects.toThrow(/next_cursor/);
  });

  it("fails loud on a non-2xx", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(fetchAllAgents("https://api.example")).rejects.toThrow(/HTTP 500/);
  });

  it("hasRecentExecutions is true when the executions route returns any item", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [{ exec_ulid: "X" }] }) });
    expect(await hasRecentExecutions("feed-post", "2026-08-10T00:00:00.000Z", "https://api.example")).toBe(true);
  });

  it("hasRecentExecutions is false on an empty items[]", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    expect(await hasRecentExecutions("dormant-skill", "2026-08-10T00:00:00.000Z", "https://api.example")).toBe(false);
  });
});
