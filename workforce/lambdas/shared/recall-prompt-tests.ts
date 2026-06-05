// Unit tests for shared/recall-prompt.ts — Epic-012 Story 1.
//
// recall() (the network-bearing kNN path) is mocked; these tests pin the
// prompt-budget logic and the fail-soft/opt-out behaviour.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./recall.js", () => ({
  recall: vi.fn(),
}));

import { recall, type RecallResult } from "./recall.js";
import {
  buildRecallBlock,
  buildRecallQuery,
  renderRecallBlock,
  RECALL_BLOCK_CHAR_CAP,
  RECALL_K_DEFAULT,
} from "./recall-prompt.js";

const recallMock = vi.mocked(recall);

/** Minimal ExecutionRow-shaped fixture — only the fields the renderer reads. */
function result(
  opts: { skill?: string; status?: string; summary?: string; error?: string; when?: string },
): RecallResult {
  return {
    row: {
      started_at: opts.when ?? "2026-05-18T09:00:00Z",
      skill_name: opts.skill ?? "article-level2",
      status: opts.status ?? "ok",
      artifact_ref: opts.summary ? { summary: opts.summary } : undefined,
      error: opts.error,
    },
  } as unknown as RecallResult;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("buildRecallQuery", () => {
  it("joins skill, brief, project; drops empty parts", () => {
    expect(buildRecallQuery("article-level2", "weekly synthesis", "self/sora")).toBe(
      "article-level2 — weekly synthesis — self/sora",
    );
    expect(buildRecallQuery("feed-post", undefined, "agent-workforce")).toBe(
      "feed-post — agent-workforce",
    );
  });
});

describe("renderRecallBlock", () => {
  it("empty input → empty string (no header)", () => {
    expect(renderRecallBlock([])).toBe("");
  });

  it("surfaces a recalled execution's summary, skill, status and date", () => {
    const block = renderRecallBlock([
      result({ skill: "article-level2", status: "ok", summary: "Shipped L2 explainer on DC power", when: "2026-05-18T09:00:00Z" }),
    ]);
    expect(block).toContain("## Relevant past work (recalled)");
    expect(block).toContain("Shipped L2 explainer on DC power");
    expect(block).toContain("article-level2");
    expect(block).toContain("2026-05-18");
    expect(block).toContain("ok");
  });

  it("falls back to error then placeholder when no summary", () => {
    expect(renderRecallBlock([result({ error: "finish_reason=length" })])).toContain(
      "finish_reason=length",
    );
    expect(renderRecallBlock([result({})])).toContain("(no summary)");
  });

  it("caps the block and appends a VISIBLE omission marker (loud, not silent)", () => {
    // Each line ~120 chars; 40 of them blows past the 1500-char cap.
    const big = Array.from({ length: 40 }, (_, i) =>
      result({ skill: `skill-${i}`, summary: "x".repeat(100) }),
    );
    const block = renderRecallBlock(big);
    // Capped: uncapped this would be ~40×120 ≈ 4800 chars. The cap governs
    // the line budget; the fixed header + one marker line sit on top of it.
    expect(block.length).toBeLessThan(RECALL_BLOCK_CHAR_CAP + 300 /* header+marker headroom */);
    expect(block).toMatch(/omitted for prompt budget/);
    // Most-relevant prefix is kept (first result present), tail dropped.
    expect(block).toContain("skill-0");
    expect(block).not.toContain("skill-39");
  });

  it("singular vs plural omission marker", () => {
    // Construct exactly one overflow item.
    const lines = Array.from({ length: 13 }, (_, i) =>
      result({ skill: `s${i}`, summary: "y".repeat(100) }),
    );
    const block = renderRecallBlock(lines);
    expect(block).toMatch(/\d+ less-relevant match(es)? omitted/);
  });

  it("throws (fail-loud) when a single entry alone exceeds the cap", () => {
    const huge = result({ summary: "z".repeat(RECALL_BLOCK_CHAR_CAP + 50) });
    expect(() => renderRecallBlock([huge])).toThrow(/exceeds RECALL_BLOCK_CHAR_CAP/);
  });
});

describe("buildRecallBlock", () => {
  const base = { caller_agent_slug: "sora", skillName: "article-level2", projectId: "self/sora" as never };

  it("calls recall() with the composed query and renders the result", async () => {
    recallMock.mockResolvedValue([result({ summary: "prior synthesis" })]);
    const block = await buildRecallBlock({ ...base, brief: "weekly" });
    expect(recallMock).toHaveBeenCalledOnce();
    const arg = recallMock.mock.calls[0]![0] as { caller_agent_slug: string; query: string; k: number };
    expect(arg.caller_agent_slug).toBe("sora");
    expect(arg.query).toBe("article-level2 — weekly — self/sora");
    expect(arg.k).toBe(RECALL_K_DEFAULT);
    expect(block).toContain("prior synthesis");
  });

  it("respects a per-skill recall_k override", async () => {
    recallMock.mockResolvedValue([]);
    await buildRecallBlock({ ...base, recall_k: 7 });
    expect((recallMock.mock.calls[0]![0] as { k: number }).k).toBe(7);
  });

  it("recall_k=0 opts out entirely — no recall() call, empty block", async () => {
    const block = await buildRecallBlock({ ...base, recall_k: 0 });
    expect(recallMock).not.toHaveBeenCalled();
    expect(block).toBe("");
  });

  it("fail-soft: recall() throwing yields an empty block, not a thrown error", async () => {
    recallMock.mockRejectedValue(new Error("voyage key missing"));
    await expect(buildRecallBlock(base)).resolves.toBe("");
  });

  it("no matches → empty block", async () => {
    recallMock.mockResolvedValue([]);
    await expect(buildRecallBlock(base)).resolves.toBe("");
  });
});
