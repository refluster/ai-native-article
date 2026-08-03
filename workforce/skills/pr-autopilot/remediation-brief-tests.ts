// @ts-nocheck — the module under test is a dependency-free ESM script, not TS.
// Discovered by workforce/lambdas/vitest.config.mjs (`include:
// ["../skills/**/*-tests.ts"]`), so `cd workforce/lambdas && npm test` runs it.
//
// Locks adr-0023: a 🔴 verdict may return to the author lane ONLY with a brief
// that parses and only while the cycle budget has room for the loop it
// authorises. Both are the difference between "the loop is bounded" and "the
// loop is bounded because the router said so".
import { describe, it, expect } from "vitest";
import {
  BLOCKING_FINDINGS_CODE,
  BRIEF_MARKER,
  assertBriefForCodes,
  briefIsUsable,
  cycleBudgetAllowsAuthorLoop,
  parseRemediationBrief,
} from "./remediation-brief.mjs";

const GOOD = `**Nadia — verdict, cycle 2 of ≤ 7. 🔴 blocking findings.**

\`wf:rafael\` blocked on the swallowed refusal; \`wf:sana\` on the missing case.

**Remediation brief — 2 blocking findings, cycle 2 of ≤ 7.**

1. \`A1\` (\`workforce/skills/pr-autopilot/pr-merge.mjs:88\`) — rethrow the swallowed refusal instead of logging it. Done when: a server-side refusal exits non-zero.
2. \`B2\` (\`workforce/skills/pr-autopilot/pr-merge-tests.ts\`) — cover the refused-decision path. Done when: the suite fails if the rethrow is removed.

— Nadia (CCR persona)
`;

describe("parseRemediationBrief", () => {
  it("parses each item's finding-ID, location, requirement and acceptance clause", () => {
    const b = parseRemediationBrief(GOOD);
    expect(b.present).toBe(true);
    expect(b.problems).toEqual([]);
    expect(b.items.map((i) => i.id)).toEqual(["A1", "B2"]);
    expect(b.items[0].location).toBe("workforce/skills/pr-autopilot/pr-merge.mjs:88");
    expect(b.items[0].requirement).toMatch(/rethrow the swallowed refusal/);
    expect(b.items[0].acceptance).toMatch(/exits non-zero/);
    expect(b.items[1].acceptance).toMatch(/fails if the rethrow is removed/);
  });

  it("accepts a bulleted brief as well as a numbered one", () => {
    const body = "**Remediation brief — 1 finding.**\n\n- `C3` (`a/b.mjs:1`) — add the missing guard. Done when: the guard throws.\n";
    expect(briefIsUsable(body)).toBe(true);
  });

  it("reports an absent brief rather than throwing", () => {
    const b = parseRemediationBrief("**Nadia — verdict, cycle 2 of ≤ 7.** Reviewers had concerns.");
    expect(b.present).toBe(false);
    expect(b.items).toEqual([]);
    expect(b.problems.join(" ")).toMatch(/no \*\*Remediation brief/);
  });

  it("flags an item with no acceptance clause — the next panel could not check it off", () => {
    const body = "**Remediation brief — 1 finding.**\n\n1. `A1` (`a/b.mjs:2`) — fix the thing properly.\n";
    const b = parseRemediationBrief(body);
    expect(b.items).toHaveLength(1);
    expect(b.problems.join(" ")).toMatch(/no "Done when/);
  });

  it("flags an item that restates the complaint instead of naming a change", () => {
    const body = "**Remediation brief — 1 finding.**\n\n1. `A1` (`a/b.mjs:2`) — bad. Done when: good.\n";
    expect(parseRemediationBrief(body).problems.join(" ")).toMatch(/no concrete change/);
  });

  it("flags a heading with no parsable item at all", () => {
    const body = "**Remediation brief — see the reviews above.**\n\nThe reviewers raised several concerns.\n";
    const b = parseRemediationBrief(body);
    expect(b.present).toBe(true);
    expect(b.problems.join(" ")).toMatch(/no parsable finding/);
  });

  it("flags a finding listed twice — one item per finding-ID", () => {
    const body =
      "**Remediation brief — 2 findings.**\n\n" +
      "1. `A1` (`a/b.mjs:2`) — add the missing guard. Done when: it throws.\n" +
      "2. `A1` (`a/c.mjs:9`) — add the missing guard here too. Done when: it throws.\n";
    expect(parseRemediationBrief(body).problems.join(" ")).toMatch(/listed twice/);
  });
});

describe("assertBriefForCodes — the requirement attaches to the 🔴 code only", () => {
  it("throws on a review-findings-blocking hand-off with no brief", () => {
    expect(() => assertBriefForCodes([BLOCKING_FINDINGS_CODE], "reviewers had concerns")).toThrow(/remediation brief/i);
  });

  it("throws on a defective brief, naming the defect", () => {
    const body = "**Remediation brief — 1 finding.**\n\n1. `A1` (`a/b.mjs:2`) — please address the review comment.\n";
    expect(() => assertBriefForCodes([BLOCKING_FINDINGS_CODE], body)).toThrow(/Done when/);
  });

  it("returns the parsed brief when it is usable", () => {
    expect(assertBriefForCodes([BLOCKING_FINDINGS_CODE], GOOD).items).toHaveLength(2);
  });

  it("leaves adr-0022's 🟡 lane untouched — no brief required, no throw", () => {
    expect(assertBriefForCodes(["review-findings-open"], "the author is expected to revise")).toBeNull();
    expect(assertBriefForCodes(["merge-conflict"], "main moved")).toBeNull();
  });
});

describe("cycleBudgetAllowsAuthorLoop — the human gate moved here", () => {
  it("allows a loop that still fits the cap", () => {
    expect(cycleBudgetAllowsAuthorLoop(2, 7).ok).toBe(true);
    expect(cycleBudgetAllowsAuthorLoop(6, 7).ok).toBe(true);
  });

  it("refuses the loop the cap cannot hold, and names the human-lane remedy", () => {
    const v = cycleBudgetAllowsAuthorLoop(7, 7);
    expect(v.ok).toBe(false);
    expect(v.why).toMatch(/cycle-cap-exceeded/);
  });

  it("refuses a missing or nonsensical cycle rather than assuming one (C-4)", () => {
    expect(cycleBudgetAllowsAuthorLoop(undefined, 7).ok).toBe(false);
    expect(cycleBudgetAllowsAuthorLoop(0, 7).ok).toBe(false);
    expect(cycleBudgetAllowsAuthorLoop("two", 7).ok).toBe(false);
    expect(cycleBudgetAllowsAuthorLoop(2, "").ok).toBe(false);
  });

  it("honours a binding cycle_cap tighter than the W-4 hard cap", () => {
    expect(cycleBudgetAllowsAuthorLoop(3, 3).ok).toBe(false);
    expect(cycleBudgetAllowsAuthorLoop(2, 3).ok).toBe(true);
  });
});

describe("BRIEF_MARKER", () => {
  it("is the validated-artefact marker, not something the router asserts", () => {
    // The marker means "this parsed"; a body carrying it but no brief is exactly
    // the state the post script must never produce.
    expect(BRIEF_MARKER).toBe("<!-- autopilot:brief -->");
    expect(briefIsUsable(`${BRIEF_MARKER}\n`)).toBe(false);
  });
});
