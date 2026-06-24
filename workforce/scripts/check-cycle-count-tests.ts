// Unit tests for the FU-004 cycle-cap guard (check-cycle-count.mjs).
// The network loop requires a token; the predicate is pure and is the gate's core.

// @ts-nocheck — the script under test is dependency-free ESM, not TS.
import { describe, it, expect } from "vitest";
import { violatesCycleCap } from "./check-cycle-count.mjs";

// Helpers that produce realistic routing-comment bodies matching the SKILL.md template.
const routingBody = (cycle: number, cap = 7, persona = "Nadia") =>
  `**${persona} — cycle ${cycle} of ≤ ${cap}.**\n\nOne-paragraph PR summary.\n\nReviewers nominated:\n- **@dario** — reason`;

const verdictBody = (cycle: number, cap = 7, persona = "Nadia") =>
  `**${persona} — cycle ${cycle} of ≤ ${cap}.**\n\n🟢 Verdict — all cycle-${cycle} findings addressed.`;

describe("violatesCycleCap (FU-004 / W-4 cycle cap guard)", () => {
  it("does not flag a PR with no routing comments", () => {
    expect(violatesCycleCap({ bodies: ["LGTM", "Minor nit: rename foo"] })).toBe(false);
  });

  it("does not flag a PR at cycle 1 (healthy first routing)", () => {
    expect(violatesCycleCap({ bodies: [routingBody(1)] })).toBe(false);
  });

  it("does not flag a PR at the cap boundary (cycle 7)", () => {
    expect(violatesCycleCap({ bodies: [routingBody(7)] })).toBe(false);
  });

  it("flags a PR at cycle 8 (one over the W-4 cap)", () => {
    expect(violatesCycleCap({ bodies: [routingBody(8)] })).toBe(true);
  });

  it("flags a PR at cycle 9 (deep process breakdown)", () => {
    expect(violatesCycleCap({ bodies: [routingBody(9)] })).toBe(true);
  });

  it("uses the highest cycle number across multiple bodies", () => {
    // PR has routing comments for cycles 1, 3, and a verdict at 3 — max is 3, within cap.
    const bodies = [routingBody(1), routingBody(3), verdictBody(3), "unrelated comment"];
    expect(violatesCycleCap({ bodies })).toBe(false);
  });

  it("flags when the max across several bodies exceeds the cap", () => {
    const bodies = [routingBody(1), routingBody(7), routingBody(8)];
    expect(violatesCycleCap({ bodies })).toBe(true);
  });

  it("respects a custom cap override", () => {
    // cap=3 → cycle 4 is a violation; cycle 3 is not.
    expect(violatesCycleCap({ bodies: [routingBody(4)], cap: 3 })).toBe(true);
    expect(violatesCycleCap({ bodies: [routingBody(3)], cap: 3 })).toBe(false);
  });

  it("works with verdict-format bodies as well as routing bodies", () => {
    expect(violatesCycleCap({ bodies: [verdictBody(8)] })).toBe(true);
    expect(violatesCycleCap({ bodies: [verdictBody(7)] })).toBe(false);
  });

  it("is robust to empty / null / undefined inputs", () => {
    expect(violatesCycleCap()).toBe(false);
    expect(violatesCycleCap({ bodies: [] })).toBe(false);
    expect(violatesCycleCap({ bodies: [null, undefined, ""] })).toBe(false);
  });

  it("ignores prose that mentions 'cycle' without matching the routing header pattern", () => {
    const proseWithCycle = "This PR is part of the release cycle and spans 3 iterations.";
    expect(violatesCycleCap({ bodies: [proseWithCycle] })).toBe(false);
  });
});
