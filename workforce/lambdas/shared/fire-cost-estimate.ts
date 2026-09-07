// fire-cost-estimate.ts — what one CCR fire is *modelled* to cost.
//
// Why an estimate and not a measurement: since ADR-0005 the org's own cadences
// run as CCR routines, and the LLM call happens inside the CCR session. The
// data plane never sees a token. So `recordSpend` — which the LLM call site is
// supposed to drive — is reachable only from `memory-compactor` and
// `tools-api`, and every agent's BUDGET# row reads zero while the agent is
// demonstrably working (issue #661; silas 2026-09, Maya 2026-09 §3).
//
// A dead gauge is worse than an honest approximate one. Silas reasoned about
// the org's cost constraint *from* those zeroes and said so in the letter. So
// the orchestrator — which knows every fire it dispatches — posts a modelled
// cost per fire, kept in a field that can never be mistaken for a measurement.
//
// The numbers are NOT invented here. They are the org's own declared model,
// already carried by every skill's `cost_class` and documented in
// workforce/scripts/schemas/skill-meta.schema.json:
//
//     "Projected per-invocation cost. small ~$0.05, medium ~$0.20, large ~$0.60."
//
// If those figures are wrong, the fix is to correct them in one place and let
// every consumer follow — which is the point of putting them here rather than
// in a comment.

import { SKILL_COST_CLASS } from "./skill-registry-generated.js";

export type CostClass = "small" | "medium" | "large";

/** USD per invocation, per cost class. The schema's declared model. */
export const COST_CLASS_USD: Readonly<Record<CostClass, number>> = {
  small: 0.05,
  medium: 0.2,
  large: 0.6,
};

/** What an unknown skill costs. Deliberately the most expensive class: an
 *  unmodelled fire must not look cheaper than a modelled one, or the ledger
 *  drifts optimistic exactly where we know least — the same "status is only
 *  stamped on the happy path" bias delphine named in 2026-08. */
export const UNKNOWN_SKILL_USD = COST_CLASS_USD.large;

/**
 * Modelled cost of one fire of `skill`, in USD.
 * Never throws: an unknown skill returns the conservative default.
 */
export function estimateFireCostUsd(skill: string): number {
  const klass = SKILL_COST_CLASS[skill];
  if (klass && klass in COST_CLASS_USD) return COST_CLASS_USD[klass as CostClass];
  return UNKNOWN_SKILL_USD;
}
