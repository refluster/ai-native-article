#!/usr/bin/env node
// ops-accountability-watch/owner-routing.mjs — mechanical owner resolution.
//
// The point of this module is to remove judgment from "who gets this
// finding" (design intent: never let a scheduled sweep default every
// anomaly onto one generic "CI person" — that just moves the silent-owner
// problem one level down). Routing is a plain lookup over real domain
// ownership already on record in this repo (workforce persona roles,
// docs/hires/*.md), not a heuristic the LLM improvises per fire.
//
// Dependency-free and pure so collect.mjs / sync-issues.mjs / notify.mjs and
// the test suite all import it without a network or filesystem dependency.
// Fail loud (C-4): an unrouteable finding kind is a thrown Error, never a
// silently-invented owner.

// Catch-all named owner. Never "the CI team" / "whoever's on call" — a real
// slug, so an unmatched finding still lands on someone's desk.
export const DEFAULT_OWNER = "petra";

// workflow filename -> owner slug. Matched against the GitHub Actions
// workflow_id/path basename (e.g. "deploy-article-site.yml"). Ordered;
// first match wins.
const WORKFLOW_OWNER_RULES = Object.freeze([
  {
    id: "workforce-engineering-surface",
    test: (name) =>
      /^workforce-/.test(name) ||
      [
        "ci.yml",
        "check-workforce-api-routes.yml",
        "deploy-workforce-console.yml",
        "deploy-workforce-data-plane.yml",
      ].includes(name),
    owner: "dario",
    reason: "workforce engineering surface (VP, Engineering Excellence)",
  },
  {
    id: "article-publish-pipeline",
    test: (name) => ["deploy-article-site.yml", "weekly-content-insights.yml"].includes(name),
    owner: "elena",
    reason: "article publish/content pipeline (article-level2/3 cadence owner)",
  },
  {
    id: "podcast-channel",
    test: (name) => name === "podcast-pipeline.yml",
    owner: "odette",
    reason: "podcast channel production (Podcast Producer / Narration & Voice Casting)",
  },
]);

/**
 * Resolve the accountable owner for a GitHub Actions workflow file.
 * @param {string} workflowFileName e.g. "deploy-article-site.yml"
 * @returns {{ owner: string, reason: string, ruleId: string }}
 */
export function routeWorkflowOwner(workflowFileName) {
  if (typeof workflowFileName !== "string" || workflowFileName.length === 0) {
    throw new Error("routeWorkflowOwner: workflowFileName must be a non-empty string");
  }
  for (const rule of WORKFLOW_OWNER_RULES) {
    if (rule.test(workflowFileName)) {
      return { owner: rule.owner, reason: rule.reason, ruleId: rule.id };
    }
  }
  return {
    owner: DEFAULT_OWNER,
    reason: `no specific routing rule matched "${workflowFileName}" — landed on the named catch-all (VP, Operations & Reliability), not left unowned`,
    ruleId: "default-catch-all",
  };
}

/**
 * Owner for the governance-registry freshness signal (docs/memory-lint-backlog.md
 * entries stuck in "watching"). This is a process-health signal, not a code
 * surface, so it always routes to the VP who owns operational reliability.
 * @returns {{ owner: string, reason: string, ruleId: string }}
 */
export function routeGovernanceRegistryOwner() {
  return {
    owner: DEFAULT_OWNER,
    reason: "governance registry process health (docs/memory-lint-backlog.md ratchet) is the VP Operations mandate",
    ruleId: "governance-registry",
  };
}

export const _WORKFLOW_OWNER_RULES_FOR_TEST = WORKFLOW_OWNER_RULES;
