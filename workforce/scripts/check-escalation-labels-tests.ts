// Unit tests for the ML-009 guard predicate (check-escalation-labels.mjs).
// The network loop needs a token; the predicate is pure and is the gate's core.

// @ts-nocheck — the script under test is dependency-free ESM, not TS.
import { describe, it, expect } from "vitest";
import { violatesEscalationLabel, violatesEscalationReason } from "./check-escalation-labels.mjs";

const MARKER = "<!-- autopilot:needs-human -->";
const LABEL = "autopilot:needs-human";
const AUTHOR_LABEL = "autopilot:needs-author";
const REASON = "autopilot:reason:not-mergeable";

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

  // adr-0022 author lane: a marker is immutable history, a label is current
  // state. A PR re-parked into the author lane is not in the operator's queue
  // and is not owed the escalation label.
  it("exempts a PR that carries the author-lane label instead", () => {
    expect(violatesEscalationLabel({ bodies: [`verdict\n${MARKER}`], labels: ["autopilot:needs-author"] })).toBe(false);
  });

  it("is case-insensitive on the author-lane label too", () => {
    expect(violatesEscalationLabel({ bodies: [MARKER], labels: ["Autopilot:Needs-Author"] })).toBe(false);
  });

  it("still passes when a PR somehow carries BOTH lane labels", () => {
    expect(violatesEscalationLabel({ bodies: [MARKER], labels: [LABEL, "autopilot:needs-author"] })).toBe(false);
  });

  it("still flags a hand-off with neither lane label — the exemption is not a blanket pass", () => {
    expect(violatesEscalationLabel({ bodies: [MARKER], labels: ["bug", "autopilot:reviewed"] })).toBe(true);
  });
});

// #662: the escalation-REASON half of the same ML-009 defect class — a
// session-driven hand-off can carry the lane label without a reason label.
describe("violatesEscalationReason (#662 guard)", () => {
  it("flags a human-lane PR with no autopilot:reason:* label at all", () => {
    expect(violatesEscalationReason({ labels: [LABEL] })).toBe(true);
  });

  it("flags an author-lane PR with no autopilot:reason:* label at all", () => {
    expect(violatesEscalationReason({ labels: [AUTHOR_LABEL] })).toBe(true);
  });

  it("passes a human-lane PR that carries a reason label", () => {
    expect(violatesEscalationReason({ labels: [LABEL, REASON] })).toBe(false);
  });

  it("passes an author-lane PR that carries a reason label", () => {
    expect(violatesEscalationReason({ labels: [AUTHOR_LABEL, REASON] })).toBe(false);
  });

  it("never flags a PR in neither lane, reason or not (not a hand-off)", () => {
    expect(violatesEscalationReason({ labels: [] })).toBe(false);
    expect(violatesEscalationReason({ labels: ["bug", "autopilot:reviewed"] })).toBe(false);
  });

  it("is case-insensitive on both the lane label and the reason prefix", () => {
    expect(violatesEscalationReason({ labels: ["Autopilot:Needs-Human"] })).toBe(true);
    expect(violatesEscalationReason({ labels: ["Autopilot:Needs-Human", "Autopilot:Reason:Not-Mergeable"] })).toBe(false);
  });

  it("is robust to empty/missing inputs", () => {
    expect(violatesEscalationReason({})).toBe(false);
    expect(violatesEscalationReason({ labels: [null, undefined] })).toBe(false);
  });

  it("flags a PR carrying both lane labels (a real defect) if neither has a reason", () => {
    expect(violatesEscalationReason({ labels: [LABEL, AUTHOR_LABEL] })).toBe(true);
  });
});
