// @ts-nocheck — the module under test (escalation-reasons.mjs) is a
// dependency-free ESM script, not TS; vitest/esbuild imports it fine at
// runtime, and this suite is not shipped code. Discovered by
// workforce/lambdas/vitest.config.mjs (`include: ["../skills/**/*-tests.ts"]`),
// so `cd workforce/lambdas && npm test` runs it.
//
// Locks the Epic-019 Story 1 taxonomy (workforce/docs/pr-escalation-reasons.md
// v1): the code list is closed (unknown code = throw, C-4), the sweep's three
// kind strings are reused verbatim, `other` never travels without free text,
// and every pr-merge.mjs refusal `why` string maps onto its taxonomy code.
import { describe, it, expect } from "vitest";
import {
  REASON_CODES,
  REASON_LABEL_PREFIX,
  assertReasonCode,
  reasonLabel,
  reasonMarker,
  findReasonMarkers,
  refusalReasonCode,
} from "./escalation-reasons.mjs";

describe("REASON_CODES (taxonomy v1)", () => {
  it("reuses the sweep's three kind strings verbatim (never flattened)", () => {
    for (const kind of ["unlabelled-handoff", "stale-routed", "never-routed"]) {
      expect(REASON_CODES).toContain(kind);
    }
  });
  it("carries every v1 code from the Epic-019 Story 1 list", () => {
    for (const code of [
      "l0l1-path", "human-changes-requested", "checks-failing", "checks-pending-aged",
      "no-reviewer-consensus", "not-mergeable", "kill-switch-off", "no-r-n10-delegation",
      "cannot-seat-panel", "persona-escalation-trigger", "cycle-cap-exceeded",
      "merge-engine-refusal", "other",
    ]) {
      expect(REASON_CODES).toContain(code);
    }
  });
});

describe("assertReasonCode / reasonLabel — unknown codes fail loud (C-4)", () => {
  it("accepts a taxonomy code", () => expect(assertReasonCode("l0l1-path")).toBe("l0l1-path"));
  it("throws on an unknown code, never invents a bucket", () => {
    expect(() => assertReasonCode("reviewer-was-slow")).toThrow(/unknown escalation-reason code/);
    expect(() => reasonLabel("reviewer-was-slow")).toThrow(/unknown escalation-reason code/);
  });
  it("builds the canonical label", () =>
    expect(reasonLabel("stale-routed")).toBe(`${REASON_LABEL_PREFIX}stale-routed`));
});

describe("reasonMarker — the hidden-comment carrier", () => {
  it("emits the bare marker for a specific code", () =>
    expect(reasonMarker("never-routed")).toBe("<!-- autopilot:reason:never-routed -->"));
  it("carries free text when given", () =>
    expect(reasonMarker("other", "target repo archived")).toBe("<!-- autopilot:reason:other target repo archived -->"));
  it("throws on `other` without free text — mislabeling cannot satisfy coverage", () => {
    expect(() => reasonMarker("other")).toThrow(/requires free text/);
    expect(() => reasonMarker("other", "   ")).toThrow(/requires free text/);
  });
  it("throws on an unknown code", () => expect(() => reasonMarker("nope")).toThrow(/unknown/));
  it("neutralises a comment-closing --> inside the free text", () =>
    expect(reasonMarker("other", "weird --> text")).not.toMatch(/--> text/));
});

describe("findReasonMarkers — parsing what emitters wrote", () => {
  it("finds code + text", () => {
    const body = `verdict…\n<!-- autopilot:needs-human -->\n<!-- autopilot:reason:cannot-seat-panel -->\n`;
    expect(findReasonMarkers(body)).toEqual([{ code: "cannot-seat-panel", text: "" }]);
  });
  it("returns the free text on an `other` marker", () => {
    expect(findReasonMarkers("<!-- autopilot:reason:other repo archived -->")).toEqual([
      { code: "other", text: "repo archived" },
    ]);
  });
  it("ignores the other autopilot:* markers", () => {
    const body = "<!-- autopilot:needs-human -->\n<!-- autopilot:reviewed -->\n<!-- autopilot:review:dario:green -->";
    expect(findReasonMarkers(body)).toEqual([]);
  });
  it("throws on a marker carrying an unknown code (C-4)", () => {
    expect(() => findReasonMarkers("<!-- autopilot:reason:sloppy-review -->")).toThrow(/unknown/);
  });
  it("throws on a bare `other` marker", () => {
    expect(() => findReasonMarkers("<!-- autopilot:reason:other -->")).toThrow(/free text/);
  });
});

describe("refusalReasonCode — pr-merge.mjs `why` strings map 1:1 (verbatim phrasing)", () => {
  const CASES: Array<[string, string]> = [
    ["autopilot:off label set — paused by maintainer", "kill-switch-off"],
    ["cannot read target governance docs/governance.md (HTTP 404) — L0/L1 set unknown, failing merge closed", "no-r-n10-delegation"],
    ["docs/governance.md declares no <!-- autopilot:l0l1-paths --> block — L0/L1 set unknown, failing merge closed", "no-r-n10-delegation"],
    ["docs/governance.md L0/L1 block is empty — failing merge closed", "no-r-n10-delegation"],
    ["touches L0/L1 path docs/governance.md — escalate to human (operator's final call)", "l0l1-path"],
    ["a reviewer has CHANGES_REQUESTED — not consensus-green", "human-changes-requested"],
    ["check 'ci' is in_progress", "checks-pending-aged"],
    ["check 'ci' = failure", "checks-failing"],
    // adr-0022: the engine's single mergeability refusal splits by state —
    // dirty/behind name an agent-fixable branch condition (author lane),
    // every other state stays the human lane's `not-mergeable`.
    ["not mergeable (mergeable=false, state=dirty)", "merge-conflict"],
    ["not mergeable (mergeable=false, state=behind)", "branch-behind"],
    ["not mergeable (mergeable=false, state=blocked)", "not-mergeable"],
    ["not mergeable (mergeable=null, state=unknown)", "not-mergeable"],
    ["review reached cycle 8, exceeding the W-4 hard cap of 7 — process breakdown, escalate to human", "cycle-cap-exceeded"],
    ["missing green marker(s) from ren (expected <!-- autopilot:review:ren:green -->) — consensus not reached", "no-reviewer-consensus"],
    ["only 2 distinct reviewer(s) signed off — a merge requires a panel of at least 3 unanimous-green reviewers (operator directive 2026-06-29); under-reviewed merge refused", "no-reviewer-consensus"],
  ];
  for (const [why, code] of CASES) {
    it(`"${why.slice(0, 48)}…" → ${code}`, () => expect(refusalReasonCode(why)).toBe(code));
  }
  it("an unmatched refusal falls back to merge-engine-refusal, never a guess", () => {
    expect(refusalReasonCode("PR #7 is closed")).toBe("merge-engine-refusal");
    expect(refusalReasonCode("merge PUT rejected HTTP 405")).toBe("merge-engine-refusal");
    expect(refusalReasonCode("")).toBe("merge-engine-refusal");
  });
  it("every mapped code is inside the taxonomy (the map cannot drift)", () => {
    for (const [why] of CASES) expect(() => assertReasonCode(refusalReasonCode(why))).not.toThrow();
  });
});
