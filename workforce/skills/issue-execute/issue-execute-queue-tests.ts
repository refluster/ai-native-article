// @ts-nocheck — the module under test is a dependency-free ESM script, not TS.
// Discovered by workforce/lambdas/vitest.config.mjs (`../skills/**/*-tests.ts`).
//
// Locks adr-0046 §3 for the executor: a member works ONLY `stage:assigned` +
// its own `owner:` label, never an issue an open PR already claims, oldest
// first, bounded by max_issues_per_run.
import { describe, it, expect } from "vitest";
import { executeQueue, isMine } from "./issue-execute-queue.mjs";

const iso = (d) => `2026-10-0${d}T00:00:00Z`;
const issues = [
  { number: 1, state: "open", labels: ["stage:assigned", "owner:ren"], updated_at: iso(3) },
  { number: 2, state: "open", labels: [{ name: "stage:assigned" }, { name: "owner:ren" }], updated_at: iso(1) },
  { number: 3, state: "open", labels: ["stage:assigned", "owner:dario"], updated_at: iso(1) },
  { number: 4, state: "open", labels: ["stage:verified"], updated_at: iso(1) },
  { number: 5, state: "open", labels: ["owner:ren"], updated_at: iso(1) },
  { number: 6, state: "open", labels: ["stage:assigned", "owner:ren"], updated_at: iso(2) },
  { number: 7, state: "closed", labels: ["stage:assigned", "owner:ren"], updated_at: iso(1) },
  { number: 8, state: "open", pull_request: {}, labels: ["stage:assigned", "owner:ren"], updated_at: iso(1) },
];

describe("isMine", () => {
  it("needs both stage:assigned and my owner label, on an open issue", () => {
    expect(isMine(issues[0], "ren")).toBe(true);
    expect(isMine(issues[1], "REN")).toBe(true);
    expect(isMine(issues[2], "ren")).toBe(false); // dario's
    expect(isMine(issues[3], "ren")).toBe(false); // verified, nobody's yet
    expect(isMine(issues[4], "ren")).toBe(false); // owner without stage (rule 2 broken) — not mine to touch
    expect(isMine(issues[6], "ren")).toBe(false); // closed
    expect(isMine(issues[7], "ren")).toBe(false); // a PR
  });
});

describe("executeQueue", () => {
  it("selects only my assigned issues, oldest first, under the cap", () => {
    expect(executeQueue(issues, { slug: "ren", openPrRefs: new Set(), max: 10 }).map((i) => i.number)).toEqual([2, 6, 1]);
    expect(executeQueue(issues, { slug: "ren", openPrRefs: new Set(), max: 2 }).map((i) => i.number)).toEqual([2, 6]);
    expect(executeQueue(issues, { slug: "dario", openPrRefs: new Set() }).map((i) => i.number)).toEqual([3]);
  });

  it("skips an issue an open PR already references (the PR is the claim)", () => {
    expect(executeQueue(issues, { slug: "ren", openPrRefs: new Set([2]), max: 10 }).map((i) => i.number)).toEqual([6, 1]);
    expect(executeQueue(issues, { slug: "ren", openPrRefs: new Map([[6, [99]]]), max: 10 }).map((i) => i.number)).toEqual([2, 1]);
  });

  it("refuses to run without a slug — there is no 'everyone's queue'", () => {
    expect(() => executeQueue(issues, { openPrRefs: new Set() })).toThrow(/slug is required/);
  });
});
