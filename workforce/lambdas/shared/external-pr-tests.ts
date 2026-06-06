// Tests for external-pr.ts (Phase 7 PR6 scaffold).
//
// Two narrow assertions for the scaffold-stage commit:
//
//   1. The branch-name helper produces the exact canonical contract
//      string (`workforce/{agent_slug}/{run_id}`). External
//      maintainers' branch-protection rules depend on this prefix;
//      any drift here silently breaks their CI exclusion patterns.
//
//   2. Calling the placeholder `openExternalPr` throws an
//      ExternalPrNotImplementedError that names the caller — W-4 fail-
//      loud. A silent no-op would produce an engagement record
//      referencing a non-existent PR; the explicit throw is the safety
//      net while the helper is unwired.

import { describe, expect, it } from "vitest";
import {
  ExternalPrNotImplementedError,
  externalPrBranchName,
  openExternalPr,
} from "./external-pr.js";

describe("externalPrBranchName", () => {
  it("produces the canonical workforce/{agent}/{run_id} contract", () => {
    expect(externalPrBranchName("nadia", "01HX5Y8Z9A0B1C2D3E4F5G6H7J")).toBe(
      "workforce/nadia/01HX5Y8Z9A0B1C2D3E4F5G6H7J",
    );
  });

  it("doesn't quote or escape inputs (callers pass already-validated values)", () => {
    expect(externalPrBranchName("dario", "deadbeef")).toBe(
      "workforce/dario/deadbeef",
    );
  });
});

describe("openExternalPr (scaffold)", () => {
  const validInput = {
    project_id: "asp-cloud",
    agent_slug: "nadia",
    skill_name: "market-research",
    run_id: "01HX5Y8Z9A0B1C2D3E4F5G6H7J",
    path: "docs/research/2026-06-06-test.md",
    body: "# Market research\n\n...\n",
    github: { token: "ghp_test_placeholder" },
  };

  it("throws ExternalPrNotImplementedError — W-4 fail-loud while the git-data REST sequence is unwired", async () => {
    await expect(openExternalPr(validInput)).rejects.toBeInstanceOf(
      ExternalPrNotImplementedError,
    );
  });

  it("the thrown error names the caller — agent + skill + project + run_id", async () => {
    try {
      await openExternalPr(validInput);
      expect.fail("openExternalPr should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ExternalPrNotImplementedError);
      const msg = (err as Error).message;
      expect(msg).toContain("agent=nadia");
      expect(msg).toContain("skill=market-research");
      expect(msg).toContain("project=asp-cloud");
      expect(msg).toContain("run_id=01HX5Y8Z9A0B1C2D3E4F5G6H7J");
    }
  });

  it("the thrown error explains the R-N9 schema gate is intact (the value PR6 delivers)", async () => {
    try {
      await openExternalPr(validInput);
      expect.fail("openExternalPr should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain(
        "R-N9 schema gate is enforced",
      );
    }
  });
});
