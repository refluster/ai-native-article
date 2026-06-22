// Unit tests for the ML-009 guard predicate (check-escalation-labels.mjs).
// The network loop needs a token; the predicate is pure and is the gate's core.

// @ts-nocheck — the script under test is dependency-free ESM, not TS.
import { describe, it, expect } from "vitest";
import { violatesEscalationLabel } from "./check-escalation-labels.mjs";

const MARKER = "<!-- autopilot:needs-human -->";
const LABEL = "autopilot:needs-human";

describe("violatesEscalationLabel (ML-009 guard)", () => {
  it("flags a hand-off marker with NO label (the #358 / #362 miss)", () => {
    expect(violatesEscalationLabel({ bodies: [`handing off\n${MARKER}`], labels: [] })).toBe(true);
  });

  it("passes when the hand-off carries the label", () => {
    expect(violatesEscalationLabel({ bodies: [`handing off\n${MARKER}`], labels: [LABEL] })).toBe(false);
  });

  it("is case-insensitive on the label name", () => {
    expect(violatesEscalationLabel({ bodies: [MARKER], labels: ["Autopilot:Needs-Human"] })).toBe(false);
  });

  it("never flags a PR with no hand-off marker (a normal PR)", () => {
    expect(violatesEscalationLabel({ bodies: ["lgtm", "routing: cycle 1"], labels: [] })).toBe(false);
  });

  it("finds the marker in any one of several comment/review bodies", () => {
    expect(violatesEscalationLabel({ bodies: ["nit: typo", `verdict\n${MARKER}`, "ok"], labels: ["bug"] })).toBe(true);
  });

  it("is robust to empty/missing inputs", () => {
    expect(violatesEscalationLabel({})).toBe(false);
    expect(violatesEscalationLabel({ bodies: [null, undefined], labels: [null] })).toBe(false);
  });
});
