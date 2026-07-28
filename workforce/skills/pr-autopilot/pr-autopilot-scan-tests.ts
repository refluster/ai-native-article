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
  headCommitDate,
  isTerminal,
  nextRoutingCycle,
  routingState,
  selectCandidates,
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


// ── The re-route gate (cycle ≥ 2 discovery) ──────────────────────────────────
// Regression corpus for the discovery bug found on #507 (2026-07-27): the old
// alreadyRouted() gate matched `cycle \d+`, so ANY routed PR was excluded from
// discovery forever. SKILL.md Step 5 promises a 🟡 verdict re-routes on the
// next tick once the author revises; that promise had no implementation.

const routed = (persona: string, cycle: number, at: string) => ({
  body: `**${persona} — cycle ${cycle} of ≤ 7.**\n\nSummary…`,
  created_at: at,
});

describe("routingState — the persona's routing history on a PR", () => {
  it("reports zero cycles when the persona has never routed", () => {
    expect(routingState([], "nadia")).toEqual({ cycle: 0, lastRoutedAt: null });
    expect(routingState([routed("Maya", 1, "2026-07-27T07:35:00Z")], "nadia").cycle).toBe(0);
  });

  it("takes the HIGHEST cycle and the LATEST routing timestamp", () => {
    const st = routingState(
      [routed("Nadia", 1, "2026-07-25T07:35:00Z"), routed("Nadia", 2, "2026-07-27T07:35:00Z")],
      "nadia",
    );
    expect(st.cycle).toBe(2);
    expect(st.lastRoutedAt).toBe(Date.parse("2026-07-27T07:35:00Z"));
  });

  // Catches: counting the verdict comment as a second opened cycle, which
  // would double-increment every round.
  it("ignores the verdict comment — only the routing comment opens a cycle", () => {
    const verdict = {
      body: "**Nadia — verdict, cycle 1 of ≤ 3. Hand-off.**\n\n…",
      created_at: "2026-07-27T07:43:00Z",
    };
    expect(routingState([verdict], "nadia").cycle).toBe(0);
  });
});

describe("nextRoutingCycle — the discovery gate", () => {
  const ROUTED_AT = "2026-07-27T07:35:00Z";
  const comments = [routed("Nadia", 1, ROUTED_AT)];

  it("routes an unrouted PR at cycle 1 (unchanged behaviour)", () => {
    expect(nextRoutingCycle({ comments: [], persona: "nadia" })).toBe(1);
  });

  // THE REGRESSION. Against the pre-fix code this PR never came back.
  it("re-routes at cycle 2 when the author pushed after the routing comment", () => {
    expect(
      nextRoutingCycle({ comments, persona: "nadia", headCommittedAt: "2026-07-27T14:48:00Z" }),
    ).toBe(2);
  });

  it("does not re-route when the head predates the routing comment", () => {
    expect(
      nextRoutingCycle({ comments, persona: "nadia", headCommittedAt: "2026-07-27T05:45:00Z" }),
    ).toBeNull();
  });

  // Catches: an off-by-one that re-routes a PR whose head is exactly the
  // commit the routing comment already reviewed.
  it("does not re-route on an equal timestamp", () => {
    expect(nextRoutingCycle({ comments, persona: "nadia", headCommittedAt: ROUTED_AT })).toBeNull();
  });

  // Catches: turning the W-4 hard cap into a retry budget — a PR at the cap
  // must escalate, never loop.
  it("refuses to route at or past the hard cycle cap", () => {
    const atCap = [routed("Nadia", 7, ROUTED_AT)];
    expect(
      nextRoutingCycle({ comments: atCap, persona: "nadia", headCommittedAt: "2026-07-28T00:00:00Z" }),
    ).toBeNull();
  });

  it("honours a lowered cap", () => {
    const atThree = [routed("Nadia", 3, ROUTED_AT)];
    expect(
      nextRoutingCycle({
        comments: atThree,
        persona: "nadia",
        headCommittedAt: "2026-07-28T00:00:00Z",
        cycleCap: 3,
      }),
    ).toBeNull();
    expect(
      nextRoutingCycle({
        comments,
        persona: "nadia",
        headCommittedAt: "2026-07-28T00:00:00Z",
        cycleCap: 3,
      }),
    ).toBe(2);
  });

  // Catches: an unreadable head commit (transient GitHub failure) spamming a
  // routing comment onto the PR on every tick.
  it("skips when the head commit date is missing or unparseable", () => {
    expect(nextRoutingCycle({ comments, persona: "nadia", headCommittedAt: null })).toBeNull();
    expect(nextRoutingCycle({ comments, persona: "nadia", headCommittedAt: "not-a-date" })).toBeNull();
  });

  // Catches: a routing comment with no created_at being treated as
  // infinitely old and re-routing forever.
  it("skips when the routing comment carries no timestamp", () => {
    const undated = [{ body: "**Nadia — cycle 1 of ≤ 7.**" }];
    expect(
      nextRoutingCycle({ comments: undated, persona: "nadia", headCommittedAt: "2026-07-28T00:00:00Z" }),
    ).toBeNull();
  });

  it("keeps alreadyRouted as the has-ever-routed predicate", () => {
    expect(alreadyRouted(comments, "nadia")).toBe(true);
    expect(alreadyRouted(comments, "maya")).toBe(false);
  });
});


// ── The candidate loop itself (cycle-2: wf:dario D1 + wf:owen O1) ────────────
// Cycle 1 found that the re-route gate was correct but its CALLER was not, and
// that no test could see the caller — the same finding that produced #507's
// cycle-2. selectCandidates is that caller, extracted; these drive it.

const NOW = Date.parse("2026-07-28T06:00:00Z");
const openPr = (over: Record<string, unknown> = {}) => ({
  number: 510,
  updated_at: "2026-07-28T05:00:00Z",
  labels: [],
  head: { sha: "abc123" },
  ...over,
});
const routedAt = (at: string) => [{ body: "**Nadia — cycle 1 of ≤ 7.**", created_at: at }];

const select = (prs: unknown[], comments = new Map(), heads = new Map()) =>
  selectCandidates({
    prs,
    commentsByPr: comments,
    headDatesByPr: heads,
    persona: "nadia",
    sinceDays: 7,
    max: 5,
    now: NOW,
  });

describe("isTerminal — escalated / paused PRs leave discovery scope", () => {
  it("matches the escalation label in either label shape", () => {
    expect(isTerminal([{ name: "autopilot:needs-human" }])).toBe(true);
    expect(isTerminal(["autopilot:needs-human"])).toBe(true);
    expect(isTerminal([{ name: "AUTOPILOT:NEEDS-HUMAN" }])).toBe(true);
  });
  it("matches the maintainer pause", () => {
    expect(isTerminal([{ name: "autopilot:off" }])).toBe(true);
  });
  it("is false for ordinary labels and for none at all", () => {
    expect(isTerminal([{ name: "area:docs" }, { name: "layer:L2" }])).toBe(false);
    expect(isTerminal([])).toBe(false);
    expect(isTerminal(undefined)).toBe(false);
  });
});

describe("headCommitDate — which timestamp means 'the author revised'", () => {
  // Catches: a "simplification" to author.date, which would silently stop
  // re-routing every rebased branch while every predicate test stayed green.
  it("prefers the committer date, because a rebase rewrites it and IS a revision", () => {
    expect(
      headCommitDate({
        commit: {
          committer: { date: "2026-07-28T05:00:00Z" },
          author: { date: "2026-07-20T01:00:00Z" },
        },
      }),
    ).toBe("2026-07-28T05:00:00Z");
  });
  it("falls back to the author date, then to null", () => {
    expect(headCommitDate({ commit: { author: { date: "2026-07-20T01:00:00Z" } } })).toBe(
      "2026-07-20T01:00:00Z",
    );
    expect(headCommitDate({})).toBeNull();
    expect(headCommitDate(undefined)).toBeNull();
  });
});

describe("selectCandidates — the discovery decision", () => {
  // THE CYCLE-1 BLOCKING FINDING (wf:dario D1). Fails without isTerminal in
  // the loop: the PR is in-window, routed, and has a newer head, so the
  // re-route gate alone would hand back cycle 2 — pulling an escalated PR out
  // of a terminal state with no human involved.
  it("does not re-route an escalated PR even when the author pushed", () => {
    const prs = [openPr({ labels: [{ name: "autopilot:needs-human" }] })];
    const comments = new Map([[510, routedAt("2026-07-27T07:35:00Z")]]);
    const heads = new Map([[510, "2026-07-28T05:00:00Z"]]);
    expect(select(prs, comments, heads)).toEqual([]);
  });

  // Catches: a push defeating the maintainer's explicit pause.
  it("does not route a paused PR at all", () => {
    const prs = [openPr({ labels: [{ name: "autopilot:off" }] })];
    expect(select(prs)).toEqual([]);
  });

  it("routes an unrouted, in-window PR at cycle 1", () => {
    const got = select([openPr()]);
    expect(got.map((c) => [c.pr.number, c.cycle])).toEqual([[510, 1]]);
  });

  // The whole point of the PR, exercised through the caller rather than the
  // predicate: #507's shape end to end.
  it("re-routes a revised, non-terminal PR at cycle 2", () => {
    const comments = new Map([[510, routedAt("2026-07-27T07:35:00Z")]]);
    const heads = new Map([[510, "2026-07-27T14:48:00Z"]]);
    expect(select([openPr()], comments, heads).map((c) => c.cycle)).toEqual([2]);
  });

  // Catches: a missing head-date entry (the fetch failed in main()) being
  // read as "revised". This is the failed-fetch path, previously guaranteed
  // only by a try/catch and a comment.
  it("skips a routed PR whose head date could not be fetched", () => {
    const comments = new Map([[510, routedAt("2026-07-27T07:35:00Z")]]);
    expect(select([openPr()], comments, new Map())).toEqual([]);
  });

  it("honours the recency window against the injected clock", () => {
    const stale = openPr({ updated_at: "2026-06-01T00:00:00Z" });
    expect(select([stale])).toEqual([]);
  });

  // Catches: the terminal/window filters running AFTER the max slice, which
  // would let skipped PRs consume candidate slots.
  it("fills --max with routable PRs, not with skipped ones", () => {
    const prs = [
      openPr({ number: 1, labels: [{ name: "autopilot:needs-human" }] }),
      openPr({ number: 2 }),
      openPr({ number: 3 }),
    ];
    const got = selectCandidates({
      prs,
      commentsByPr: new Map(),
      headDatesByPr: new Map(),
      persona: "nadia",
      sinceDays: 7,
      max: 2,
      now: NOW,
    });
    expect(got.map((c) => c.pr.number)).toEqual([2, 3]);
  });
});
