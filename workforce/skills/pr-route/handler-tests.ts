// Unit tests for the pr-route handler's pure helpers.
//
// Integration tests for the full `dispatchPrRoute(ctx)` flow — which
// requires mocking GitHub REST (4 endpoints), Anthropic API,
// `getProject(DDB)`, and the bundled `agents/{slug}/system.md` read —
// are deferred to Phase 7 PR3b, alongside the pr-review handler that
// shares the same surfaces.
//
// What this file covers (pure functions, no IO):
//   - parsePrUrl: happy path + 4 error paths
//   - parseRouteOutput: happy path + invalid JSON + missing fields +
//                       fenced-code-block tolerance
//   - countPriorRouterComments: cycle counter heuristic
//   - formatRoutingComment: comment template shape

import { describe, expect, it } from "vitest";

// handler.ts imports shared/project.ts, which reads TABLE_NAME / STAGE at
// module-eval. ESM hoists static imports, so the env vars MUST be set
// before the dynamic import of handler.js. Matches the
// dual-write-tests.ts pattern. None of these tests touch DDB.
process.env.TABLE_NAME = "wf-table-test";
process.env.STAGE = "test";

const { countPriorRouterComments, formatRoutingComment, parsePrUrl, parseRouteOutput } =
  await import("./handler.js");

describe("parsePrUrl", () => {
  it("parses a canonical https GitHub PR URL", () => {
    expect(parsePrUrl("https://github.com/PSVL/asp-cloud/pull/42")).toEqual({
      owner: "PSVL",
      repo: "asp-cloud",
      pr_number: 42,
    });
  });

  it("accepts trailing slash, query, and fragment", () => {
    expect(parsePrUrl("https://github.com/refluster/ai-native-article/pull/162/")).toEqual({
      owner: "refluster",
      repo: "ai-native-article",
      pr_number: 162,
    });
    expect(parsePrUrl("https://github.com/o/r/pull/1?foo=bar")).toEqual({
      owner: "o",
      repo: "r",
      pr_number: 1,
    });
    expect(parsePrUrl("https://github.com/o/r/pull/1#issuecomment-123")).toEqual({
      owner: "o",
      repo: "r",
      pr_number: 1,
    });
  });

  it("trims whitespace", () => {
    expect(parsePrUrl("  https://github.com/o/r/pull/1  ")).toEqual({
      owner: "o",
      repo: "r",
      pr_number: 1,
    });
  });

  it("rejects an issue URL (not a PR)", () => {
    expect(() => parsePrUrl("https://github.com/o/r/issues/1")).toThrow(
      /does not match GitHub PR URL pattern/,
    );
  });

  it("rejects a non-GitHub host", () => {
    expect(() => parsePrUrl("https://gitlab.com/o/r/-/merge_requests/1")).toThrow(
      /does not match GitHub PR URL pattern/,
    );
  });

  it("rejects a missing PR number", () => {
    expect(() => parsePrUrl("https://github.com/o/r/pull/")).toThrow(
      /does not match GitHub PR URL pattern/,
    );
  });

  it("rejects empty input", () => {
    expect(() => parsePrUrl("")).toThrow(/does not match GitHub PR URL pattern/);
  });
});

describe("parseRouteOutput", () => {
  const valid = {
    summary: "Adds Nadia bindings + project plane.",
    reviewers: [
      { persona: "dario", lens: "architecture", rationale: "touches lambdas/" },
      { persona: "ren", lens: "engineering", rationale: "run_locally=true" },
    ],
    skipped: ["aoi"],
    skip_rationale: "no UI surface",
  };

  it("parses a clean JSON output", () => {
    expect(parseRouteOutput(JSON.stringify(valid))).toEqual(valid);
  });

  it("strips a ```json fenced code block wrapper", () => {
    const fenced = "```json\n" + JSON.stringify(valid) + "\n```";
    expect(parseRouteOutput(fenced).reviewers).toHaveLength(2);
  });

  it("strips an unlabeled fenced code block", () => {
    const fenced = "```\n" + JSON.stringify(valid) + "\n```";
    expect(parseRouteOutput(fenced).summary).toBe(valid.summary);
  });

  it("filters out malformed reviewer entries", () => {
    const dirty = {
      ...valid,
      reviewers: [
        { persona: "dario", lens: "architecture", rationale: "ok" },
        { persona: "ren" }, // missing lens + rationale
        null,
        "garbage",
      ],
    };
    const parsed = parseRouteOutput(JSON.stringify(dirty));
    expect(parsed.reviewers).toHaveLength(1);
    expect(parsed.reviewers[0]!.persona).toBe("dario");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseRouteOutput("not json {")).toThrow(/was not valid JSON/);
  });

  it("throws when required fields are missing", () => {
    expect(() => parseRouteOutput(JSON.stringify({ summary: "ok" }))).toThrow(
      /missing required fields/,
    );
  });

  it("defaults skipped/skip_rationale to empty when omitted", () => {
    const minimal = { summary: "s", reviewers: [] };
    const parsed = parseRouteOutput(JSON.stringify(minimal));
    expect(parsed.skipped).toEqual([]);
    expect(parsed.skip_rationale).toBe("");
  });
});

describe("countPriorRouterComments", () => {
  it("counts comments whose body opens with the router template", () => {
    const comments = [
      { user: { login: "x" }, body: "**Nadia — cycle 1 of ≤ 7.**\n\nFoo." },
      { user: { login: "x" }, body: "Random unrelated comment." },
      { user: { login: "x" }, body: "**Nadia — cycle 2 of ≤ 7.**\n\nBar." },
      { user: { login: "x" }, body: "**Dario — cycle 1 of ≤ 7.**\n\nNot Nadia." },
    ];
    expect(countPriorRouterComments(comments, "nadia")).toBe(2);
  });

  it("returns 0 when the agent has no prior router comments", () => {
    expect(countPriorRouterComments([], "nadia")).toBe(0);
    expect(
      countPriorRouterComments(
        [{ user: { login: "x" }, body: "unrelated" }],
        "nadia",
      ),
    ).toBe(0);
  });

  it("counts per-agent (Dario's comments don't bump Nadia's count)", () => {
    const comments = [
      { user: { login: "x" }, body: "**Dario — cycle 1 of ≤ 7.**\n\nA." },
      { user: { login: "x" }, body: "**Dario — cycle 2 of ≤ 7.**\n\nB." },
    ];
    expect(countPriorRouterComments(comments, "nadia")).toBe(0);
    expect(countPriorRouterComments(comments, "dario")).toBe(2);
  });
});

describe("formatRoutingComment", () => {
  const cfg = { cycle_cap: 7, sign_off_persona: "Nadia" };
  const route = {
    summary: "Adds X.",
    reviewers: [
      { persona: "dario", lens: "architecture", rationale: "touches lambdas/" },
      { persona: "ren", lens: "engineering", rationale: "run_locally=true" },
    ],
    skipped: ["aoi"],
    skip_rationale: "no UI surface",
  };

  it("opens with the persona-cycle header", () => {
    const out = formatRoutingComment(route, 1, cfg, "nadia");
    expect(out.startsWith("**Nadia — cycle 1 of ≤ 7.**")).toBe(true);
  });

  it("lists each reviewer as `**@persona** — rationale`", () => {
    const out = formatRoutingComment(route, 1, cfg, "nadia");
    expect(out).toContain("- **@dario** — touches lambdas/");
    expect(out).toContain("- **@ren** — run_locally=true");
  });

  it("includes the skip clause when skipped[] is non-empty", () => {
    const out = formatRoutingComment(route, 1, cfg, "nadia");
    expect(out).toContain("Skipping @aoi — no UI surface.");
  });

  it("omits the skip clause when skipped[] is empty", () => {
    const out = formatRoutingComment({ ...route, skipped: [] }, 1, cfg, "nadia");
    expect(out).not.toContain("Skipping");
  });

  it("closes with the persona signature + skill spec pointer", () => {
    const out = formatRoutingComment(route, 1, cfg, "nadia");
    expect(out).toContain(
      "— Nadia (LLM persona via Lambda; see workforce/docs/routines/pr-route.md)",
    );
  });

  it("uses the default cycle cap when binding_config omits it", () => {
    const out = formatRoutingComment(route, 1, {}, "nadia");
    expect(out).toContain("cycle 1 of ≤ 7");
  });

  it("reflects the supplied cycle number", () => {
    const out = formatRoutingComment(route, 3, cfg, "nadia");
    expect(out).toContain("**Nadia — cycle 3 of ≤ 7.**");
    expect(out).toContain("**Cycle 3 of ≤ 7.**");
  });
});
