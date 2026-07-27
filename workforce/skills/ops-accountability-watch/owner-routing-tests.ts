// @ts-nocheck — the module under test (owner-routing.mjs) is a
// dependency-free ESM script, not TS; vitest/esbuild imports it fine at
// runtime. Discovered by workforce/lambdas/vitest.config.mjs
// (`include: ["../skills/**/*-tests.ts"]`), so `cd workforce/lambdas && npm test` runs it.
import { describe, it, expect } from "vitest";
import { routeWorkflowOwner, routeGovernanceRegistryOwner, DEFAULT_OWNER } from "./owner-routing.mjs";

describe("routeWorkflowOwner — mechanical, never falls back to a nameless owner", () => {
  it("routes workforce-prefixed workflows to dario (VP Engineering Excellence)", () => {
    expect(routeWorkflowOwner("workforce-pr-terminal-sweep.yml").owner).toBe("dario");
    expect(routeWorkflowOwner("workforce-record-engagement.yml").owner).toBe("dario");
  });

  it("routes named workforce-engineering workflows (no prefix) to dario", () => {
    for (const name of ["ci.yml", "check-workforce-api-routes.yml", "deploy-workforce-console.yml", "deploy-workforce-data-plane.yml"]) {
      expect(routeWorkflowOwner(name).owner).toBe("dario");
    }
  });

  it("routes the article publish pipeline to elena", () => {
    expect(routeWorkflowOwner("deploy-article-site.yml").owner).toBe("elena");
    expect(routeWorkflowOwner("weekly-content-insights.yml").owner).toBe("elena");
  });

  it("routes the podcast pipeline to odette", () => {
    expect(routeWorkflowOwner("podcast-pipeline.yml").owner).toBe("odette");
  });

  it("falls back to the named default owner — never a bare/empty owner — for an unrecognised workflow", () => {
    const routed = routeWorkflowOwner("some-brand-new-workflow.yml");
    expect(routed.owner).toBe(DEFAULT_OWNER);
    expect(routed.owner).not.toBe("");
    expect(routed.reason).toMatch(/no specific routing rule matched/);
  });

  it("throws on a missing/empty workflow name rather than guessing", () => {
    expect(() => routeWorkflowOwner("")).toThrow();
    expect(() => routeWorkflowOwner(undefined)).toThrow();
  });

  it("every rule and the default resolve to a real, non-empty slug", () => {
    const names = [
      "workforce-x.yml",
      "ci.yml",
      "deploy-article-site.yml",
      "podcast-pipeline.yml",
      "totally-unknown.yml",
    ];
    for (const name of names) {
      const routed = routeWorkflowOwner(name);
      expect(typeof routed.owner).toBe("string");
      expect(routed.owner.length).toBeGreaterThan(0);
    }
  });
});

describe("routeGovernanceRegistryOwner", () => {
  it("routes to the default VP Operations owner with a stated reason", () => {
    const routed = routeGovernanceRegistryOwner();
    expect(routed.owner).toBe(DEFAULT_OWNER);
    expect(routed.reason.length).toBeGreaterThan(0);
  });
});
