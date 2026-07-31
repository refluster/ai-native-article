// Unit tests for shared/performance.ts — the pure partition + roll-up logic
// the Epic-016 Phase-2 reducer and the agents-api endpoint share. No DDB:
// every function here is pure, so they run in isolation.

import { describe, expect, it } from "vitest";
import {
  IDLE_WINDOW_DAYS,
  appendDailyPoint,
  classifyAgentState,
  classifyIdleAgent,
  composeSeries,
  deliveredShare,
  detectIdleAgents,
  idleWindowStart,
  tallyLifecycle,
  type AgentIdleSignal,
  type LifecyclePoint,
} from "./performance.js";

describe("classifyAgentState — furthest state wins", () => {
  it("delivered dominates assigned and registered", () => {
    expect(classifyAgentState({ hasDelivered: true, hasTriggerableBinding: true })).toBe("delivered");
    expect(classifyAgentState({ hasDelivered: true, hasTriggerableBinding: false })).toBe("delivered");
  });
  it("assigned when bound but undelivered", () => {
    expect(classifyAgentState({ hasDelivered: false, hasTriggerableBinding: true })).toBe("assigned");
  });
  it("registered when hired but neither bound nor delivered", () => {
    expect(classifyAgentState({ hasDelivered: false, hasTriggerableBinding: false })).toBe("registered");
  });
});

describe("tallyLifecycle — mutually-exclusive head-count partition (Q1)", () => {
  it("counts one persona per band and sums to the cohort", () => {
    const point = tallyLifecycle("2026-06-22", [
      "registered",
      "assigned",
      "assigned",
      "delivered",
      "delivered",
      "delivered",
    ]);
    expect(point).toEqual({ date: "2026-06-22", registered: 1, assigned: 2, delivered: 3 });
    expect(point.registered + point.assigned + point.delivered).toBe(6);
  });
  it("an empty cohort is all-zero, not absent", () => {
    expect(tallyLifecycle("2026-06-22", [])).toEqual({
      date: "2026-06-22",
      registered: 0,
      assigned: 0,
      delivered: 0,
    });
  });
});

describe("appendDailyPoint — idempotent trailing window", () => {
  const mk = (date: string, delivered: number): LifecyclePoint => ({
    date,
    registered: 0,
    assigned: 0,
    delivered,
  });

  it("appends today and keeps oldest→newest order", () => {
    const out = appendDailyPoint([mk("2026-06-20", 1), mk("2026-06-21", 2)], mk("2026-06-22", 3));
    expect(out.map((p) => p.date)).toEqual(["2026-06-20", "2026-06-21", "2026-06-22"]);
  });

  it("re-running the same day replaces, never duplicates (idempotent)", () => {
    const out = appendDailyPoint([mk("2026-06-22", 3)], mk("2026-06-22", 9));
    expect(out).toHaveLength(1);
    expect(out[0]!.delivered).toBe(9);
  });

  it("trims to the window from the oldest end", () => {
    const seed = Array.from({ length: 28 }, (_, i) =>
      mk(`2026-05-${String(i + 1).padStart(2, "0")}`, i),
    );
    const out = appendDailyPoint(seed, mk("2026-06-30", 99), 28);
    expect(out).toHaveLength(28);
    expect(out[out.length - 1]!.date).toBe("2026-06-30");
    expect(out[0]!.date).toBe("2026-05-02"); // 2026-05-01 dropped
  });
});

describe("deliveredShare", () => {
  it("is delivered / total", () => {
    expect(deliveredShare({ date: "x", registered: 2, assigned: 3, delivered: 5 })).toBe(0.5);
  });
  it("is 0 for an empty cohort (no NaN)", () => {
    expect(deliveredShare({ date: "x", registered: 0, assigned: 0, delivered: 0 })).toBe(0);
  });
});

describe("composeSeries — endpoint assembly", () => {
  const points: LifecyclePoint[] = [
    { date: "2026-06-21", registered: 4, assigned: 6, delivered: 14 },
    { date: "2026-06-22", registered: 4, assigned: 6, delivered: 16 },
  ];

  it("serves live lifecycle with an empty PR block when PR is unpublished", () => {
    const s = composeSeries("workforce", "2026-06-22T02:00:00Z", { points });
    expect(s.scope).toBe("workforce");
    expect(s.lifecycle).toBe(points);
    expect(s.window).toEqual({ start: "2026-06-21", end: "2026-06-22" });
    expect(s.pr_daily).toEqual([]);
    expect(s.pr_summary.total_prs).toBe(0);
    expect(s.pr_contributors).toEqual([]);
  });

  it("overlays the published PR sections and prefers the PR window", () => {
    const s = composeSeries("workforce", "2026-06-22T02:00:00Z", { points }, {
      window: { start: "2026-05-26", end: "2026-06-22" },
      pr_daily: [{ date: "2026-06-22", prs: 4, autopilot_merged: 3, additions: 120, deletions: 30 }],
      pr_summary: {
        total_prs: 4,
        autopilot_merged: 3,
        autopilot_share: 0.75,
        total_additions: 120,
        total_deletions: 30,
        humans_involved: ["refluster"],
      },
      pr_contributors: [{ handle: "nadia", kind: "agent", prs: 3 }],
    });
    expect(s.window).toEqual({ start: "2026-05-26", end: "2026-06-22" });
    expect(s.pr_summary.autopilot_share).toBe(0.75);
    expect(s.lifecycle[s.lifecycle.length - 1]!.delivered).toBe(16);
  });
});

// ── Epic-021 §B.1 — idle-talent detector ─────────────────────────────────────
//
// What bug would these catch? The evasion the RFC was written against: a
// persona kept off the idle list by paperwork (a binding) or by commons
// output (the daily reflection every persona runs), while producing no
// specialised work at all. Each case below is one way that could slip through.

const COMMONS = new Set(["feed-post", "daily-research"]);

function signal(over: Partial<AgentIdleSignal> & { slug: string }): AgentIdleSignal {
  return {
    windowExecSkills: [],
    nonCommonsBoundSkills: [],
    nonCommonsLiveSkills: [],
    ...over,
  };
}

describe("classifyIdleAgent", () => {
  it("does not flag a persona with one non-commons deliverable in the window", () => {
    const r = classifyIdleAgent(
      signal({ slug: "ren", windowExecSkills: ["feed-post", "issue-implement"] }),
      COMMONS,
    );
    expect(r).toBeNull();
  });

  // The commons evasion: a full ledger of daily reflection + daily research is
  // not specialised work, and a binding-keyed or row-count-keyed detector
  // would clear this persona.
  it("flags a persona whose entire window is commons output", () => {
    const r = classifyIdleAgent(
      signal({
        slug: "corinne",
        windowExecSkills: ["feed-post", "daily-research", "feed-post", "daily-research"],
      }),
      COMMONS,
    );
    expect(r).toEqual({ slug: "corinne", pending: "design", bound_skills: [] });
  });

  // The paperwork evasion (the day-29 token binding): a designed duty exists
  // on paper but nothing fires it. That is the operator's gate, not the
  // persona's failure — "bound, pending enable".
  it("attributes a bound-but-unscheduled duty to the enable gate, not the persona", () => {
    const r = classifyIdleAgent(
      signal({
        slug: "yara",
        windowExecSkills: ["feed-post"],
        nonCommonsBoundSkills: ["template-maintenance"],
        nonCommonsLiveSkills: [],
      }),
      COMMONS,
    );
    expect(r?.pending).toBe("enable");
    expect(r?.bound_skills).toEqual(["template-maintenance"]);
  });

  it("charges a live-but-silent duty to the persona", () => {
    const r = classifyIdleAgent(
      signal({
        slug: "silas",
        windowExecSkills: ["daily-research"],
        nonCommonsBoundSkills: ["budget-review"],
        nonCommonsLiveSkills: ["budget-review"],
      }),
      COMMONS,
    );
    expect(r?.pending).toBe("output");
  });

  // A commons binding must not read as a designed duty — otherwise every
  // persona in the org would answer "enable"/"output" and "design" could
  // never fire, which is the one attribution the epic most cares about.
  it("never lets a commons binding count as a designed duty", () => {
    const r = classifyIdleAgent(
      signal({ slug: "marisol", windowExecSkills: ["feed-post"] }),
      COMMONS,
    );
    expect(r?.pending).toBe("design");
  });

  it("reads an empty commons set as: every execution is specialised work", () => {
    const r = classifyIdleAgent(
      signal({ slug: "kai", windowExecSkills: ["feed-post"] }),
      new Set<string>(),
    );
    expect(r).toBeNull();
  });
});

describe("detectIdleAgents", () => {
  it("returns only idle personas, ordered by slug for a diffable digest", () => {
    const out = detectIdleAgents(
      [
        signal({ slug: "zoe", windowExecSkills: ["feed-post"] }),
        signal({ slug: "ren", windowExecSkills: ["issue-implement"] }),
        signal({ slug: "corinne", windowExecSkills: [] }),
      ],
      COMMONS,
    );
    expect(out.map((r) => r.slug)).toEqual(["corinne", "zoe"]);
  });

  it("is empty for a cohort that all delivered", () => {
    expect(
      detectIdleAgents([signal({ slug: "ren", windowExecSkills: ["pr-autopilot"] })], COMMONS),
    ).toEqual([]);
  });
});

describe("idleWindowStart", () => {
  it("is exactly IDLE_WINDOW_DAYS before now", () => {
    const now = new Date("2026-07-31T05:00:00.000Z");
    expect(idleWindowStart(now)).toBe("2026-07-01T05:00:00.000Z");
    expect(IDLE_WINDOW_DAYS).toBe(30);
  });
});
