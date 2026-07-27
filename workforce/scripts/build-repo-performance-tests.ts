// @ts-nocheck — the script under test is dependency-free ESM, not TS.
// Tests the pure aggregation of the repo-performance builder (no network/AWS).
import { describe, it, expect } from "vitest";
import {
  bucketByDate,
  buildDailyActivity,
  buildWeeklyChurn,
  fetchCodeFrequency,
  searchAll,
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

// Failure-path coverage (`wf:hana` H3, 2026-07-24). These paths now carry real
// semantics: since the refresh runs unattended daily, a swallowed rate-limit
// error would write an undercount that is indistinguishable from a genuine
// low-activity day. `partial` is the flag that keeps that visible.
describe("searchAll (failure path)", () => {
  it("returns partial:false and all items on a clean single page", async () => {
    const gh = async () => ({ status: 200, json: { items: [{ id: 1 }, { id: 2 }] } });
    expect(await searchAll(gh, "q")).toEqual({ items: [{ id: 1 }, { id: 2 }], partial: false });
  });

  it("flags partial:true and keeps the pages it did get when a page fails", async () => {
    let call = 0;
    const gh = async () => {
      call += 1;
      // page 1 full (forces a second page), page 2 rate-limited
      if (call === 1) return { status: 200, json: { items: Array.from({ length: 100 }, (_, i) => ({ id: i })) } };
      return { status: 403, json: { message: "rate limit" } };
    };
    const r = await searchAll(gh, "q");
    expect(r.partial).toBe(true);
    expect(r.items).toHaveLength(100);
  });

  it("flags partial:true with zero items when the very first page fails", async () => {
    const gh = async () => ({ status: 403, json: { message: "rate limit" } });
    expect(await searchAll(gh, "q")).toEqual({ items: [], partial: true });
  });
});

describe("fetchCodeFrequency (failure path)", () => {
  it("returns the weeks with partial:false on success", async () => {
    const gh = async () => ({ status: 200, json: [[1000, 5, -2]] });
    expect(await fetchCodeFrequency(gh, "o/r")).toEqual({ weeks: [[1000, 5, -2]], partial: false });
  });

  it("flags partial:true on an HTTP error instead of an empty-looking zero", async () => {
    const gh = async () => ({ status: 404, json: {} });
    expect(await fetchCodeFrequency(gh, "o/r")).toEqual({ weeks: [], partial: true });
  });
});

// Production regression 2026-07-26: the first published PERF#{scope}/REPO rows
// carried 0 churn with NO degraded flag, while the same repos returned 13
// populated weeks minutes later. GitHub serves 200-with-empty-array while its
// stats cache is cold, which is indistinguishable from a churn-free repo — so
// it must read as "unknown", not "zero". This is the same false-zero class as
// H2, through a case the original fix did not cover.
describe("fetchCodeFrequency (200-but-empty is degraded, not a real zero)", () => {
  // delayMs:0 keeps these off the real 2.5s backoff — `200 []` now consumes the
  // retry budget (H2b), so the defaults would cost 15s per case.
  const fast = { attempts: 3, delayMs: 0 };

  it("flags partial:true when GitHub returns 200 with an empty array", async () => {
    const gh = async () => ({ status: 200, json: [] });
    expect(await fetchCodeFrequency(gh, "o/r", fast)).toEqual({ weeks: [], partial: true });
  });

  it("still reports partial:false when 200 carries real weeks", async () => {
    const gh = async () => ({ status: 200, json: [[1000, 5, -2]] });
    expect(await fetchCodeFrequency(gh, "o/r", fast)).toEqual({ weeks: [[1000, 5, -2]], partial: false });
  });
});

// `wf:hana` H2b + `wf:owen` O2/O3 (cycle 1 on #503, carried out of the verdict as
// follow-up work). `202` and `200 []` are two symptoms of one cold stats cache,
// so they now share a retry budget. These cases drive the loop across a status
// TRANSITION — the sequence the #503 reproduction actually described — which the
// constant-status stubs above cannot reach.
describe("fetchCodeFrequency (shared retry budget across a status transition)", () => {
  /** Stub `gh` that walks a scripted sequence of responses, one per attempt. */
  const scripted = (responses: unknown[]) => {
    let i = 0;
    return async () => responses[Math.min(i++, responses.length - 1)];
  };

  it("recovers the real weeks when a cold 202 warms to a populated 200", async () => {
    const gh = scripted([
      { status: 202, json: null },
      { status: 202, json: null },
      { status: 200, json: [[1000, 5, -2]] },
    ]);
    expect(await fetchCodeFrequency(gh, "o/r", { attempts: 6, delayMs: 0 })).toEqual({
      weeks: [[1000, 5, -2]],
      partial: false,
    });
  });

  it("recovers the real weeks when an empty 200 warms to a populated 200", async () => {
    // The H2b case: before the shared budget this exited degraded on attempt 1
    // and threw away a number the very next call would have returned.
    const gh = scripted([
      { status: 200, json: [] },
      { status: 200, json: [[2000, 9, -3]] },
    ]);
    expect(await fetchCodeFrequency(gh, "o/r", { attempts: 6, delayMs: 0 })).toEqual({
      weeks: [[2000, 9, -3]],
      partial: false,
    });
  });

  it("gives up degraded when 202 never warms past an empty 200", async () => {
    const gh = scripted([{ status: 202, json: null }, { status: 200, json: [] }]);
    expect(await fetchCodeFrequency(gh, "o/r", { attempts: 4, delayMs: 0 })).toEqual({
      weeks: [],
      partial: true,
    });
  });

  it("stops retrying immediately on a hard HTTP error, mid-transition", async () => {
    // A 404 is not a cold cache — it must not burn the budget waiting to warm.
    let calls = 0;
    const gh = async () => {
      calls += 1;
      return calls === 1 ? { status: 202, json: null } : { status: 404, json: {} };
    };
    expect(await fetchCodeFrequency(gh, "o/r", { attempts: 6, delayMs: 0 })).toEqual({ weeks: [], partial: true });
    expect(calls).toBe(2);
  });

  // O3: this is a deliberate product decision, not an oversight. A repo with no
  // commits in the window is indistinguishable from a cold cache, so it reports
  // degraded forever rather than asserting a zero we cannot substantiate. Stated
  // here so the next reader does not "fix" it back into a false zero.
  it("reports a genuinely churn-free repo as degraded, by design", async () => {
    const gh = async () => ({ status: 200, json: [] });
    expect(await fetchCodeFrequency(gh, "o/r", { attempts: 3, delayMs: 0 })).toEqual({
      weeks: [],
      partial: true,
    });
  });
});
