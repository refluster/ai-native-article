// @ts-nocheck — the modules under test are dependency-free ESM scripts, not TS.
// Discovered by workforce/lambdas/vitest.config.mjs (`../skills/**/*-tests.ts`).
//
// The I/O edge of the write surface (owen, #808 cycle 1): the pure decisions
// in issue-stages.mjs are covered by issue-stages-tests.ts; these cover the two
// readers whose failure modes would silently widen the lifecycle's bounds —
// the per-run close budget (rule 6) and the open-PR claim map (rule 4).
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUDGET_WINDOW_HOURS, readCloseBudget } from "./issue-stage-set.mjs";
import { collectOpenPrRefs } from "./issue-stage-scan.mjs";

const NOW = Date.parse("2026-10-05T12:00:00Z");
const H = 3600_000;
const dirs = [];
function budgetFile(content) {
  const dir = mkdtempSync(join(tmpdir(), "issue-stage-budget-"));
  dirs.push(dir);
  const file = join(dir, "closes.json");
  if (content !== undefined) writeFileSync(file, content);
  return file;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("readCloseBudget — the per-run close bound (rule 6)", () => {
  it("counts rows inside the window and drops expired ones", () => {
    const file = budgetFile(
      JSON.stringify([
        { issue: 1, reason: "completed", at: new Date(NOW - 1 * H).toISOString() },
        { issue: 2, reason: "duplicate", at: new Date(NOW - (BUDGET_WINDOW_HOURS + 1) * H).toISOString() },
        { issue: 3, reason: "not_planned", at: new Date(NOW - (BUDGET_WINDOW_HOURS - 1) * H).toISOString() },
      ]),
    );
    expect(readCloseBudget(file, { now: NOW }).map((r) => r.issue)).toEqual([1, 3]);
  });

  it("a row with a missing or unparseable `at` counts against the budget (never silently dropped)", () => {
    const file = budgetFile(JSON.stringify([{ issue: 4, reason: "completed" }, { issue: 5, reason: "completed", at: "yesterday-ish" }]));
    expect(readCloseBudget(file, { now: NOW }).map((r) => r.issue)).toEqual([4, 5]);
  });

  it("an absent file is an empty budget", () => {
    expect(readCloseBudget(budgetFile(undefined), { now: NOW })).toEqual([]);
  });

  it("corrupt JSON or a non-array throws instead of reading as zero closes (C-4)", () => {
    expect(() => readCloseBudget(budgetFile("{not json"), { now: NOW })).toThrow(/not valid JSON/);
    expect(() => readCloseBudget(budgetFile('{"issue":1}'), { now: NOW })).toThrow(/JSON array/);
  });
});

describe("collectOpenPrRefs — a claim is an open PR (rule 4)", () => {
  function stubGh(pages) {
    const calls = [];
    const gh = async (method, path) => {
      calls.push(`${method} ${path}`);
      const page = Number(new URL(`https://x${path}`).searchParams.get("page"));
      return { status: 200, json: pages[page - 1] ?? [] };
    };
    return { gh, calls };
  }

  it("maps every referenced issue to the PRs that claim it, across closing keywords, Refs and branch names", async () => {
    const { gh, calls } = stubGh([
      [
        { number: 10, body: "Closes #5\n\nalso Refs #6", head: { ref: "ren/feature" } },
        { number: 11, body: "nothing here", head: { ref: "dario/issue-7-design-note" } },
        { number: 12, body: "see other/repo#5 — not ours", head: { ref: "x" } },
      ],
    ]);
    const refs = await collectOpenPrRefs(gh, "o/r");
    expect(refs.get(5)).toEqual([10]);
    expect(refs.get(6)).toEqual([10]);
    expect(refs.get(7)).toEqual([11]);
    expect(refs.has(12)).toBe(false);
    expect(calls).toEqual(["GET /repos/o/r/pulls?state=open&per_page=100&page=1"]);
  });

  it("paginates while a page is full and stops on the first short page", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ number: 1000 + i, body: `Fixes #${i}`, head: { ref: "b" } }));
    const { gh, calls } = stubGh([full, [{ number: 2000, body: "Resolves #500", head: { ref: "b" } }]]);
    const refs = await collectOpenPrRefs(gh, "o/r");
    expect(calls).toHaveLength(2);
    expect(refs.get(500)).toEqual([2000]);
    expect(refs.get(0)).toEqual([1000]);
  });

  it("throws on a failed read rather than releasing issues a live PR still holds", async () => {
    const gh = async () => ({ status: 502, json: null });
    await expect(collectOpenPrRefs(gh, "o/r")).rejects.toThrow(/HTTP 502/);
  });
});
