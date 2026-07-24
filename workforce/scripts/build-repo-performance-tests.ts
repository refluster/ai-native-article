// @ts-nocheck — the script under test is dependency-free ESM, not TS.
// Tests the pure aggregation of the repo-performance builder (no network/AWS).
import { describe, it, expect } from "vitest";
import {
  bucketByDate,
  buildDailyActivity,
  buildWeeklyChurn,
  sumDailyActivity,
  sumWeeklyChurn,
} from "./build-repo-performance.mjs";

describe("bucketByDate", () => {
  it("buckets items by the UTC day of the given date field", () => {
    const m = bucketByDate(
      [{ created_at: "2026-07-01T10:00:00Z" }, { created_at: "2026-07-01T22:00:00Z" }, { created_at: "2026-07-02T01:00:00Z" }],
      "created_at",
    );
    expect(m.get("2026-07-01")).toBe(2);
    expect(m.get("2026-07-02")).toBe(1);
  });
  it("skips items missing the field", () => {
    const m = bucketByDate([{ created_at: null }, {}], "created_at");
    expect(m.size).toBe(0);
  });
});

describe("buildDailyActivity", () => {
  it("builds a {date, opened, closed} series over the trailing window", () => {
    const opened = [{ created_at: "2026-07-03T00:00:00Z" }, { created_at: "2026-07-03T05:00:00Z" }];
    const closed = [{ closed_at: "2026-07-04T00:00:00Z" }];
    const series = buildDailyActivity(opened, closed, 3, "2026-07-04");
    expect(series.map((p) => p.date)).toEqual(["2026-07-02", "2026-07-03", "2026-07-04"]);
    expect(series[1]).toEqual({ date: "2026-07-03", opened: 2, closed: 0 });
    expect(series[2]).toEqual({ date: "2026-07-04", opened: 0, closed: 1 });
  });
  it("zero-fills days with no activity", () => {
    const series = buildDailyActivity([], [], 2, "2026-07-04");
    expect(series).toEqual([
      { date: "2026-07-03", opened: 0, closed: 0 },
      { date: "2026-07-04", opened: 0, closed: 0 },
    ]);
  });
});

describe("buildWeeklyChurn", () => {
  it("filters to the window and reports deletions as a positive magnitude", () => {
    const since = Math.floor(new Date("2026-06-01T00:00:00Z").getTime() / 1000);
    const inWindow = Math.floor(new Date("2026-06-15T00:00:00Z").getTime() / 1000);
    const outWindow = Math.floor(new Date("2026-01-01T00:00:00Z").getTime() / 1000);
    const out = buildWeeklyChurn(
      [
        [outWindow, 999, -999],
        [inWindow, 30, -12],
      ],
      since,
    );
    expect(out).toEqual([{ week_start: "2026-06-15", additions: 30, deletions: 12 }]);
  });
  it("sorts by week_start ascending", () => {
    const since = 0;
    const out = buildWeeklyChurn(
      [
        [2000, 1, -1],
        [1000, 2, -2],
      ],
      since,
    );
    expect(out.map((w) => w.week_start)).toEqual([
      new Date(1000 * 1000).toISOString().slice(0, 10),
      new Date(2000 * 1000).toISOString().slice(0, 10),
    ]);
  });
});

describe("sumDailyActivity", () => {
  it("sums opened/closed across projects sharing a date axis", () => {
    const a = [{ date: "2026-07-01", opened: 2, closed: 1 }];
    const b = [{ date: "2026-07-01", opened: 3, closed: 0 }];
    expect(sumDailyActivity([a, b])).toEqual([{ date: "2026-07-01", opened: 5, closed: 1 }]);
  });
  it("returns empty for no input", () => {
    expect(sumDailyActivity([])).toEqual([]);
  });
});

describe("sumWeeklyChurn", () => {
  it("merges by week_start across projects, tolerating gaps", () => {
    const a = [{ week_start: "2026-06-15", additions: 10, deletions: 2 }];
    const b = [
      { week_start: "2026-06-15", additions: 5, deletions: 1 },
      { week_start: "2026-06-22", additions: 7, deletions: 3 },
    ];
    expect(sumWeeklyChurn([a, b])).toEqual([
      { week_start: "2026-06-15", additions: 15, deletions: 3 },
      { week_start: "2026-06-22", additions: 7, deletions: 3 },
    ]);
  });
});
