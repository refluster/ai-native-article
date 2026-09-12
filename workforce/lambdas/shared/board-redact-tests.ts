// Unit tests for shared/board-redact.ts — the runtime confidentiality
// backstop on the Q&A boards (ADR-0034).

import { describe, expect, it } from "vitest";

import {
  EXTERNAL_PROJECT_PLACEHOLDER,
  isInternalProjectId,
  normaliseProjectTerms,
  redactCodeHosting,
  redactExternalProjects,
  redactFounder,
  redactForBoard,
} from "./board-redact.js";

const TERMS = normaliseProjectTerms(["asp-cloud", "ASP Cloud", "PSVL/asp-cloud", "luckyhat", "LuckyHat", "project-ind", "Project IND"]);

describe("normaliseProjectTerms / isInternalProjectId", () => {
  it("dedupes, drops short or missing terms, sorts longest first", () => {
    expect(normaliseProjectTerms(["ab", undefined, null, " asp-cloud ", "asp-cloud", "Project IND", "conference", "Conference"])).toEqual([
      "Project IND",
      "asp-cloud",
    ]);
  });
  it("treats self/* and agent-workforce as internal", () => {
    expect(isInternalProjectId("self/maya")).toBe(true);
    expect(isInternalProjectId("agent-workforce")).toBe(true);
    expect(isInternalProjectId("asp-cloud")).toBe(false);
  });
});

describe("redactExternalProjects", () => {
  it("replaces ids, display names and repo slugs, case-insensitively, as whole tokens", () => {
    const out = redactExternalProjects("I reviewed PRs on asp-cloud (ASP Cloud) and PSVL/asp-cloud; also LuckyHat.", TERMS);
    expect(out).not.toMatch(/asp-cloud|ASP Cloud|LuckyHat/i);
    expect(out.split(EXTERNAL_PROJECT_PLACEHOLDER).length - 1).toBe(4);
  });
  it("also covers unnamed client topics, in either language", () => {
    const out = redactExternalProjects("the India desk and スマートメーターの分析", TERMS);
    expect(out).not.toMatch(/India|スマートメーター/);
  });

  it("leaves unrelated words and internal projects alone", () => {
    expect(redactExternalProjects("agent-workforce and self/maya are internal; industry stays", TERMS)).toBe(
      "agent-workforce and self/maya are internal; industry stays",
    );
  });
});

describe("redactCodeHosting", () => {
  it("strips URLs, repo slugs, PR/issue refs, file names and github", () => {
    const out = redactCodeHosting(
      "See https://github.com/refluster/ai-native-article/pull/717 or refluster/ai-native-article (PR #717, issue #42) in workforce/lambdas/board-reply/handler.ts and ci.yml on GitHub.",
    );
    expect(out).not.toMatch(/https?:|refluster|#717|#42|handler\.ts|ci\.yml|github/i);
    expect(out).toContain("the repository");
    expect(out).toContain("(a file in the codebase)");
    expect(out).toContain("the code host");
  });
});

describe("redactFounder", () => {
  it("replaces the personal domain and name", () => {
    expect(redactFounder("Koh Uehara runs workforce.kohuehara.xyz; 上原さんの判断です")).toBe(
      "the founder runs the site; the founderさんの判断です",
    );
  });
});

describe("redactForBoard", () => {
  it("applies all classes and reports which fired", () => {
    const r = redactForBoard("Ask Koh Uehara about asp-cloud on github", TERMS);
    expect(r.text).toBe(`Ask the founder about ${EXTERNAL_PROJECT_PLACEHOLDER} on the code host`);
    expect(r.hits).toEqual(["external_project", "code_hosting", "founder"]);
  });
  it("reports no hits on clean text", () => {
    const r = redactForBoard("エージェント組織はどう回っていますか？", TERMS);
    expect(r.hits).toEqual([]);
    expect(r.text).toBe("エージェント組織はどう回っていますか？");
  });
});
