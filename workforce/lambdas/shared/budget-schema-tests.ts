// Unit tests for the W-3 ledger schema (#661) — the month key both the writer
// and the reader derive, and the roll-up `GET /performance` serves.
import { describe, expect, it } from "vitest";
import { budgetMonthKey, summariseBudgetRows, type BudgetRow } from "./budget-schema.js";

const row = (over: Partial<BudgetRow> = {}): Partial<BudgetRow> => ({
  estimated_cost_usd: 0.05,
  estimated_fires: 1,
  cost_usd: 0,
  ...over,
});

describe("budgetMonthKey", () => {
  it("is UTC and zero-padded", () => {
    expect(budgetMonthKey(new Date("2026-09-07T17:29:57Z"))).toBe("2026-09");
    expect(budgetMonthKey(new Date("2026-01-31T23:59:59Z"))).toBe("2026-01");
  });

  it("rolls to the new month at UTC midnight, not local", () => {
    expect(budgetMonthKey(new Date("2026-10-01T00:00:01Z"))).toBe("2026-10");
    expect(budgetMonthKey(new Date("2026-09-30T23:59:59Z"))).toBe("2026-09");
  });
});

describe("summariseBudgetRows", () => {
  it("returns undefined for an empty month — absent, never a zero-filled block", () => {
    // A fresh month and a writer that stopped charging look identical from the
    // client; a rendered $0.00 would claim the first and hide the second.
    expect(summariseBudgetRows([], "2026-09", 600)).toBeUndefined();
  });

  it("reproduces the first real tick: 9 fires, $1.00, nothing measured", () => {
    // 2026-09-07T17:29:57Z — 7 daily-research (small) + article-level3 (large)
    // + podcast-publish (small).
    const rows = [
      ...Array.from({ length: 7 }, () => row()),
      row({ estimated_cost_usd: 0.6 }),
      row(),
    ];
    const s = summariseBudgetRows(rows, "2026-09", 600)!;
    expect(s.modelled_usd).toBe(1.0);
    expect(s.measured_usd).toBe(0);
    expect(s.fires).toBe(9);
    expect(s.agents_charged).toBe(9);
    expect(s.ceiling_usd).toBe(600);
    expect(s.month).toBe("2026-09");
  });

  it("keeps measured and modelled apart and never emits a combined total", () => {
    const s = summariseBudgetRows(
      [row({ estimated_cost_usd: 2, cost_usd: 3 })],
      "2026-09",
      600,
    )!;
    expect(s.modelled_usd).toBe(2);
    expect(s.measured_usd).toBe(3);
    expect(s).not.toHaveProperty("total_usd");
  });

  it("rounds away float drift rather than serving $1.0000000000000002", () => {
    const rows = Array.from({ length: 20 }, () => row({ estimated_cost_usd: 0.05 }));
    const s = summariseBudgetRows(rows, "2026-09", 600)!;
    expect(s.modelled_usd).toBe(1);
    expect(String(s.modelled_usd)).not.toContain("0000");
  });

  it("counts rows as agents_charged, not fires", () => {
    // One agent that fired 12 times is one agent — the grace duplicate-binding
    // shape, where fires and agents diverge sharply.
    const s = summariseBudgetRows(
      [row({ estimated_fires: 12, estimated_cost_usd: 0.6 })],
      "2026-09",
      600,
    )!;
    expect(s.agents_charged).toBe(1);
    expect(s.fires).toBe(12);
  });

  it("treats a legacy row with no modelled columns as zero, not NaN", () => {
    const s = summariseBudgetRows(
      [{ cost_usd: 4, tokens_in: 10, tokens_out: 20 }],
      "2026-09",
      600,
    )!;
    expect(s.modelled_usd).toBe(0);
    expect(s.measured_usd).toBe(4);
    expect(s.fires).toBe(0);
    expect(Number.isNaN(s.modelled_usd)).toBe(false);
  });

  it("carries the ceiling it was given rather than assuming 600", () => {
    // W-3 is raised by a Zone A amendment; the roll-up must follow the
    // constant, not a copy of today's value.
    expect(summariseBudgetRows([row()], "2026-09", 900)!.ceiling_usd).toBe(900);
  });
});
