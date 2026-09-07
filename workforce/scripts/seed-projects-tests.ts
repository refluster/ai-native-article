// Tests for seed-projects.mjs — the encode/decode round-trip and the
// create-only merge (ADR-0029).
//
// These exist because their absence is what let a data-loss bug ship green:
// `ddbItem` encodes a non-empty string array as `SS`, `fromAttr` did not
// decode `SS`, and the carry-forward therefore rewrote every stored
// `governance_docs` / `credential_types` as `{NULL:true}` on the next re-seed.
// `test:scripts` passed throughout, because workforce/scripts carried no test
// for this file at all.
//
// The round-trip test is written as a PROPERTY over every shape `ddbItem` can
// emit, not as an enumeration of today's fields — the next field added to
// API_OWNED_FIELDS should be covered without anyone remembering to extend it.

import { describe, expect, it } from "vitest";
import {
  ddbItem,
  fromAttr,
  mergeApiOwnedFields,
  API_OWNED_FIELDS,
} from "./seed-projects.mjs";

type Attr = Record<string, unknown>;

describe("ddbItem / fromAttr round-trip", () => {
  const cases: Array<[string, unknown]> = [
    ["string", "AGENTS.md"],
    ["empty string", ""],
    ["number", 42],
    ["boolean true", true],
    ["boolean false", false],
    ["null", null],
    ["string array (SS)", ["AGENTS.md", "docs/governance.md"]],
    ["single-entry string array", ["github.token"]],
    ["empty array (L)", []],
    ["number array (NS)", [1, 2, 3]],
    ["nested object (M)", { owner: "refluster", repo: "ai-native-article" }],
  ];

  for (const [name, value] of cases) {
    it(`survives a full encode → decode → re-encode cycle: ${name}`, () => {
      const encoded = ddbItem({ f: value }) as Attr;
      const decoded = fromAttr(encoded.f);
      expect(decoded).toEqual(value);
      // The re-encode is the half that actually bit: a decoder returning
      // undefined re-encodes as {NULL:true} and destroys the stored value.
      expect(ddbItem({ f: decoded })).toEqual(encoded);
    });
  }

  it("decodes SS to a real array, never undefined (the data-loss regression)", () => {
    const stored = ddbItem({ governance_docs: ["AGENTS.md", "docs/x.md"] }) as Attr;
    expect(stored.governance_docs).toEqual({ SS: ["AGENTS.md", "docs/x.md"] });
    expect(fromAttr(stored.governance_docs)).toEqual(["AGENTS.md", "docs/x.md"]);
    expect(ddbItem({ governance_docs: fromAttr(stored.governance_docs) })).not.toEqual({
      governance_docs: { NULL: true },
    });
  });
});

describe("mergeApiOwnedFields (the create-only rule)", () => {
  const fromFile = () => ({
    name: "From project.json",
    owner_agent: "_operator",
    github_owner: "refluster",
    github_repo: "ai-native-article",
    governance_docs: ["AGENTS.md"],
    credential_types: ["github.token"],
    note: "not API-owned",
  });

  it("is a no-op when the project row does not exist yet (creation)", () => {
    const next = fromFile();
    expect(mergeApiOwnedFields(next, null)).toEqual(fromFile());
  });

  it("carries every API-owned field forward from the stored row", () => {
    const existing = ddbItem({
      name: "Renamed in the console",
      owner_agent: "ren",
      github_owner: "PSVL",
      github_repo: "asp-cloud",
      governance_docs: ["CONTRIBUTING.md", "docs/arch.md"],
      credential_types: ["notion.integration_token"],
    }) as Attr;

    const merged = mergeApiOwnedFields(fromFile(), existing) as Record<string, unknown>;
    expect(merged.name).toBe("Renamed in the console");
    expect(merged.owner_agent).toBe("ren");
    expect(merged.github_owner).toBe("PSVL");
    expect(merged.governance_docs).toEqual(["CONTRIBUTING.md", "docs/arch.md"]);
    expect(merged.credential_types).toEqual(["notion.integration_token"]);
  });

  it("leaves fields the API does not own alone", () => {
    const existing = ddbItem({ name: "Kept", note: "stale note in DDB" }) as Attr;
    const merged = mergeApiOwnedFields(fromFile(), existing) as Record<string, unknown>;
    expect(merged.note).toBe("not API-owned");
  });

  it("keeps a console-CLEARED field cleared instead of restoring project.json's value", () => {
    // `github: null` through PATCH deletes both attributes. Keying the merge on
    // attribute presence would fall back to project.json here and silently undo
    // the operator's clear — the same clobber, in the direction that looks like
    // ordinary seeding.
    const existing = ddbItem({ name: "Kept", owner_agent: "ren" }) as Attr;
    const merged = mergeApiOwnedFields(fromFile(), existing) as Record<string, unknown>;
    expect("github_owner" in merged).toBe(false);
    expect("github_repo" in merged).toBe(false);
    expect("governance_docs" in merged).toBe(false);
  });

  it("does not survive a re-seed cycle by accident — merging twice is stable", () => {
    const stored = ddbItem({
      name: "Console name",
      governance_docs: ["AGENTS.md", "docs/governance.md"],
    }) as Attr;
    const first = mergeApiOwnedFields(fromFile(), stored) as Record<string, unknown>;
    const rewritten = ddbItem(first) as Attr;
    const second = mergeApiOwnedFields(fromFile(), rewritten) as Record<string, unknown>;
    expect(second.governance_docs).toEqual(["AGENTS.md", "docs/governance.md"]);
    expect(second.name).toBe("Console name");
  });

  it("covers every field the API can own", () => {
    // Guards the enumeration itself: a field added to the PATCH allowlist
    // without a matching entry here would carry no create-only protection.
    expect(API_OWNED_FIELDS).toEqual([
      "name",
      "owner_agent",
      "github_owner",
      "github_repo",
      "governance_docs",
      "credential_types",
    ]);
  });
});
