// Unit tests for shared/memory-compaction.ts — Epic-012 Story 2.
// The pure core: trigger, prompt assembly, identity extraction + the
// mechanical identity-preservation guard (the AC's "no identity loss").

import { describe, expect, it } from "vitest";
import {
  shouldCompact,
  buildCompactionSystemPrompt,
  buildCompactionUserPrompt,
  buildCompactionChunk,
  extractIdentityFacts,
  assertIdentityPreserved,
  IdentityLossError,
  IDENTITY_HEADING,
  COMPACTION_THRESHOLD,
} from "./memory-compaction.js";

describe("shouldCompact", () => {
  it("false below threshold", () => {
    expect(shouldCompact({ memver: 5, last_compacted_memver: 0 })).toBe(false);
    expect(shouldCompact({ memver: 14, last_compacted_memver: 5 })).toBe(false); // since=9
  });

  it("true at/above threshold", () => {
    expect(shouldCompact({ memver: COMPACTION_THRESHOLD, last_compacted_memver: 0 })).toBe(true);
    expect(shouldCompact({ memver: 25, last_compacted_memver: 5 })).toBe(true); // since=20
  });

  it("treats absent last_compacted_memver as 0", () => {
    expect(shouldCompact({ memver: COMPACTION_THRESHOLD })).toBe(true);
    expect(shouldCompact({ memver: COMPACTION_THRESHOLD - 1 })).toBe(false);
  });

  it("honours a custom threshold", () => {
    expect(shouldCompact({ memver: 3, last_compacted_memver: 0 }, 3)).toBe(true);
    expect(shouldCompact({ memver: 2, last_compacted_memver: 0 }, 3)).toBe(false);
  });
});

const SUMMARY = `${IDENTITY_HEADING}
- I am Sora, a researcher who values primary sources.
- I write in a measured, evidence-first voice.

## Active threads
- Weekly DC-power synthesis series.

## Recent deliverables
- 12 L2 explainers shipped.`;

describe("extractIdentityFacts", () => {
  it("pulls bullets under the identity heading only, stopping at the next section", () => {
    const facts = extractIdentityFacts(SUMMARY);
    expect(facts).toHaveLength(2);
    expect(facts[0]).toContain("i am sora");
    expect(facts[1]).toContain("measured, evidence-first voice");
    // Active-threads / deliverables bullets are NOT identity facts.
    expect(facts.join(" ")).not.toContain("dc-power synthesis");
  });

  it("empty when there is no identity section", () => {
    expect(extractIdentityFacts("## Active threads\n- x")).toEqual([]);
    expect(extractIdentityFacts("")).toEqual([]);
  });
});

describe("assertIdentityPreserved", () => {
  it("passes when every prior identity fact survives (even reflowed / re-cased)", () => {
    const next = `${IDENTITY_HEADING}
- I am Sora, a RESEARCHER who values primary sources.
- I write in a   measured, evidence-first voice.
- (new) I now mentor junior agents.

## Recent deliverables
- 14 shipped.`;
    expect(() => assertIdentityPreserved(SUMMARY, next)).not.toThrow();
  });

  it("throws IdentityLossError naming the dropped fact", () => {
    const next = `${IDENTITY_HEADING}
- I am Sora, a researcher who values primary sources.

## Recent deliverables
- 14 shipped.`; // dropped the "measured, evidence-first voice" fact
    expect(() => assertIdentityPreserved(SUMMARY, next)).toThrow(IdentityLossError);
    try {
      assertIdentityPreserved(SUMMARY, next);
    } catch (e) {
      expect((e as IdentityLossError).dropped).toHaveLength(1);
      expect((e as IdentityLossError).dropped[0]).toContain("evidence-first voice");
    }
  });

  it("first compaction (empty prior) always passes — nothing to preserve", () => {
    expect(() => assertIdentityPreserved("", "anything at all")).not.toThrow();
  });
});

describe("prompt assembly", () => {
  it("system prompt pins the identity heading + verbatim rule", () => {
    const sys = buildCompactionSystemPrompt();
    expect(sys).toContain(IDENTITY_HEADING);
    expect(sys).toContain("VERBATIM");
    expect(sys).toMatch(/never drop/i);
  });

  it("user prompt carries the prior summary and the new chunks", () => {
    const prompt = buildCompactionUserPrompt(SUMMARY, ["run A did X", "run B did Y"]);
    expect(prompt).toContain("I am Sora");
    expect(prompt).toContain("run A did X");
    expect(prompt).toContain("run B did Y");
  });

  it("user prompt flags the first-compaction case when prior is empty", () => {
    const prompt = buildCompactionUserPrompt("", ["only chunk"]);
    expect(prompt).toMatch(/first compaction/i);
    expect(prompt).toContain("only chunk");
  });
});

describe("buildCompactionChunk", () => {
  it("wraps the summary with identifying frontmatter", () => {
    const chunk = buildCompactionChunk("sora", 11, 5, "## Identity-laminated facts\n- x");
    expect(chunk).toMatch(/kind: compaction/);
    expect(chunk).toMatch(/memver: 11/);
    expect(chunk).toMatch(/compacted_from_memver: 5/);
    expect(chunk).toContain("- x");
  });
});
