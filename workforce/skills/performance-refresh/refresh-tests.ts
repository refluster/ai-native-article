import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain .mjs sibling, no type declarations
import { digestOutput } from "./refresh.mjs";

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
