// Unit tests for shared/board-knowledge.ts — pack parsing, bilingual
// tokenisation, section ranking and the budgeted selection (ADR-0034).

import { describe, expect, it } from "vitest";

import { parseKnowledgePack, rankSections, renderPinned, selectKnowledge, stem, tokenise } from "./board-knowledge.js";

const PACK = `# Board knowledge pack
<!-- generated -->

## [about|pinned] What this is

Two products, one repository.

## [mvv] Mission

Build the operating model for human-agent co-creation.

## [founding-story] 創業ストーリー — 三枚の紙

エージェント組織を紙に描いた。ガバナンスとワークフォースの設計。

## [lambdas] Workforce Lambdas

wf-podcast synthesises audio with Polly. wf-orchestrator dispatches CCR routines.

## [roadmap] Phase 7

Multi-project PR review.
`;

describe("parseKnowledgePack", () => {
  it("splits sections, reads source + pinned flag, skips the banner", () => {
    const sections = parseKnowledgePack(PACK);
    expect(sections.map((s) => [s.source, s.title, s.pinned])).toEqual([
      ["about", "What this is", true],
      ["mvv", "Mission", false],
      ["founding-story", "創業ストーリー — 三枚の紙", false],
      ["lambdas", "Workforce Lambdas", false],
      ["roadmap", "Phase 7", false],
    ]);
    expect(sections[1]?.body).toBe("Build the operating model for human-agent co-creation.");
  });
});

describe("tokenise", () => {
  it("lowercases ASCII words, drops stopwords and short tokens", () => {
    const t = tokenise("How does the Orchestrator dispatch CCR routines?");
    expect(t.has("orchestrator")).toBe(true);
    expect(t.has("ccr")).toBe(true);
    expect(t.has("how")).toBe(false);
    expect(t.has("the")).toBe(false);
  });

  it("stems inflections and splits hyphenated compounds", () => {
    const t = tokenise("wf-orchestrator dispatches routines");
    expect(t.has("wf-orchestrator")).toBe(true);
    expect(t.has("orchestrator")).toBe(true);
    expect(t.has("dispatch")).toBe(true);
    expect(t.has("routine")).toBe(true);
    expect(stem("phases")).toBe("phase");
    expect(stem("boards")).toBe("board");
    expect(stem("process")).toBe("process");
    expect(tokenise("How does the orchestrator dispatch work?").has("dispatch")).toBe(true);
  });

  it("emits kanji/katakana bigrams and skips hiragana", () => {
    const t = tokenise("ガバナンスはどう設計した？");
    expect(t.has("ガバ")).toBe(true);
    expect(t.has("設計")).toBe(true);
    expect([...t].some((x) => /^[぀-ゟ]+$/.test(x))).toBe(false);
  });
});

describe("rankSections / selectKnowledge", () => {
  const sections = parseKnowledgePack(PACK);

  it("ranks the section sharing rare terms with the question first", () => {
    const ranked = rankSections(sections, "What does wf-podcast do with Polly?");
    expect(ranked[0]?.section.source).toBe("lambdas");
  });

  it("handles a Japanese question against Japanese sections", () => {
    const ranked = rankSections(sections, "ガバナンスの設計について教えて");
    expect(ranked[0]?.section.source).toBe("founding-story");
  });

  it("never ranks pinned sections and returns nothing for an empty question", () => {
    expect(rankSections(sections, "").length).toBe(0);
    expect(rankSections(sections, "products repository").every((r) => !r.section.pinned)).toBe(true);
  });

  it("always includes pinned sections, then the best matches under the cap", () => {
    const out = selectKnowledge(sections, "wf-podcast Polly", { maxChars: 20_000, maxSections: 1 });
    expect(out).toContain("### What this is");
    expect(out).toContain("### Workforce Lambdas");
    expect(out).not.toContain("### Phase 7");
  });

  it("stops folding sections once the character budget is spent", () => {
    const out = selectKnowledge(sections, "wf-podcast Polly Phase review", { maxChars: 480 });
    // Two sections match the question; the pinned section (~65 chars) plus
    // the first scored one leave less than the 400-char floor, so exactly
    // one scored section is folded in.
    expect((out.match(/_Source:/g) ?? []).length).toBe(2);
  });

  it("can leave the pinned sections out, and renderPinned renders only them", () => {
    const out = selectKnowledge(sections, "wf-podcast Polly", { includePinned: false });
    expect(out).not.toContain("### What this is");
    expect(out).toContain("### Workforce Lambdas");
    const pinned = renderPinned(sections);
    expect(pinned).toContain("### What this is");
    expect(pinned).not.toContain("### Workforce Lambdas");
  });

  it("truncates an oversized section body and marks it", () => {
    const big = parseKnowledgePack(`## [x] Big\n\n${"word ".repeat(2000)}`);
    const out = selectKnowledge(big, "word", { sectionMaxChars: 100 });
    expect(out).toContain("(section truncated)");
  });
});
