// Epic-020 Story 2 — fixture tests for the human-touch aggregation.
//
// The acceptance criterion is "replay a known month → known table", so the
// centrepiece is exactly that: a frozen set of collector results for 2026-07
// asserted against the full expected block. The rest of the cases pin the
// invariants that make the table honest — the ones a plausible refactor would
// quietly break.
//
// Every assertion names the bug it would catch; a test that cannot fail is
// not a test.

import { describe, expect, it } from "vitest";

import { aggregateHumanTouches } from "./lib/human-touch-aggregate.mjs";
import {
  TOUCH_TYPES,
  classifyPrTouches,
  collectT5,
  countReferencedStories,
  countRoundPersonas,
  groupRoundsByCommit,
  matchStatusLine,
  monthWindow,
  parseEpicStatusFlipsFromLog,
  parseW3Amendments,
  result,
} from "./build-human-touch.mjs";

const JULY = { start: "2026-07-01T00:00:00Z", end: "2026-08-01T00:00:00Z" };
const OPTS = { month: "2026-07", window: JULY, taxonomyVersion: "v1", updatedAt: "2026-08-01T00:00:00Z" };

describe("monthWindow", () => {
  it("bounds a month end-exclusive at the next month's first day", () => {
    // Catches an inclusive end that double-counts a touch landing exactly on
    // the 1st of the following month.
    expect(monthWindow("2026-07")).toEqual(JULY);
  });

  it("rolls the year over in December", () => {
    // Catches a naive month+1 that produces "2026-13".
    expect(monthWindow("2026-12").end).toBe("2027-01-01T00:00:00Z");
  });

  it("rejects a malformed month", () => {
    // Catches a silent pass-through that would window on garbage.
    expect(() => monthWindow("2026-7")).toThrow(/YYYY-MM/);
    expect(() => monthWindow("2026-00")).toThrow(/YYYY-MM/);
  });
});

describe("the taxonomy mirror", () => {
  it("carries all seven types with T3 the only estimated one", () => {
    // Catches a type silently dropped from the mirror, and a re-designation
    // that would move a type in or out of the falsifier denominator.
    expect(TOUCH_TYPES.map((t) => t.type)).toEqual(["T1", "T2", "T3", "T4", "T5", "T6", "T7"]);
    expect(TOUCH_TYPES.filter((t) => t.designation === "estimated").map((t) => t.type)).toEqual(["T3"]);
  });

  it("classes each type exactly as the taxonomy table does", () => {
    // Catches a re-class that would move a digest touch into the gate table
    // and inflate gate leverage — the exact failure the class split exists
    // to prevent.
    const byId = Object.fromEntries(TOUCH_TYPES.map((t) => [t.type, t.class]));
    expect(byId).toEqual({
      T1: "gate", T2: "gate", T3: "gate", T4: "digest", T5: "one-time", T6: "gate", T7: "one-time",
    });
  });
});

describe("result()", () => {
  it("nulls work_units whenever touches is null", () => {
    // Catches an unavailable type that still reports work units — a row that
    // claims leverage from a source it never read.
    const r = result("T4", { touches: null, workUnits: 99, unavailableReason: "no table" });
    expect(r.touches).toBeNull();
    expect(r.work_units).toBeNull();
    expect(r.unavailable_reason).toBe("no table");
  });

  it("omits unavailable_reason on a readable type", () => {
    // Catches a stray reason string that would make a real count look degraded.
    expect(result("T5", { touches: 2, workUnits: 100 })).not.toHaveProperty("unavailable_reason");
  });
});

describe("aggregateHumanTouches — the known-month replay", () => {
  // A frozen July: two escalated PRs (T1/T2), the digest week, one cap raise,
  // one epic accepted, one hire round, T3 estimated, T4 readable.
  const results = [
    result("T1", { touches: 2, workUnits: 11 }),
    result("T2", { touches: 2, workUnits: 2 }),
    result("T3", { touches: null, unavailableReason: "estimated: no event row" }),
    result("T4", { touches: 4, workUnits: 96 }),
    result("T5", { touches: 1, workUnits: 205 }),
    result("T6", { touches: 1, workUnits: 3 }),
    result("T7", { touches: 1, workUnits: 4 }),
  ];

  it("produces the known table", () => {
    const block = aggregateHumanTouches(results, OPTS);

    expect(block.month).toBe("2026-07");
    expect(block.taxonomy_version).toBe("v1");
    expect(block.definition).toBe("leverage-not-price");

    const gate = block.classes.find((c) => c.class === "gate")!;
    // T1+T2+T6 are readable and all… no: T1 credits changed-files, T2 credits
    // PRs, T6 credits stories. Three units ⇒ no class sum is honest.
    expect(gate.touches).toBe(5);
    expect(gate.units).toEqual(["changed-file", "pr", "referenced-story"]);
    expect(gate.work_units).toBeNull();
    expect(gate.leverage).toBeNull();
    expect(gate.unavailable).toEqual(["T3"]);

    const digest = block.classes.find((c) => c.class === "digest")!;
    // Single unit ⇒ summable. 96 mutations over 4 weekly reviews = 24.
    expect(digest.touches).toBe(4);
    expect(digest.work_units).toBe(96);
    expect(digest.leverage).toBe(24);
    expect(digest.unavailable).toEqual([]);

    const oneTime = block.classes.find((c) => c.class === "one-time")!;
    // T5 (usd-headroom) + T7 (persona) — two units, so no blended sum.
    expect(oneTime.touches).toBe(2);
    expect(oneTime.units).toEqual(["persona", "usd-headroom"]);
    expect(oneTime.work_units).toBeNull();
    expect(oneTime.leverage).toBeNull();
  });

  it("excludes the estimated type from the falsifier denominator", () => {
    // Catches a denominator that counts T3 — which would let the metric fail
    // its own bar for a type the epic deliberately excluded.
    const block = aggregateHumanTouches(results, OPTS);
    expect(block.coverage.countable_designated).toBe(6);
    expect(block.coverage.mechanically_counted).toBe(6);
    expect(block.coverage.share).toBe(1);
    expect(block.coverage.meets_bar).toBe(true);
    expect(block.coverage.missing).toEqual([]);
  });

  it("always emits all three classes in a stable order", () => {
    // Catches an empty class being dropped, which would make "no touches"
    // indistinguishable from "class not computed".
    const block = aggregateHumanTouches([result("T5", { touches: 1, workUnits: 50 })], OPTS);
    expect(block.classes.map((c) => c.class)).toEqual(["gate", "digest", "one-time"]);
    expect(block.classes.find((c) => c.class === "gate")!.touches).toBe(0);
  });
});

describe("aggregateHumanTouches — an unknown is never a measured zero", () => {
  it("excludes unreadable types from sums and names them", () => {
    // Catches the headline defect: a failed collector counted as 0, which
    // would publish "no human touches" when the truth is "we did not look".
    const block = aggregateHumanTouches(
      [
        result("T4", { touches: null, unavailableReason: "AUDIT# scan failed" }),
        result("T5", { touches: 1, workUnits: 100 }),
      ],
      OPTS,
    );
    const digest = block.classes.find((c) => c.class === "digest")!;
    expect(digest.touches).toBe(0);
    expect(digest.unavailable).toEqual(["T4"]);
    expect(digest.leverage).toBeNull();
    expect(block.coverage.missing).toEqual(["T4"]);
    expect(block.coverage.meets_bar).toBe(false);
  });

  it("reports leverage null rather than 0 for a class with no touches", () => {
    // Catches a 0/0 rendered as 0, which reads as "these touches unblocked
    // nothing" instead of "there were no touches".
    const block = aggregateHumanTouches([result("T4", { touches: 0, workUnits: 0 })], OPTS);
    expect(block.classes.find((c) => c.class === "digest")!.leverage).toBeNull();
  });

  it("fails the bar at 4 of 6 and clears it at 5 of 6", () => {
    // Pins the epic's 80% threshold at the exact boundary — catches a >
    // vs >= slip that would silently move the falsifier.
    const readable = (id: string) => result(id, { touches: 1, workUnits: 1 });
    const missing = (id: string) => result(id, { touches: null, unavailableReason: "x" });

    const four = aggregateHumanTouches(
      [readable("T1"), readable("T2"), readable("T4"), readable("T5"), missing("T6"), missing("T7")],
      OPTS,
    );
    expect(four.coverage.share).toBe(0.667);
    expect(four.coverage.meets_bar).toBe(false);

    const five = aggregateHumanTouches(
      [readable("T1"), readable("T2"), readable("T4"), readable("T5"), readable("T6"), missing("T7")],
      OPTS,
    );
    expect(five.coverage.share).toBe(0.833);
    expect(five.coverage.meets_bar).toBe(true);
  });
});

describe("T5 — W-3 amendment table", () => {
  const md = [
    "- **W-3 Cost ceiling.** ...",
    "  | Date | Cap (USD/mo) | Trigger |",
    "  |---|---|---|",
    "  | 2026-06-28 | 190 → 250 | Media group |",
    "  | 2026-07-08 | 250 → 295 | India desk |",
    "  | 2026-07-14 | 295 → 500 | IR pod completion |",
    "  | 2026-08-06 | 500 → 600 | Data & Experience round |",
  ].join("\n");

  it("parses every row including the indented ones", () => {
    // Catches an anchored ^\| regex that misses the whole table, since it is
    // nested under a bullet and every row is indented.
    expect(parseW3Amendments(md)).toHaveLength(4);
  });

  it("counts only the window's raises and credits the headroom released", () => {
    // Catches a window filter that leaks the June and August raises into July.
    const r = collectT5(md, JULY);
    expect(r.touches).toBe(2);
    expect(r.work_units).toBe(45 + 205);
    expect(r.unit).toBe("usd-headroom");
  });

  it("ignores the header and separator rows", () => {
    // Catches a parser that reads "|---|---|---|" as an amendment.
    expect(parseW3Amendments("| Date | Cap | Trigger |\n|---|---|---|")).toEqual([]);
  });
});

describe("T6 — epic status flips, both authored forms", () => {
  it("matches the dashed form", () => {
    expect(matchStatusLine("- **Status**: Accepted (2026-07-08)")).toBe("Accepted (2026-07-08)");
  });

  it("matches epic-018's colon-inside-the-bold form", () => {
    // THE regression the taxonomy calls out by name: an aggregator written
    // against the dashed form alone returns zero T6 touches for epic-018 and
    // reports that as "no status flip", indistinguishable from the truth.
    expect(matchStatusLine("**Status:** Accepted (2026-07-26)")).toBe("Accepted (2026-07-26)");
  });

  it("does not match prose that merely mentions status", () => {
    // Catches an over-loose regex that would count narrative text as a flip.
    expect(matchStatusLine("The **Status** of this epic is unclear")).toBeNull();
  });

  it("counts a Draft → Accepted transition once per file per commit", () => {
    const log = [
      "\x1eabc123\x1f2026-07-08T02:56:24Z",
      "--- a/workforce/docs/epics/epic-020.md",
      "+++ b/workforce/docs/epics/epic-020.md",
      "-- **Status**: Draft",
      "+- **Status**: Accepted (2026-07-08)",
      "\x1edef456\x1f2026-07-26T00:00:00Z",
      "--- a/workforce/docs/epics/epic-018.md",
      "+++ b/workforce/docs/epics/epic-018.md",
      "-**Status:** Draft",
      "+**Status:** Accepted (2026-07-26)",
    ].join("\n");
    const flips = parseEpicStatusFlipsFromLog(log);
    expect(flips.map((f) => f.file)).toEqual([
      "workforce/docs/epics/epic-020.md",
      "workforce/docs/epics/epic-018.md",
    ]);
    expect(flips[1].from).toBe("Draft");
  });

  it("does NOT count a file addition that arrives already Accepted", () => {
    // THE real-history regression: the 2026-07-26 tree reorganisation
    // relocated four already-Accepted epics. An added-line-only parser
    // reports four status flips in a month that had none. The taxonomy names
    // the transition, not the state.
    const log = [
      "\x1ebulk01\x1f2026-07-26T07:41:13Z",
      "--- /dev/null",
      "+++ b/workforce/docs/epics/epic-023.md",
      "+# Epic-023",
      "+- **Status**: Accepted (2026-07-08)",
    ].join("\n");
    expect(parseEpicStatusFlipsFromLog(log)).toEqual([]);
  });

  it("does not count a re-word of an already-Accepted line", () => {
    // Catches double counting when a date or wording changes on a line that
    // was already Accepted.
    const log = [
      "\x1eabc123\x1f2026-07-10T00:00:00Z",
      "+++ b/workforce/docs/epics/epic-020.md",
      "-- **Status**: Accepted (2026-07-08)",
      "+- **Status**: Accepted (2026-07-09)",
    ].join("\n");
    expect(parseEpicStatusFlipsFromLog(log)).toEqual([]);
  });

  it("ignores a removed Accepted line", () => {
    // Catches a parser that reads the '-' side of a diff and counts a
    // revert as a flip.
    const log = [
      "\x1eabc123\x1f2026-07-08T00:00:00Z",
      "+++ b/workforce/docs/epics/epic-020.md",
      "-- **Status**: Accepted (2026-07-08)",
      "+- **Status**: Draft",
    ].join("\n");
    expect(parseEpicStatusFlipsFromLog(log)).toEqual([]);
  });

  it("counts an epic's directly-referenced stories, deduped", () => {
    // Catches double counting when a story appears as both a full URL and
    // a bare #N reference.
    const epic = "Story 1 (#452) and Story 2 https://github.com/o/r/issues/453 and again #452";
    expect(countReferencedStories(epic)).toBe(2);
  });
});

describe("T7 — hire rounds", () => {
  it("counts distinct first-column slugs, skipping the header and separator", () => {
    // Catches a parser that counts "Slug"/"---" as personas, and one that
    // double-counts a repeated slug.
    const md = ["| Slug | Role |", "|---|---|", "| `nadia` | PM |", "| `farah` | SRE |", "| `nadia` | dup |"].join("\n");
    expect(countRoundPersonas(md)).toBe(2);
  });

  it("credits one touch per adding commit, not per file", () => {
    // THE real-history regression: the 2026-07-26 tree reorganisation added
    // eight pre-existing round docs in one commit. Counting files reports
    // eight hire rounds in a month that had none.
    const rounds = groupRoundsByCommit([
      { sha: "bulk1", date: "2026-07-26T07:41:13Z", file: "a.md" },
      { sha: "bulk1", date: "2026-07-26T07:41:13Z", file: "b.md" },
      { sha: "bulk1", date: "2026-07-26T07:41:13Z", file: "c.md" },
      { sha: "solo2", date: "2026-07-28T00:00:00Z", file: "d.md" },
    ]);
    expect(rounds).toHaveLength(2);
    expect(rounds[0].files).toHaveLength(3);
    expect(rounds[1].files).toEqual(["d.md"]);
  });

  it("orders grouped rounds by date", () => {
    // Catches Map-insertion order leaking into the published table.
    const rounds = groupRoundsByCommit([
      { sha: "b", date: "2026-07-28T00:00:00Z", file: "b.md" },
      { sha: "a", date: "2026-07-02T00:00:00Z", file: "a.md" },
    ]);
    expect(rounds.map((r) => r.sha)).toEqual(["a", "b"]);
  });

  it("does not count slugs from later columns", () => {
    // Catches a regex that scans the whole row: "Reports to" cells hold
    // existing personas, and crediting them would inflate every round.
    const md = "| `linnea` | Data Scientist | `nadia` | Boulder |";
    expect(countRoundPersonas(md)).toBe(1);
  });

  it("returns 0 when no roster parses, so the caller can flag it", () => {
    // Catches a parser that invents a count from prose; the collector maps
    // 0 to "credit 1 and flag" per Epic-020 Q1.
    expect(countRoundPersonas("This round hired three people.")).toBe(0);
  });
});

describe("T1/T2 — Trap 2, merged_by is not admissible", () => {
  it("counts an escalated PR as both a terminal action and a verdict", () => {
    const { t1, t2 } = classifyPrTouches([
      { number: 1, labels: ["autopilot:needs-human", "autopilot:reason:l0l1-path"], changed_files: 3 },
    ]);
    expect(t1).toHaveLength(1);
    expect(t2).toHaveLength(1);
  });

  it("does NOT count a delegated R-N10 merge as a human touch", () => {
    // The headline Trap-2 regression: a delegated merge executes through the
    // project PAT and renders as the operator, so counting it would inflate
    // human touches with agent work.
    const { t1, t2, unspecified } = classifyPrTouches([
      { number: 2, labels: ["autopilot:reason:clean"], changed_files: 5 },
    ]);
    expect(t1).toEqual([]);
    expect(t2).toEqual([]);
    expect(unspecified).toBe(0);
  });

  it("buckets a PR with no reason label as unspecified, never as human", () => {
    // Catches an else-branch that treats "unlabelled" as "operator did it".
    const { t1, unspecified } = classifyPrTouches([{ number: 3, labels: [], changed_files: 1 }]);
    expect(t1).toEqual([]);
    expect(unspecified).toBe(1);
  });
});
