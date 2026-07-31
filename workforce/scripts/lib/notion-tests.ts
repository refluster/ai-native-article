// Parity tests for the shared Notion reader (scripts/lib/notion.mjs).
//
// What bug would these catch? The #393 class: a podcast reader that knows
// `select` but not `status` resolves every `podcastStatus` to "", so
// pick-episodes silently returns zero episodes and the publish cadence goes
// quiet without failing. Before this module the copies had already drifted —
// pick-episodes.mjs was missing `date` and `multi_select` — so the drift is a
// demonstrated failure, not a hypothetical one.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { propText, slugFromId, UNIFIED_DB_ID } from "./notion.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SKILLS_DIR = join(HERE, "..", "..", "skills");

describe("propText", () => {
  it("reads a status-type property (the podcastStatus shape)", () => {
    expect(propText({ type: "status", status: { name: "approved" } })).toBe("approved");
  });

  it("reads a select-type property", () => {
    expect(propText({ type: "select", select: { name: "analysis" } })).toBe("analysis");
  });

  // The #393 bug in one assertion: status and select are distinct Notion types
  // carrying the same shape. A reader that handles only one silently returns ""
  // for the other, and every downstream filter quietly matches nothing.
  it("resolves status and select identically for the same option name", () => {
    const asStatus = propText({ type: "status", status: { name: "approved" } });
    const asSelect = propText({ type: "select", select: { name: "approved" } });
    expect(asStatus).toBe(asSelect);
    expect(asStatus).not.toBe("");
  });

  it("reads title and rich_text by concatenating plain_text runs", () => {
    expect(propText({ type: "title", title: [{ plain_text: "担い手の" }, { plain_text: "交代" }] })).toBe("担い手の交代");
    expect(propText({ type: "rich_text", rich_text: [{ plain_text: "a" }, { plain_text: "b" }] })).toBe("ab");
  });

  it("reads date as its start value", () => {
    expect(propText({ type: "date", date: { start: "2026-07-28" } })).toBe("2026-07-28");
  });

  it("reads url", () => {
    expect(propText({ type: "url", url: "https://kohuehara.xyz" })).toBe("https://kohuehara.xyz");
  });

  it("joins multi_select option names", () => {
    expect(propText({ type: "multi_select", multi_select: [{ name: "AI Strategy" }, { name: "Big Tech" }] }))
      .toBe("AI Strategy, Big Tech");
  });

  it("returns empty string for missing, empty, and unknown-typed properties", () => {
    expect(propText(undefined)).toBe("");
    expect(propText(null)).toBe("");
    expect(propText({ type: "status", status: null })).toBe("");
    expect(propText({ type: "people", people: [{ id: "x" }] })).toBe("");
  });
});

describe("slugFromId", () => {
  it("strips dashes and truncates to 12 chars", () => {
    expect(slugFromId("34fd0f0b-e61e-817a-9f6b-dc65b0d5b4cc")).toBe("34fd0f0be61e");
  });
});

describe("UNIFIED_DB_ID", () => {
  it("is a non-empty non-secret constant", () => {
    expect(UNIFIED_DB_ID).toMatch(/^[0-9a-f-]{32,36}$/);
  });
});

// The anti-drift ratchet. Extracting the helper only stops the divergence if
// nothing re-declares a local copy later — the same copy-paste that produced
// the drift this module removes. This asserts the writers, not the tickets.
describe("no skill script re-declares a local propText", () => {
  const mjsFiles: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "dist") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".mjs")) mjsFiles.push(full);
    }
  };
  walk(SKILLS_DIR);

  it("finds skill scripts to check", () => {
    expect(mjsFiles.length).toBeGreaterThan(0);
  });

  it.each(mjsFiles.map((f) => [f]))("%s imports the shared reader instead of defining one", (file) => {
    const src = readFileSync(file, "utf8");
    if (!/\bpropText\b/.test(src)) return; // doesn't read Notion properties at all
    expect(src, `${file} declares a local propText — import it from scripts/lib/notion.mjs instead`)
      .not.toMatch(/(function\s+propText\s*\(|const\s+propText\s*=)/);
    expect(src).toMatch(/from\s+["'][^"']*scripts\/lib\/notion\.mjs["']/);
  });
});
