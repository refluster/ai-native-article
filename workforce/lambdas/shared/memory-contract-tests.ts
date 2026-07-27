// Unit tests for shared/memory-contract.ts — the ADR-0019/ADR-0020
// server-side gate on POST /agents/{slug}/memory. Pure-function layer:
// the route wiring reuses the exact predicates under test here, so the
// contract's accept/reject behaviour is locked without a DDB/SM harness.

import { describe, expect, it } from "vitest";
import {
  MEMORY_BLOCK_MAX_CHARS,
  MEMORY_MIN_CHARS,
  isSuspiciousShrink,
  validateMemoryDocument,
} from "./memory-contract.js";

const VALID_DOC = `# MEMORY — Test Agent (Role)

> Curated: 2026-07-19 · distilled from the EXEC ledger.

## Mission anchor

${"My lane serves the mission by turning experience into durable premise. ".repeat(3)}

## Learned principles

- A distilled principle, generalised across episodes rather than logged as activity.
- Another one, self-contained enough to read correctly at session open.
`;

describe("validateMemoryDocument", () => {
  it("accepts a well-formed MEMORY.md and extracts last_updated", () => {
    const r = validateMemoryDocument(VALID_DOC);
    expect(r.violations).toEqual([]);
    expect(r.last_updated).toBe("2026-07-19");
  });

  it("rejects a missing title", () => {
    const r = validateMemoryDocument(VALID_DOC.replace("# MEMORY — Test Agent (Role)", "# Notes"));
    expect(r.violations.some((v) => v.includes("title"))).toBe(true);
  });

  it("rejects a missing Curated date token and reports null last_updated", () => {
    const r = validateMemoryDocument(VALID_DOC.replace(/Curated: \d{4}-\d{2}-\d{2}/, "Curated: recently"));
    expect(r.last_updated).toBeNull();
    expect(r.violations.some((v) => v.includes("Curated"))).toBe(true);
  });

  it("rejects a missing Mission anchor section (the MVV anchor is mandatory)", () => {
    const r = validateMemoryDocument(VALID_DOC.replace("## Mission anchor", "## Anchor"));
    expect(r.violations.some((v) => v.includes("Mission anchor"))).toBe(true);
  });

  it("rejects a hollow body under the minimum floor", () => {
    const r = validateMemoryDocument("# MEMORY — X (Y)\n> Curated: 2026-07-19\n## Mission anchor\nok");
    expect(r.violations.some((v) => v.includes(`${MEMORY_MIN_CHARS}`))).toBe(true);
  });

  it("rejects a body over the S17 ceiling", () => {
    const r = validateMemoryDocument(VALID_DOC + "x".repeat(MEMORY_BLOCK_MAX_CHARS));
    expect(r.violations.some((v) => v.includes("ceiling"))).toBe(true);
  });
});

describe("isSuspiciousShrink", () => {
  it("never triggers against absent or empty existing memory", () => {
    expect(isSuspiciousShrink(undefined, "short")).toBe(false);
    expect(isSuspiciousShrink("", "short")).toBe(false);
    expect(isSuspiciousShrink("   \n", "short")).toBe(false);
  });

  it("triggers when the revision falls below half the existing length", () => {
    const existing = "x".repeat(2000);
    expect(isSuspiciousShrink(existing, "y".repeat(999))).toBe(true);
    expect(isSuspiciousShrink(existing, "y".repeat(1001))).toBe(false);
  });
});
