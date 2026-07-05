// @ts-nocheck — the script under test (pr-autopilot-sweep.mjs) is a
// dependency-free ESM script, not TS; vitest/esbuild imports it fine at
// runtime, and this suite is not shipped code. Discovered by
// workforce/lambdas/vitest.config.mjs (`include: ["../skills/**/*-tests.ts"]`),
// so `cd workforce/lambdas && npm test` runs it.
//
// Locks the TWO-OUTCOME contract mechanically: every open PR in autopilot scope
// is either in an active cycle, or terminal (merged / labelled
// autopilot:needs-human). classifySweep is the pure decision — it must catch
// all three "neither" classes (ML-009 label drops, stalled cycles, PRs that
// aged out of the discovery window) and must never flag paused (autopilot:off)
// or already-escalated PRs.
import { describe, it, expect } from "vitest";
import {
  classifySweep,
  sweepHandoffBody,
  DEFAULT_STALE_HOURS,
  DEFAULT_WINDOW_DAYS,
} from "./pr-autopilot-sweep.mjs";
import { NEEDS_HUMAN_MARKER } from "./pr-autopilot-post.mjs";
import { ESCALATION_LABEL } from "./pr-merge.mjs";

const NOW = Date.parse("2026-07-01T12:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3600_000).toISOString();
const daysAgo = (d) => hoursAgo(d * 24);
const ROUTING_COMMENT = "**Nadia — cycle 1 of ≤ 3.**\n\nReviewers nominated (≥ 3): …";
const opts = { now: NOW };

describe("classifySweep — terminal / paused PRs are never violations", () => {
  it("already-escalated PR (label present) is terminal", () => {
    expect(
      classifySweep(
        { createdAt: daysAgo(30), updatedAt: daysAgo(30), labels: [ESCALATION_LABEL], bodies: [ROUTING_COMMENT] },
        opts,
      ),
    ).toBeNull();
  });

  it("autopilot:off pauses the sweep for that PR, however stale", () => {
    expect(
      classifySweep(
        { createdAt: daysAgo(90), updatedAt: daysAgo(90), labels: ["Autopilot:OFF"], bodies: [] },
        opts,
      ),
    ).toBeNull();
  });

  it("label matching is case-insensitive (GitHub labels preserve case)", () => {
    expect(
      classifySweep(
        { createdAt: daysAgo(30), updatedAt: daysAgo(30), labels: ["Autopilot:Needs-Human"], bodies: [ROUTING_COMMENT] },
        opts,
      ),
    ).toBeNull();
  });
});

describe("classifySweep — unlabelled-handoff (ML-009)", () => {
  it("a hand-off marker with no label is a violation regardless of age", () => {
    expect(
      classifySweep(
        { createdAt: hoursAgo(1), updatedAt: hoursAgo(1), labels: [], bodies: [`verdict…\n${NEEDS_HUMAN_MARKER}`] },
        opts,
      ),
    ).toBe("unlabelled-handoff");
  });

  it("marker in a review body (not just an issue comment) also counts", () => {
    expect(
      classifySweep(
        { createdAt: hoursAgo(2), updatedAt: hoursAgo(2), labels: [], bodies: ["", `escalating — ${NEEDS_HUMAN_MARKER}`] },
        opts,
      ),
    ).toBe("unlabelled-handoff");
  });
});

describe("classifySweep — stale-routed (a cycle that never terminated)", () => {
  it("routed + untouched past the stale threshold escalates", () => {
    expect(
      classifySweep(
        { createdAt: daysAgo(5), updatedAt: hoursAgo(DEFAULT_STALE_HOURS + 1), labels: [], bodies: [ROUTING_COMMENT] },
        opts,
      ),
    ).toBe("stale-routed");
  });

  it("routed but recently updated stays in-cycle (author may still revise)", () => {
    expect(
      classifySweep(
        { createdAt: daysAgo(5), updatedAt: hoursAgo(DEFAULT_STALE_HOURS - 1), labels: [], bodies: [ROUTING_COMMENT] },
        opts,
      ),
    ).toBeNull();
  });

  it("honours a custom --stale-hours", () => {
    const pr = { createdAt: daysAgo(2), updatedAt: hoursAgo(13), labels: [], bodies: [ROUTING_COMMENT] };
    expect(classifySweep(pr, { now: NOW, staleHours: 12 })).toBe("stale-routed");
    expect(classifySweep(pr, { now: NOW, staleHours: 24 })).toBeNull();
  });
});

describe("classifySweep — never-routed (aged out of the discovery window)", () => {
  it("unrouted + older than the window escalates (the scan will never see it)", () => {
    expect(
      classifySweep(
        { createdAt: daysAgo(20), updatedAt: daysAgo(DEFAULT_WINDOW_DAYS + 1), labels: [], bodies: ["just chatter"] },
        opts,
      ),
    ).toBe("never-routed");
  });

  it("unrouted but still inside the window is left to the cadence", () => {
    expect(
      classifySweep(
        { createdAt: daysAgo(20), updatedAt: daysAgo(DEFAULT_WINDOW_DAYS - 1), labels: [], bodies: [] },
        opts,
      ),
    ).toBeNull();
  });

  it("a fresh PR with no comments is not a violation", () => {
    expect(classifySweep({ createdAt: hoursAgo(1), updatedAt: hoursAgo(1), labels: [], bodies: [] }, opts)).toBeNull();
  });

  it("unparseable timestamps are left alone (fail-safe for the write path)", () => {
    expect(classifySweep({ createdAt: "n/a", updatedAt: "n/a", labels: [], bodies: [] }, opts)).toBeNull();
  });
});

describe("sweepHandoffBody — the escalation comment is a real hand-off", () => {
  it("carries the hidden needs-human marker (so ML-009 tooling recognises it)", () => {
    for (const kind of ["stale-routed", "never-routed"]) {
      const body = sweepHandoffBody(kind, { staleHours: 48, windowDays: 7 });
      expect(body).toContain(NEEDS_HUMAN_MARKER);
      expect(body.trim().length).toBeGreaterThan(50);
    }
  });

  it("names the reason class in prose", () => {
    expect(sweepHandoffBody("stale-routed", { staleHours: 48, windowDays: 7 })).toContain("48h");
    expect(sweepHandoffBody("never-routed", { staleHours: 48, windowDays: 7 })).toContain("7-day");
  });
});
