// Unit tests for the pr-review handler's pure helpers (Phase 7 PR3b).
//
// Mirrors the scope split from pr-route/handler-tests.ts: pure-function
// coverage here (parser + formatter + cycle counter), integration tests
// for the full dispatchPrReview deferred to a follow-up that adds shared
// mocking infra for GitHub REST × 4, Anthropic, getProject, bundled
// system.md read.

import { describe, expect, it } from "vitest";

// handler.ts imports shared/project.ts → reads TABLE_NAME/STAGE at
// module-eval. Match dual-write-tests.ts pattern: env vars before
// dynamic import.
process.env.TABLE_NAME = "wf-table-test";
process.env.STAGE = "test";

const { countPriorReviews, formatReviewBody, parsePrUrl, parseReviewOutput } =
  await import("./handler.js");

describe("parsePrUrl (pr-review)", () => {
  it("parses a canonical GitHub PR URL", () => {
    expect(parsePrUrl("https://github.com/PSVL/asp-cloud/pull/42")).toEqual({
      owner: "PSVL",
      repo: "asp-cloud",
      pr_number: 42,
    });
  });

  it("rejects an issue URL", () => {
    expect(() => parsePrUrl("https://github.com/o/r/issues/1")).toThrow(
      /does not match GitHub PR URL pattern/,
    );
  });

  it("trims whitespace", () => {
    expect(parsePrUrl("  https://github.com/o/r/pull/1  ")).toEqual({
      owner: "o",
      repo: "r",
      pr_number: 1,
    });
  });
});

describe("parseReviewOutput", () => {
  const valid = {
    summary: "🟡 one or two findings.",
    inline_findings: [
      { finding_id: "A1", lens_section: "A", file: "src/x.ts", line: 42, body: "rename foo to bar" },
      { finding_id: "B2", lens_section: "B", body: "missing test for the throw path" },
    ],
    sign_off: "— Dario",
  };

  it("parses a clean JSON output", () => {
    expect(parseReviewOutput(JSON.stringify(valid))).toEqual(valid);
  });

  it("strips ```json fenced code blocks", () => {
    expect(parseReviewOutput("```json\n" + JSON.stringify(valid) + "\n```").summary).toBe(valid.summary);
  });

  it("filters out malformed finding entries", () => {
    const dirty = {
      ...valid,
      inline_findings: [
        { finding_id: "A1", lens_section: "A", body: "ok" },
        { finding_id: "B2" },          // missing lens_section + body
        null,
        "garbage",
      ],
    };
    expect(parseReviewOutput(JSON.stringify(dirty)).inline_findings).toHaveLength(1);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseReviewOutput("not json {")).toThrow(/was not valid JSON/);
  });

  it("throws when required fields are missing", () => {
    expect(() => parseReviewOutput(JSON.stringify({ summary: "ok" }))).toThrow(
      /missing required fields/,
    );
  });

  it("defaults sign_off to empty string when omitted", () => {
    const minimal = { summary: "s", inline_findings: [] };
    expect(parseReviewOutput(JSON.stringify(minimal)).sign_off).toBe("");
  });
});

describe("countPriorReviews", () => {
  it("counts reviews opened by `**Persona review (cycle N,`", () => {
    const comments = [
      { user: { login: "x" }, body: "**Dario review (cycle 1, lens: architecture)**\n\n..." },
      { user: { login: "x" }, body: "Unrelated comment." },
      { user: { login: "x" }, body: "**Dario review (cycle 2, lens: architecture)**\n\n..." },
      { user: { login: "x" }, body: "**Nadia review (cycle 1, lens: product)**\n\n..." },
    ];
    expect(countPriorReviews(comments, "dario")).toBe(2);
    expect(countPriorReviews(comments, "nadia")).toBe(1);
    expect(countPriorReviews(comments, "aoi")).toBe(0);
  });

  it("returns 0 for an empty comment list", () => {
    expect(countPriorReviews([], "dario")).toBe(0);
  });
});

describe("formatReviewBody", () => {
  const cfg = {
    lens_name: "architecture",
    bias_disclosure_template: "Dario is an LLM persona (anthropic:claude-sonnet-4-6).",
  };
  const review = {
    summary: "🟡 cleared with two minor findings.",
    inline_findings: [
      { finding_id: "A1", lens_section: "A", file: "src/x.ts", line: 42, body: "rename foo" },
      { finding_id: "A2", lens_section: "A", body: "missing test" },
      { finding_id: "B1", lens_section: "B", body: "data-model concern" },
    ],
    sign_off: "— Dario Lindqvist",
  };

  it("opens with the persona-cycle header", () => {
    const out = formatReviewBody(review, 1, cfg, "dario");
    expect(out.startsWith("**Dario review (cycle 1, lens: architecture)**")).toBe(true);
  });

  it("groups findings by section and includes file:line when present", () => {
    const out = formatReviewBody(review, 1, cfg, "dario");
    expect(out).toContain("### Section A");
    expect(out).toContain("- **A1** (`src/x.ts:42`) — rename foo");
    expect(out).toContain("- **A2** — missing test");
    expect(out).toContain("### Section B");
    expect(out).toContain("- **B1** — data-model concern");
  });

  it("closes with the sign_off + bias disclosure as a blockquote", () => {
    const out = formatReviewBody(review, 1, cfg, "dario");
    expect(out).toContain("— Dario Lindqvist");
    expect(out).toContain("> Dario is an LLM persona (anthropic:claude-sonnet-4-6).");
  });

  it("renders `_No findings._` when inline_findings is empty", () => {
    const out = formatReviewBody({ ...review, inline_findings: [] }, 1, cfg, "dario");
    expect(out).toContain("_No findings._");
  });

  it("synthesizes a sign_off when the LLM didn't provide one", () => {
    const out = formatReviewBody({ ...review, sign_off: "" }, 1, cfg, "dario");
    expect(out).toContain("— Dario (LLM persona via Lambda; lens: architecture;");
  });

  it("reflects the cycle number in the header", () => {
    const out = formatReviewBody(review, 3, cfg, "dario");
    expect(out).toContain("**Dario review (cycle 3, lens: architecture)**");
  });
});
