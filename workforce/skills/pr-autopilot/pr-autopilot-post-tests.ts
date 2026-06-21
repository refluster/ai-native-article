// @ts-nocheck — the script under test (pr-autopilot-post.mjs) is a dependency-free
// ESM script, not TS; vitest/esbuild imports it fine at runtime, and this suite is
// not shipped code. Discovered by workforce/lambdas/vitest.config.mjs
// (`include: ["../skills/**/*-tests.ts"]`), so `cd workforce/lambdas && npm test`
// runs it.
//
// Locks the operator directive (2026-06-21): a pr-autopilot hand-off to a human
// ALWAYS carries the autopilot:needs-human label. resolveLabels is the mechanical
// half — it must add ESCALATION_LABEL whenever the verdict escalates (the
// --needs-human flag OR the hidden body marker), and never on a plain routing
// comment.
import { describe, it, expect } from "vitest";
import { resolveLabels, NEEDS_HUMAN_MARKER } from "./pr-autopilot-post.mjs";
import { ESCALATION_LABEL } from "./pr-merge.mjs";

describe("resolveLabels — escalation always carries the label", () => {
  it("a plain routing comment (no flag, no marker) gets no escalation label", () => {
    expect(resolveLabels([], { needsHuman: false, body: "**Nadia — cycle 1.**" })).toEqual([]);
  });

  it("--needs-human forces ESCALATION_LABEL even with no --label values", () => {
    expect(resolveLabels([], { needsHuman: true, body: "verdict" })).toEqual([ESCALATION_LABEL]);
  });

  it("the hidden body marker forces ESCALATION_LABEL even if --needs-human was forgotten", () => {
    const body = `L0/L1 change — operator's final call.\n\n${NEEDS_HUMAN_MARKER}\n`;
    expect(resolveLabels([], { needsHuman: false, body })).toEqual([ESCALATION_LABEL]);
  });

  it("merges explicit --label values and de-dupes the canonical label", () => {
    const out = resolveLabels(["governance", ESCALATION_LABEL], {
      needsHuman: true,
      body: NEEDS_HUMAN_MARKER,
    });
    expect(out).toContain("governance");
    expect(out.filter((l) => l === ESCALATION_LABEL)).toHaveLength(1);
  });

  it("extra --label values without escalation do NOT add the canonical label", () => {
    expect(resolveLabels(["needs-rebase"], { needsHuman: false, body: "" })).toEqual(["needs-rebase"]);
  });

  it("the marker constant is the canonical hidden token", () => {
    expect(NEEDS_HUMAN_MARKER).toBe("<!-- autopilot:needs-human -->");
  });
});
