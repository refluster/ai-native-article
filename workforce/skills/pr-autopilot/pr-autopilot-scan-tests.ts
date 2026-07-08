// @ts-nocheck — the script under test (pr-autopilot-scan.mjs) is a
// dependency-free ESM script, not TS; vitest/esbuild imports it fine at
// runtime, and this suite is not shipped code. Discovered by
// workforce/lambdas/vitest.config.mjs (`include: ["../skills/**/*-tests.ts"]`),
// so `cd workforce/lambdas && npm test` runs it.
//
// Locks Epic-019 Story 2b (nomination load cap): a persona holds at most
// NOMINATION_SEAT_CAP concurrent open lens-review seats (one per open,
// non-terminal PR whose routing comment nominates its `wf:<slug>`); the cap
// filter replaces a capped persona with another eligible one, and when no ≥3
// panel can be seated it escalates with the existing taxonomy code
// `cannot-seat-panel` — never a quiet under-sized panel.
import { describe, it, expect } from "vitest";
import {
  NOMINATION_SEAT_CAP,
  countOpenSeats,
  applyNominationCap,
  alreadyRouted,
  withinWindow,
} from "./pr-autopilot-scan.mjs";
import { MIN_REVIEWERS } from "./pr-merge.mjs";

// The SKILL.md Step 2 routing-comment shape (nomination bullets + skip line).
const routingComment = (slugs, skipped = []) =>
  [
    "**Nadia — cycle 1 of ≤ 7.**",
    "",
    "Summary…",
    "",
    "Reviewers nominated (≥ 3):",
    "",
    ...slugs.map((s) => `- **\`wf:${s}\`** — owns this surface`),
    "",
    ...skipped.map((s) => `Skipping \`wf:${s}\` — no surface.`),
  ].join("\n");

describe("countOpenSeats — seats from wf:<slug> nomination markers on open PRs", () => {
  it("counts one seat per persona per open PR", () => {
    const counts = countOpenSeats([
      { labels: [], bodies: [routingComment(["dario", "ren", "mateo"])] },
      { labels: [], bodies: [routingComment(["dario", "hana", "yuki"])] },
    ]);
    expect(counts).toEqual({ dario: 2, ren: 1, mateo: 1, hana: 1, yuki: 1 });
  });
  it("a cycle-2 re-route on the same PR is the same seat, not a second one", () => {
    const counts = countOpenSeats([
      { labels: [], bodies: [routingComment(["dario", "ren", "mateo"]), routingComment(["dario", "ren", "mateo"])] },
    ]);
    expect(counts.dario).toBe(1);
  });
  it("terminal/paused PRs release their seats (needs-human / autopilot:off)", () => {
    const counts = countOpenSeats([
      { labels: ["autopilot:needs-human"], bodies: [routingComment(["dario", "ren", "mateo"])] },
      { labels: ["Autopilot:Off"], bodies: [routingComment(["dario"])] },
      { labels: ["some-other-label"], bodies: [routingComment(["dario", "ren", "mateo"])] },
    ]);
    expect(counts).toEqual({ dario: 1, ren: 1, mateo: 1 });
  });
  it("skip lines, green markers, sign-offs, and prose wf: mentions are not seats", () => {
    const counts = countOpenSeats([
      {
        labels: [],
        bodies: [
          routingComment(["dario", "ren", "mateo"], ["maya"]),
          "looks good\n<!-- autopilot:review:hana:green -->",
          "— Yuki (LLM persona; lens: platform; manual route via pr-autopilot)",
          "as `wf:celeste` noted in the verdict…",
        ],
      },
    ]);
    expect(counts).toEqual({ dario: 1, ren: 1, mateo: 1 });
  });
  it("is case-insensitive on the slug and tolerates * bullets", () => {
    const counts = countOpenSeats([{ labels: [], bodies: ["* **`wf:Dario`** — surface"] }]);
    // The nomination-bullet slug charset is lowercase (persona slugs are);
    // `wf:Dario` would not be written by the template — but a lowercase slug
    // behind a * bullet still counts.
    expect(countOpenSeats([{ labels: [], bodies: ["* **`wf:dario`** — surface"] }])).toEqual({ dario: 1 });
    expect(counts).toEqual({});
  });
  it("empty inputs count nothing", () => {
    expect(countOpenSeats([])).toEqual({});
    expect(countOpenSeats([{ labels: [], bodies: [] }])).toEqual({});
  });
});

describe("applyNominationCap — the Step 2 mechanical cap filter", () => {
  const candidates = ["dario", "ren", "mateo", "hana"];

  it("under the cap: everyone stays eligible, panel seatable", () => {
    const r = applyNominationCap(candidates, { dario: 2, ren: 0 });
    expect(r.eligible).toEqual(candidates);
    expect(r.overCap).toEqual([]);
    expect(r.canSeatPanel).toBe(true);
    expect(r.escalateWith).toBeNull();
  });
  it("AT the cap is capped: holding NOMINATION_SEAT_CAP seats means no new nomination", () => {
    const r = applyNominationCap(candidates, { dario: NOMINATION_SEAT_CAP });
    expect(r.eligible).toEqual(["ren", "mateo", "hana"]);
    expect(r.overCap).toEqual([{ slug: "dario", openSeats: NOMINATION_SEAT_CAP }]);
    expect(r.canSeatPanel).toBe(true); // the router picks another persona
  });
  it("over the cap is capped too", () => {
    const r = applyNominationCap(candidates, { dario: NOMINATION_SEAT_CAP + 3 });
    expect(r.overCap).toEqual([{ slug: "dario", openSeats: NOMINATION_SEAT_CAP + 3 }]);
  });
  it("no seatable ≥3 panel → escalateWith the existing cannot-seat-panel code", () => {
    const r = applyNominationCap(candidates, { dario: 5, ren: 6, mateo: 9 });
    expect(r.eligible).toEqual(["hana"]);
    expect(r.eligible.length).toBeLessThan(MIN_REVIEWERS);
    expect(r.canSeatPanel).toBe(false);
    expect(r.escalateWith).toBe("cannot-seat-panel");
  });
  it("de-dupes and case-folds candidate slugs; unknown personas count 0 seats", () => {
    const r = applyNominationCap(["Dario", "dario", " ren ", "newbie"], { dario: 1 });
    expect(r.eligible).toEqual(["dario", "ren", "newbie"]);
  });
  it("a custom cap is honoured", () => {
    const r = applyNominationCap(candidates, { dario: 2 }, 2);
    expect(r.overCap).toEqual([{ slug: "dario", openSeats: 2 }]);
  });
  it("throws (C-4) on a broken cap or candidate list — never silently un-caps", () => {
    expect(() => applyNominationCap(candidates, {}, 0)).toThrow(/positive integer/);
    expect(() => applyNominationCap(candidates, {}, 2.5)).toThrow(/positive integer/);
    expect(() => applyNominationCap("dario", {})).toThrow(/array/);
  });
});

// Guard the pre-existing pure helpers this suite now shares a file with —
// they had no coverage before the Story-2b change touched the module.
describe("alreadyRouted / withinWindow (existing discovery gates)", () => {
  it("alreadyRouted matches the persona's cycle-opening marker", () => {
    expect(alreadyRouted([{ body: "**Nadia — cycle 1 of ≤ 7.**\n…" }], "nadia")).toBe(true);
    expect(alreadyRouted([{ body: "**Maya — cycle 1 of ≤ 7.**" }], "nadia")).toBe(false);
    expect(alreadyRouted([], "nadia")).toBe(false);
  });
  it("withinWindow gates on the recency window", () => {
    const now = Date.parse("2026-07-08T00:00:00Z");
    expect(withinWindow("2026-07-05T00:00:00Z", 7, now)).toBe(true);
    expect(withinWindow("2026-06-20T00:00:00Z", 7, now)).toBe(false);
    expect(withinWindow("not-a-date", 7, now)).toBe(false);
  });
});
