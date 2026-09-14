import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain .mjs sibling, no type declarations
import { collapseByRepo, digestOutput } from "./refresh.mjs";

// Production 2026-09-13: the repo roll-up leg published DEGRADED because every
// project's code_frequency call came back 403 rate-limited — and the run log
// showed none of it. `run()` kept the last three lines, which were the leg's
// epilogue ("published 5 rows"), so the operator-visible warning named the one
// unrelated cause that happened to log last. The digest has to survive the
// truncation it exists to apply.
describe("digestOutput", () => {
  it("keeps the diagnostic lines and drops a quiet epilogue", () => {
    const stderr = [
      "refluster/ai-native-article: code_frequency -> HTTP 403 RATE-LIMITED",
      "PSVL/asp-cloud: code_frequency -> HTTP 403 RATE-LIMITED",
      "resolving github.token...",
      "wrote 5 rows",
      "published 5 PERF#{scope}/REPO row(s) to wf-table-prod",
    ].join("\n");
    const d = digestOutput(stderr);
    expect(d).toContain("refluster/ai-native-article: code_frequency -> HTTP 403");
    expect(d).toContain("PSVL/asp-cloud: code_frequency -> HTTP 403");
    expect(d).not.toContain("wrote 5 rows");
  });

  it("falls back to the tail when nothing in the output is diagnostic", () => {
    const d = digestOutput("a\nb\nc\nd\ne\nf\ng\nh");
    expect(d).toBe("c | d | e | f | g | h");
  });

  it("caps the digest even when every line is loud", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `repo-${i}: code_frequency -> HTTP 403`);
    expect(digestOutput(lines.join("\n")).split(" | ")).toHaveLength(6);
  });

  it("returns an empty string for empty or missing output", () => {
    expect(digestOutput("")).toBe("");
    expect(digestOutput(undefined)).toBe("");
  });
});

// Production 2026-09-13: `workforce` and `agent-workforce` name the SAME repo
// over the same window and store byte-identical bodies under different `pk`s,
// yet each was built from scratch — about 3460 of the run's ~5330 GitHub core
// calls, spent to compute the same answer twice, against a 5000/h quota. That
// duplication alone is the difference between fitting in the budget and not.
describe("collapseByRepo", () => {
  it("folds scopes sharing a repo and credential into one build", () => {
    const groups = collapseByRepo([
      { scope: "workforce", repo: "r/one", tokenProject: "agent-workforce" },
      { scope: "agent-workforce", repo: "r/one", tokenProject: "agent-workforce" },
      { scope: "asp-cloud", repo: "r/two", tokenProject: "asp-cloud" },
    ]);
    expect(groups).toHaveLength(2);
    // The first scope of a group stays primary — the console's default deck
    // reads `workforce`, so it must not become the mirror.
    expect(groups[0]).toMatchObject({ scope: "workforce", alsoScopes: ["agent-workforce"] });
    expect(groups[1]).toMatchObject({ scope: "asp-cloud", alsoScopes: [] });
  });

  it("does NOT fold scopes that share a repo but not the credential", () => {
    const groups = collapseByRepo([
      { scope: "a", repo: "r/one", tokenProject: "a" },
      { scope: "b", repo: "r/one", tokenProject: "b" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g: { alsoScopes: string[] }) => g.alsoScopes.length === 0)).toBe(true);
  });

  it("leaves a list of distinct repos untouched", () => {
    const scopes = [
      { scope: "a", repo: "r/one", tokenProject: "a" },
      { scope: "b", repo: "r/two", tokenProject: "b" },
    ];
    expect(collapseByRepo(scopes).map((g: { scope: string }) => g.scope)).toEqual(["a", "b"]);
  });
});
