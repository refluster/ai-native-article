// @ts-nocheck — the module under test (signals.mjs) is a dependency-free
// ESM script, not TS; vitest/esbuild imports it fine at runtime. Discovered
// by workforce/lambdas/vitest.config.mjs (`include: ["../skills/**/*-tests.ts"]`).
import { describe, it, expect } from "vitest";
import {
  extractCiFollowUps,
  latestRunPerWorkflow,
  earliestCitedDate,
  parseMemoryLintBacklog,
  findStaleWatchingEntries,
  WATCHING_STALE_DAYS,
} from "./signals.mjs";

function run(overrides) {
  return {
    workflowFile: "ci.yml",
    status: "completed",
    conclusion: "success",
    htmlUrl: "https://example.test/run/1",
    createdAt: "2026-07-20T00:00:00Z",
    runNumber: 1,
    ...overrides,
  };
}

describe("extractCiFollowUps", () => {
  it("excludes success/skipped/neutral/cancelled", () => {
    const runs = [run({ conclusion: "success" }), run({ conclusion: "skipped" }), run({ conclusion: "neutral" }), run({ conclusion: "cancelled" })];
    expect(extractCiFollowUps(runs)).toHaveLength(0);
  });

  it("includes failure/timed_out/action_required", () => {
    const runs = [run({ conclusion: "failure" }), run({ conclusion: "timed_out" }), run({ conclusion: "action_required" })];
    expect(extractCiFollowUps(runs)).toHaveLength(3);
  });

  it("excludes runs that have not completed yet, regardless of conclusion", () => {
    const runs = [run({ status: "in_progress", conclusion: null })];
    expect(extractCiFollowUps(runs)).toHaveLength(0);
  });

  it("throws on non-array input", () => {
    expect(() => extractCiFollowUps(null)).toThrow();
  });
});

describe("latestRunPerWorkflow", () => {
  it("keeps only the most recent run per workflow file", () => {
    const runs = [
      run({ workflowFile: "a.yml", createdAt: "2026-07-01T00:00:00Z", conclusion: "failure" }),
      run({ workflowFile: "a.yml", createdAt: "2026-07-20T00:00:00Z", conclusion: "success" }),
      run({ workflowFile: "b.yml", createdAt: "2026-07-10T00:00:00Z", conclusion: "failure" }),
    ];
    const latest = latestRunPerWorkflow(runs);
    expect(latest).toHaveLength(2);
    const a = latest.find((r) => r.workflowFile === "a.yml");
    expect(a.conclusion).toBe("success"); // the newer of the two a.yml runs
  });
});

describe("earliestCitedDate", () => {
  it("returns null when no date is present", () => expect(earliestCitedDate("no dates here")).toBeNull());
  it("returns the sole date when one is present", () => expect(earliestCitedDate("fixed on 2026-06-10")).toBe("2026-06-10"));
  it("returns the earliest of several cited dates", () =>
    expect(earliestCitedDate("(2026-06-10/11); resolved 2026-06-22; also see 2026-05-03")).toBe("2026-05-03"));
});

const FIXTURE_BACKLOG = `# Memory -> Lint Promotion Backlog

## 3. Backlog

<!-- registry:memory-lint columns: ID | Rule | Incidents | Count | Status | Promoted via -->

| ID | Rule | Incidents | Count | Status | Promoted via |
|---|---|---|---|---|---|
| ML-001 | Some old rule that already promoted. | d17e1d5 (2026-05-03) | 1 | promoted | W-1 |
| ML-002 | A rule watched but not yet 6 months old. | (2026-07-01) | 1 | watching | — |
| ML-003 | A rule watched and clearly stale. | (2026-01-01) | 1 | watching | — |
| ML-004 | A declined rule, never a finding regardless of age. | (2026-01-01) | 1 | declined | — |
| ML-005 | A watching row with no dated incident — can't age it. | no date cited | 1 | watching | — |

## 4. Something else entirely
`;

describe("parseMemoryLintBacklog", () => {
  it("parses every ML-NNN row with its Status lowercased", () => {
    const rows = parseMemoryLintBacklog(FIXTURE_BACKLOG);
    expect(rows.map((r) => r.id)).toEqual(["ML-001", "ML-002", "ML-003", "ML-004", "ML-005"]);
    expect(rows.find((r) => r.id === "ML-001").status).toBe("promoted");
  });

  it("stops at the next section heading and does not overrun the table", () => {
    const rows = parseMemoryLintBacklog(FIXTURE_BACKLOG);
    expect(rows).toHaveLength(5);
  });
});

describe("findStaleWatchingEntries", () => {
  const today = new Date("2026-07-23T00:00:00Z");

  it("flags a watching row whose earliest cited date is >= the 180-day threshold", () => {
    const findings = findStaleWatchingEntries(FIXTURE_BACKLOG, today);
    expect(findings.map((f) => f.id)).toContain("ML-003");
    const ml3 = findings.find((f) => f.id === "ML-003");
    expect(ml3.ageDays).toBeGreaterThanOrEqual(WATCHING_STALE_DAYS);
  });

  it("does not flag a watching row younger than the threshold", () => {
    const findings = findStaleWatchingEntries(FIXTURE_BACKLOG, today);
    expect(findings.map((f) => f.id)).not.toContain("ML-002");
  });

  it("never flags a non-watching row regardless of age", () => {
    const findings = findStaleWatchingEntries(FIXTURE_BACKLOG, today);
    expect(findings.map((f) => f.id)).not.toContain("ML-001");
    expect(findings.map((f) => f.id)).not.toContain("ML-004");
  });

  it("never flags a watching row with no parseable date rather than guessing an age", () => {
    const findings = findStaleWatchingEntries(FIXTURE_BACKLOG, today);
    expect(findings.map((f) => f.id)).not.toContain("ML-005");
  });

  it("matches the real repo file's current state: zero stale entries as of this PR (oldest watching row is ~2mo old)", () => {
    // Guards against the threshold silently drifting out of sync with the
    // doc's own stated rule (docs/memory-lint-backlog.md §1: >= 6 months).
    expect(WATCHING_STALE_DAYS).toBe(180);
  });
});
