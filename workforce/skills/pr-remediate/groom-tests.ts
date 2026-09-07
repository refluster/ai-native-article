// @ts-nocheck — groom.mjs is a dependency-free ESM script, not TS; vitest
// imports it fine at runtime and this suite is not shipped code. Discovered by
// workforce/lambdas/vitest.config.mjs (`include: ["../skills/**/*-tests.ts"]`).
//
// Locks the GROOM lane's decision surface (adr-0030). The lane pushes commits
// to PRs on L0/L1 paths with no human in that push, so what these tests hold is
// the boundary that makes it acceptable:
//   1. it touches only PRs it owns, and never one the author lane is also on;
//   2. it is bounded — an attempt is spent per base SHA, and a repeatedly
//      failing PR is dropped rather than retried forever;
//   3. it resolves ONLY conflicts that are additive on both sides, and the
//      collision guard refuses the shape that looks additive but is not.
import { describe, it, expect } from "vitest";
import {
  GROOM_BLOCK_CAP,
  classifyConflictFile,
  classifyConflictHunk,
  classifyGroom,
  consecutiveBlocked,
  groomHistory,
  groomMarker,
  registryIds,
} from "./groom.mjs";
import { AUTHOR_LABEL, ESCALATION_LABEL } from "../pr-autopilot/pr-merge.mjs";

const BASE = "abc1234def";
const inLane = (over = {}) => ({
  labels: [ESCALATION_LABEL],
  mergeable: true,
  mergeableState: "clean",
  baseSha: BASE,
  bodies: [],
  ...over,
});

describe("classifyGroom — whose PR is this?", () => {
  it("ignores a PR that is not escalated", () => {
    expect(classifyGroom(inLane({ labels: [], mergeableState: "dirty" }))).toMatchObject({
      kind: "not-in-lane",
      actionable: false,
    });
  });

  it("autopilot:off pauses this lane too", () => {
    expect(classifyGroom(inLane({ labels: [ESCALATION_LABEL, "autopilot:off"], mergeableState: "dirty" }))).toMatchObject({
      kind: "not-in-lane",
      actionable: false,
    });
  });

  // Both lanes pushing to one head branch is the race this ordering prevents:
  // the author lane rewrites the diff while the groomer merges the base into it.
  it("stands down when the author lane is also on the PR", () => {
    const v = classifyGroom(inLane({ labels: [ESCALATION_LABEL, AUTHOR_LABEL], mergeableState: "dirty" }));
    expect(v).toMatchObject({ kind: "not-in-lane", actionable: false });
    expect(v.why).toContain(AUTHOR_LABEL);
  });
});

describe("classifyGroom — what is actionable", () => {
  it("a conflicted escalated PR is the lane's job", () => {
    expect(classifyGroom(inLane({ mergeable: false, mergeableState: "dirty" }))).toMatchObject({
      kind: "conflict",
      actionable: true,
    });
  });

  it("a behind branch is the weaker form of the same job", () => {
    expect(classifyGroom(inLane({ mergeableState: "behind" }))).toMatchObject({ kind: "behind", actionable: true });
  });

  // The whole point of the lane being weaker than the author lane: the reason
  // the PR sits in the human queue is never the groomer's to remove.
  it("a mergeable PR is decision-ready, not a miss", () => {
    expect(classifyGroom(inLane())).toMatchObject({ kind: "decision-ready", actionable: false });
  });

  it("never becomes actionable over review findings or red checks", () => {
    // Same PR shape as a findings escalation: mergeable, clean, just undecided.
    const v = classifyGroom(inLane({ mergeableState: "unstable" }));
    expect(v.actionable).toBe(false);
    expect(v.kind).toBe("decision-ready");
  });
});

describe("the base-keyed bound", () => {
  it("skips a PR already groomed at the current base — including a claim that died", () => {
    const bodies = [`working on it\n\n${groomMarker(BASE, "claimed")}\n`];
    const v = classifyGroom(inLane({ mergeable: false, mergeableState: "dirty", bodies }));
    expect(v).toMatchObject({ kind: "already-groomed", actionable: false });
  });

  it("grooms again once the base has moved", () => {
    const bodies = [`done\n\n${groomMarker("0000111", "pushed")}\n`];
    const v = classifyGroom(inLane({ mergeable: false, mergeableState: "dirty", bodies }));
    expect(v).toMatchObject({ kind: "conflict", actionable: true });
  });

  it(`drops a PR after ${GROOM_BLOCK_CAP} consecutive blocked bases`, () => {
    const bodies = ["1111111", "2222222", "3333333"].map((s) => groomMarker(s, "blocked"));
    const v = classifyGroom(inLane({ mergeable: false, mergeableState: "dirty", bodies }));
    expect(v).toMatchObject({ kind: "groom-blocked", actionable: false, escalate: "groom-blocked" });
  });

  it("a successful push resets the blocked streak", () => {
    const hist = groomHistory([
      groomMarker("1111111", "blocked"),
      groomMarker("2222222", "pushed"),
      groomMarker("3333333", "blocked"),
    ]);
    expect(consecutiveBlocked(hist)).toBe(1);
  });

  it("counts one blocked attempt per base, not per comment", () => {
    const hist = groomHistory([groomMarker("1111111", "blocked"), groomMarker("1111111", "blocked")]);
    expect(consecutiveBlocked(hist)).toBe(1);
  });

  it("refuses a marker without a real base SHA", () => {
    expect(() => groomMarker("")).toThrow();
    expect(() => groomMarker("not-a-sha")).toThrow();
    expect(() => groomMarker(BASE, "merged")).toThrow();
  });
});

describe("classifyConflictHunk — only additions may be resolved", () => {
  it("accepts two sides that each add their own lines", () => {
    const v = classifyConflictHunk({ ours: ["- name: cfn lint", "  run: cfn-lint"], theirs: ["- name: base path", "  run: check"] });
    expect(v.additive).toBe(true);
  });

  it("refuses a hunk where one side is empty — that is a deletion", () => {
    expect(classifyConflictHunk({ ours: ["kept"], theirs: [] }).additive).toBe(false);
  });

  it("refuses a hunk where both sides carry the same line — that is a rewrite", () => {
    const v = classifyConflictHunk({ ours: ["shared", "mine"], theirs: ["shared", "yours"] });
    expect(v.additive).toBe(false);
    expect(v.reason).toContain("rewrote");
  });
});

// The two real collisions from the 2026-09-07 session the ADR is written
// against. Both are textually additive; keeping both rows would have produced a
// well-formed file asserting two meanings for one identifier, and every
// registry check would have passed on it.
describe("the collision guard (ML-027)", () => {
  it("refuses the R-16 collision: main's base-path gate vs #602's read-back gate", () => {
    const v = classifyConflictHunk({
      ours: ["| R-16 | Cadence write-script read-back gate | check-cadence-readback-guard |"],
      theirs: ["| R-16 | Base-path consistency gate | check-base-path |", "| R-17 | Live base-path smoke | check-live-base-path |"],
    });
    expect(v.additive).toBe(false);
    expect(v.collisions).toEqual(["R-16"]);
    expect(v.reason).toContain("ML-027");
  });

  it("refuses the ML-020 collision: main's truncation entry vs #546's body-path race", () => {
    const v = classifyConflictHunk({
      ours: ["| ML-020 | A skill body that names a fixed temp path is unsafe under the batched runner |"],
      theirs: ["| ML-020 | A content-integrity heuristic must cover every language |", "| ML-021 | A guard must preserve its evidence |"],
    });
    expect(v.additive).toBe(false);
    expect(v.collisions).toEqual(["ML-020"]);
  });

  it("still accepts two sides that allocate DIFFERENT ids — that is the normal append", () => {
    const v = classifyConflictHunk({
      ours: ["| ML-035 | the body-path race |"],
      theirs: ["| ML-034 | an allowlist mirror no CI job runs |"],
    });
    expect(v.additive).toBe(true);
    expect(v.collisions).toEqual([]);
  });

  it("recognises every id family the registries use", () => {
    const ids = registryIds(["R-18 and R-N10 and ML-035 and FU-040 and OP-016 and ADR-0030"]);
    expect([...ids].sort()).toEqual(["ADR-0030", "FU-040", "ML-035", "OP-016", "R-18", "R-N10"]);
  });
});

describe("classifyConflictFile — one bad hunk taints the file", () => {
  it("accepts a file whose every hunk is additive", () => {
    const v = classifyConflictFile([
      { ours: ["a1"], theirs: ["b1"] },
      { ours: ["a2"], theirs: ["b2"] },
    ]);
    expect(v.additive).toBe(true);
  });

  // A half-resolved conflict pushed to someone else's branch is worse than an
  // unresolved one, so the file escalates whole.
  it("refuses the whole file when a single hunk is not additive", () => {
    const v = classifyConflictFile([
      { ours: ["a1"], theirs: ["b1"] },
      { ours: ["| R-16 | mine |"], theirs: ["| R-16 | theirs |"] },
    ]);
    expect(v.additive).toBe(false);
    expect(v.blocked).toHaveLength(1);
    expect(v.reason).toContain("#1");
  });

  it("refuses an empty hunk list rather than calling it clean", () => {
    expect(classifyConflictFile([]).additive).toBe(false);
  });
});
