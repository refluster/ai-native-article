// Unit tests for the FU-005 scope-creep guard (check-scope-creep.mjs).
// The network loop requires a token; the four pure functions are tested here.

// @ts-nocheck — the script under test is dependency-free ESM, not TS.
import { describe, it, expect } from "vitest";
import {
  parseFindingOccurrences,
  extractFindingIds,
  checkScopeCreep,
  groupByCycle,
  parseNextLink,
  drainPages,
} from "./check-scope-creep.mjs";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Routing comment matching the SKILL.md §Step 2 template. */
const routingBody = (cycle: number, persona = "Nadia", cap = 7) =>
  `**${persona} — cycle ${cycle} of ≤ ${cap}.**\n\nSummary.\n\nReviewers nominated:\n- \`wf:dario\``;

/** Reviewer comment with one finding block. */
const reviewerBody = (id: string, hasNew = false, extra = "") =>
  `🟡 This lens found one issue.\n\n${hasNew ? "[NEW] " : ""}\`${id}\` correctness — src/foo.ts:10\nProblem: the guard is missing.\nFix: add the guard.\n\n${extra}— Dario (LLM persona; lens: engineering)`;

// ── parseFindingOccurrences ───────────────────────────────────────────────────

describe("parseFindingOccurrences", () => {
  it("returns empty for a body with no finding-IDs", () => {
    expect(parseFindingOccurrences("LGTM, ship it")).toEqual([]);
  });

  it("parses a single finding-ID", () => {
    const result = parseFindingOccurrences("`A1` correctness — foo.ts:5\nProblem: bad.\nFix: fix.");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: "A1", hasNew: false });
  });

  it("parses multiple finding-IDs across lines", () => {
    const body = "`A1` correctness — foo.ts:5\n`B2` test-coverage — bar.ts:10";
    const result = parseFindingOccurrences(body);
    expect(result.map((r) => r.id)).toEqual(["A1", "B2"]);
    expect(result.every((r) => !r.hasNew)).toBe(true);
  });

  it("sets hasNew when [NEW] appears on the same line as the finding-ID", () => {
    const body = "[NEW] `D3` security — auth.ts:22\nProblem: missing check.\nFix: add it.";
    const result = parseFindingOccurrences(body);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: "D3", hasNew: true });
  });

  it("does NOT set hasNew when [NEW] is on a different line from the finding-ID", () => {
    const body = "[NEW]\n`A1` correctness — foo.ts:5\nProblem: bad.\nFix: fix.";
    const result = parseFindingOccurrences(body);
    expect(result).toHaveLength(1);
    expect(result[0].hasNew).toBe(false);
  });

  it("is case-sensitive for [NEW]: lowercase [new] does not count", () => {
    const body = "[new] `A1` correctness — foo.ts:5";
    const result = parseFindingOccurrences(body);
    expect(result[0].hasNew).toBe(false);
  });

  it("handles multi-digit finding numbers", () => {
    const result = parseFindingOccurrences("`A12` test-coverage — baz.ts:99");
    expect(result[0].id).toBe("A12");
  });

  it("handles multiple finding-IDs on one line", () => {
    const body = "See `A1` and `B2` for context.";
    const result = parseFindingOccurrences(body);
    expect(result.map((r) => r.id)).toEqual(["A1", "B2"]);
  });

  it("ignores lowercase-letter finding-like tokens (not a finding-ID)", () => {
    const body = "`a1` is just inline code, not a finding-ID";
    expect(parseFindingOccurrences(body)).toEqual([]);
  });

  it("is robust to null / undefined body", () => {
    expect(parseFindingOccurrences(null as unknown as string)).toEqual([]);
    expect(parseFindingOccurrences(undefined as unknown as string)).toEqual([]);
  });
});

// ── parseNextLink (S1: pagination draining) ─────────────────────────────────

describe("parseNextLink", () => {
  it("returns null when the header is missing", () => {
    expect(parseNextLink(null)).toBeNull();
    expect(parseNextLink(undefined)).toBeNull();
    expect(parseNextLink("")).toBeNull();
  });

  it("extracts the next URL from a multi-rel Link header", () => {
    const header =
      '<https://api.github.com/repos/o/r/issues/1/comments?page=2>; rel="next", ' +
      '<https://api.github.com/repos/o/r/issues/1/comments?page=5>; rel="last"';
    expect(parseNextLink(header)).toBe(
      "https://api.github.com/repos/o/r/issues/1/comments?page=2",
    );
  });

  it("returns null on the last page (no rel=\"next\" entry)", () => {
    const header =
      '<https://api.github.com/repos/o/r/issues/1/comments?page=1>; rel="prev", ' +
      '<https://api.github.com/repos/o/r/issues/1/comments?page=1>; rel="first"';
    expect(parseNextLink(header)).toBeNull();
  });

  it("handles a single-rel header with no surrounding entries", () => {
    const header = '<https://api.github.com/repos/o/r/pulls/1/reviews?page=3>; rel="next"';
    expect(parseNextLink(header)).toBe(
      "https://api.github.com/repos/o/r/pulls/1/reviews?page=3",
    );
  });
});

// ── extractFindingIds ────────────────────────────────────────────────────────

describe("extractFindingIds", () => {
  it("returns empty set for bodies with no finding-IDs", () => {
    expect(extractFindingIds(["LGTM", "No findings."])).toEqual(new Set());
  });

  it("collects unique IDs across multiple bodies", () => {
    const bodies = [
      "`A1` correctness — foo.ts:5\nProblem: x.\nFix: y.",
      "`B2` test-coverage — bar.ts:10\nProblem: x.\nFix: y.",
      "`A1` appears again (should dedupe)",
    ];
    expect(extractFindingIds(bodies)).toEqual(new Set(["A1", "B2"]));
  });

  it("includes [NEW]-tagged IDs since they are still IDs", () => {
    expect(extractFindingIds(["[NEW] `C3` correctness — x.ts:1"])).toEqual(new Set(["C3"]));
  });
});

// ── checkScopeCreep ──────────────────────────────────────────────────────────

describe("checkScopeCreep", () => {
  it("returns no violations when all cycle-2 IDs appeared in cycle-1", () => {
    const cycle1Ids = new Set(["A1", "B2"]);
    const laterBodies = [reviewerBody("A1"), reviewerBody("B2")];
    expect(checkScopeCreep(cycle1Ids, laterBodies).violations).toEqual([]);
  });

  it("flags a new finding-ID in cycle-2 that was not in cycle-1", () => {
    const cycle1Ids = new Set(["A1"]);
    const laterBodies = [reviewerBody("B2")]; // B2 not in cycle-1, no [NEW]
    const { violations } = checkScopeCreep(cycle1Ids, laterBodies);
    expect(violations).toHaveLength(1);
    expect(violations[0].id).toBe("B2");
  });

  it("does NOT flag a [NEW]-tagged finding-ID not in cycle-1", () => {
    const cycle1Ids = new Set(["A1"]);
    const laterBodies = [reviewerBody("D3", true)]; // D3 with [NEW]
    expect(checkScopeCreep(cycle1Ids, laterBodies).violations).toEqual([]);
  });

  it("flags multiple violations across different later bodies", () => {
    const cycle1Ids = new Set(["A1"]);
    const laterBodies = [
      reviewerBody("B2"), // new, no [NEW]
      reviewerBody("C3"), // new, no [NEW]
    ];
    const { violations } = checkScopeCreep(cycle1Ids, laterBodies);
    expect(violations.map((v) => v.id).sort()).toEqual(["B2", "C3"]);
  });

  it("returns no violations for an empty later list", () => {
    expect(checkScopeCreep(new Set(["A1"]), []).violations).toEqual([]);
  });

  it("returns no violations when cycle-1 IDs is empty and later bodies have none", () => {
    expect(checkScopeCreep(new Set(), ["LGTM"]).violations).toEqual([]);
  });

  it("flags a finding-ID in a later body even if it is also in cycle-1 set (same ID reused without [NEW] is fine)", () => {
    // A1 is in cycle-1 set; cycle-2 reviewer references it → no violation.
    const cycle1Ids = new Set(["A1"]);
    const laterBodies = [reviewerBody("A1")];
    expect(checkScopeCreep(cycle1Ids, laterBodies).violations).toEqual([]);
  });

  it("does NOT flag a cycle-3 re-citation of a finding-ID opened [NEW] in cycle-2 (R1)", () => {
    // groupByCycle folds cycle-2 and cycle-3 into one laterBodies stream, so the
    // allowed set must accumulate across it, not just compare against cycle1Ids.
    const cycle1Ids = new Set(["A1"]);
    const laterBodies = [
      reviewerBody("B2", true), // cycle-2: [NEW] B2
      reviewerBody("B2"), // cycle-3: B2 cited again, no [NEW]
    ];
    const { violations } = checkScopeCreep(cycle1Ids, laterBodies);
    expect(violations).toEqual([]);
  });
});

// ── groupByCycle ─────────────────────────────────────────────────────────────

describe("groupByCycle", () => {
  it("returns empty arrays when there is no cycle-2+ routing comment", () => {
    const records = [
      { body: routingBody(1), createdAt: "2026-01-01T00:00:00Z" },
      { body: reviewerBody("A1"), createdAt: "2026-01-01T01:00:00Z" },
    ];
    const { cycle1Bodies, laterBodies } = groupByCycle(records);
    expect(cycle1Bodies).toEqual([]);
    expect(laterBodies).toEqual([]);
  });

  it("splits correctly at the first cycle-2 routing comment", () => {
    const records = [
      { body: routingBody(1), createdAt: "2026-01-01T00:00:00Z" },
      { body: reviewerBody("A1"), createdAt: "2026-01-01T01:00:00Z" },
      { body: routingBody(2), createdAt: "2026-01-02T00:00:00Z" }, // ← boundary
      { body: reviewerBody("A1"), createdAt: "2026-01-02T01:00:00Z" },
    ];
    const { cycle1Bodies, laterBodies } = groupByCycle(records);
    expect(cycle1Bodies).toHaveLength(2);
    expect(laterBodies).toHaveLength(2);
    expect(laterBodies[0]).toContain("cycle 2"); // routing comment is included in laterBodies
  });

  it("includes the cycle-2 routing comment itself in laterBodies", () => {
    const records = [
      { body: routingBody(1), createdAt: "2026-01-01T00:00:00Z" },
      { body: routingBody(2), createdAt: "2026-01-02T00:00:00Z" },
    ];
    const { cycle1Bodies, laterBodies } = groupByCycle(records);
    expect(cycle1Bodies).toHaveLength(1);
    expect(laterBodies).toHaveLength(1);
  });

  it("handles a PR with cycle 3 when cycle 2 came earlier", () => {
    const records = [
      { body: routingBody(1), createdAt: "2026-01-01T00:00:00Z" },
      { body: reviewerBody("A1"), createdAt: "2026-01-01T01:00:00Z" },
      { body: routingBody(2), createdAt: "2026-01-02T00:00:00Z" },
      { body: reviewerBody("A1"), createdAt: "2026-01-02T01:00:00Z" },
      { body: routingBody(3), createdAt: "2026-01-03T00:00:00Z" },
      { body: reviewerBody("A1"), createdAt: "2026-01-03T01:00:00Z" },
    ];
    const { cycle1Bodies, laterBodies } = groupByCycle(records);
    expect(cycle1Bodies).toHaveLength(2); // cycle-1 routing + cycle-1 review
    expect(laterBodies).toHaveLength(4); // cycle-2 routing+review + cycle-3 routing+review
  });

  it("returns empty arrays for an empty records list", () => {
    const { cycle1Bodies, laterBodies } = groupByCycle([]);
    expect(cycle1Bodies).toEqual([]);
    expect(laterBodies).toEqual([]);
  });
});

// ── integration: end-to-end scope-creep detection ───────────────────────────

describe("end-to-end scope-creep detection", () => {
  it("clean PR: cycle-2 reviewer re-states cycle-1 findings only", () => {
    const records = [
      { body: routingBody(1), createdAt: "2026-01-01T00:00:00Z" },
      { body: reviewerBody("A1"), createdAt: "2026-01-01T01:00:00Z" }, // cycle-1: A1
      { body: routingBody(2), createdAt: "2026-01-02T00:00:00Z" },
      { body: reviewerBody("A1"), createdAt: "2026-01-02T01:00:00Z" }, // cycle-2: A1 (known)
    ];
    const { cycle1Bodies, laterBodies } = groupByCycle(records);
    const cycle1Ids = extractFindingIds(cycle1Bodies);
    const { violations } = checkScopeCreep(cycle1Ids, laterBodies);
    expect(violations).toEqual([]);
  });

  it("scope-creep: cycle-2 reviewer adds B2 without [NEW]", () => {
    const records = [
      { body: routingBody(1), createdAt: "2026-01-01T00:00:00Z" },
      { body: reviewerBody("A1"), createdAt: "2026-01-01T01:00:00Z" },
      { body: routingBody(2), createdAt: "2026-01-02T00:00:00Z" },
      { body: reviewerBody("B2"), createdAt: "2026-01-02T01:00:00Z" }, // B2 not in cycle-1
    ];
    const { cycle1Bodies, laterBodies } = groupByCycle(records);
    const cycle1Ids = extractFindingIds(cycle1Bodies);
    const { violations } = checkScopeCreep(cycle1Ids, laterBodies);
    expect(violations).toHaveLength(1);
    expect(violations[0].id).toBe("B2");
  });

  it("new finding correctly tagged [NEW] does not flag", () => {
    const records = [
      { body: routingBody(1), createdAt: "2026-01-01T00:00:00Z" },
      { body: reviewerBody("A1"), createdAt: "2026-01-01T01:00:00Z" },
      { body: routingBody(2), createdAt: "2026-01-02T00:00:00Z" },
      { body: reviewerBody("B2", true), createdAt: "2026-01-02T01:00:00Z" }, // [NEW] B2
    ];
    const { cycle1Bodies, laterBodies } = groupByCycle(records);
    const cycle1Ids = extractFindingIds(cycle1Bodies);
    const { violations } = checkScopeCreep(cycle1Ids, laterBodies);
    expect(violations).toEqual([]);
  });
});

// ── drainPages (D3/R3 fix: fail loud on mid-drain non-200) ──────────────────

describe("drainPages", () => {
  it("returns all items from a single page with no next link", async () => {
    const pages = [{ status: 200, json: [{ id: 1 }, { id: 2 }], link: null }];
    let calls = 0;
    const fetcher = async (_url: string) => pages[calls++];
    await expect(drainPages(fetcher, "/page1")).resolves.toEqual([{ id: 1 }, { id: 2 }]);
    expect(calls).toBe(1);
  });

  it("follows Link rel=next across multiple pages and concatenates items", async () => {
    const pages: Array<{ status: number; json: unknown[]; link: string | null }> = [
      { status: 200, json: [{ id: 1 }], link: '<https://api.github.com/page2>; rel="next"' },
      { status: 200, json: [{ id: 2 }], link: '<https://api.github.com/page3>; rel="next"' },
      { status: 200, json: [{ id: 3 }], link: null },
    ];
    let calls = 0;
    const fetcher = async (_url: string) => pages[calls++];
    await expect(drainPages(fetcher, "/page1")).resolves.toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(calls).toBe(3);
  });

  it("throws immediately when the first page returns non-200", async () => {
    const fetcher = async (_url: string) => ({ status: 404, json: [], link: null });
    await expect(drainPages(fetcher, "/page1")).rejects.toThrow("HTTP 404");
  });

  it("throws on a mid-drain non-200 instead of returning partial results (D3/R3)", async () => {
    // Page 1 succeeds; page 2 returns 500. Without the D3/R3 fix, page 1's items
    // would be silently returned as if the fetch were complete.
    const pages: Array<{ status: number; json: unknown[]; link: string | null }> = [
      { status: 200, json: [{ id: 1 }], link: '<https://api.github.com/page2>; rel="next"' },
      { status: 500, json: [], link: null },
    ];
    let calls = 0;
    const fetcher = async (_url: string) => pages[calls++];
    await expect(drainPages(fetcher, "/page1")).rejects.toThrow("HTTP 500");
    expect(calls).toBe(2);
  });

  it("throws when json is not an array even with status 200", async () => {
    const fetcher = async (_url: string) => ({ status: 200, json: null, link: null });
    await expect(drainPages(fetcher, "/page1")).rejects.toThrow("HTTP 200");
  });
});
