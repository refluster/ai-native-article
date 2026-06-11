// Unit tests for shared/agent-audit.ts diffChanges — specifically the
// long-string digest behaviour added with the ADR-0007 step-2 persona
// prompt (system_prompt is PATCHable, so verbatim before/after text would
// double-store kilobytes per edit in the append-only AUDIT partition).

import { describe, expect, it, vi } from "vitest";

// agent-audit imports the ddb module, which throws at load without
// TABLE_NAME; diffChanges itself is pure.
vi.mock("./ddb.js", () => ({
  putItem: vi.fn(),
  queryBySkPrefixPaged: vi.fn(),
}));

const { diffChanges } = await import("./agent-audit.js");

describe("diffChanges", () => {
  it("records short values verbatim and skips unchanged fields", () => {
    const changes = diffChanges(
      { role: "Writer", paused: false },
      { role: "Editor", paused: false },
    );
    expect(changes).toEqual([{ field: "role", before: "Writer", after: "Editor" }]);
  });

  it("represents an absent before-value as null", () => {
    expect(diffChanges({}, { system_prompt: "short" })).toEqual([
      { field: "system_prompt", before: null, after: "short" },
    ]);
  });

  it("digests strings over the verbatim cap instead of storing them whole", () => {
    const before = `OLD ${"a".repeat(2000)}`;
    const after = `NEW ${"b".repeat(3000)}`;
    const [change] = diffChanges({ system_prompt: before }, { system_prompt: after });
    expect(change).toBeDefined();
    for (const [side, source] of [
      [change!.before, before],
      [change!.after, after],
    ] as const) {
      const t = side as { truncated: boolean; length: number; sha256: string; head: string };
      expect(t.truncated).toBe(true);
      expect(t.length).toBe(source.length);
      expect(t.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(t.head).toBe(source.slice(0, 200));
    }
  });
});
