// budget-runway.ts — does an agent's cap actually cover what its bindings are
// modelled to burn in a month? (ML-038)
//
// Why this exists. #661 made the W-3 cap real: the orchestrator now charges
// `estimateFireCostUsd(skill)` per dispatched fire and refuses to dispatch
// once the month's modelled spend would cross `effectiveBudgetUsd(agent)`.
// The per-agent caps it started enforcing were set in the era when the ledger
// always read zero — none was ever sized against the bindings' fire cadence.
// Nadia carries two 4×/day medium legs (pr-autopilot on two projects), a
// daily large leg and three more: ~USD 2.50/day modelled against a USD 8 cap.
// The gate went live 2026-09-09; her last fire was 2026-09-11T03:30Z. Every
// tick after that skipped all six of her bindings with a CloudWatch WARN and
// nothing else — the PR router, the author lane (ren, capped 09-13) and the
// article pipeline (ingrid, capped 09-09) all stopped, and nine open PRs sat
// unrouted with no surface saying why.
//
// A cap below the modelled burn is not a budget. It is a kill switch with a
// date on it. This module computes the date so the write boundary can refuse
// to create that state (`W3-runway` in agent-config.ts) and an audit can name
// every agent already in it (workforce/scripts/check-budget-runway.mjs).
//
// Pure: no AWS, no environment. Mirrored in workforce/scripts/lib/budget-runway.mjs
// for the in-repo audit script (which cannot import TypeScript); the parity
// fixture in budget-runway-parity-tests.ts keeps the two counters equal.

import { countFires } from "./cron-match.js";
import { isOrchestratorOwnedCcr, type AgentBinding } from "./agent.js";
import { estimateFireCostUsd } from "./fire-cost-estimate.js";

/** A fixed 30-day reference window so the estimate is a property of the
 *  schedule, not of the day it was computed: a `1 * ? *` monthly cron counts
 *  as 1 whether it is checked on the 2nd or the 30th, and a weekday-only cron
 *  counts the same 22 fires every time. Starts on a Monday. */
export const RUNWAY_WINDOW_DAYS = 30;
export const RUNWAY_WINDOW_START = new Date("2026-06-01T00:00:00Z");
export const RUNWAY_WINDOW_END = new Date(RUNWAY_WINDOW_START.getTime() + RUNWAY_WINDOW_DAYS * 86_400_000);

export interface BindingBurn {
  skill: string;
  project_id?: string;
  cron?: string;
  /** Fires the orchestrator would dispatch in the reference window. 0 for a
   *  binding it does not own (its scheduler charges nothing to this ledger)
   *  and for a cron it cannot evaluate (which it therefore never fires). */
  fires_per_month: number;
  usd_per_fire: number;
  usd_per_month: number;
}

export interface MonthlyBurn {
  total_usd: number;
  per_binding: BindingBurn[];
}

export interface BudgetRunway extends MonthlyBurn {
  cap_usd: number;
  /** burn / cap; > 1 means the cap runs out inside the month. */
  ratio: number;
  fits: boolean;
  /** The day of the month on which, at this burn rate, the orchestrator
   *  starts refusing this agent's fires. Null when the cap fits. */
  cap_reached_on_day: number | null;
}

/** Fires the ORCHESTRATOR would dispatch for this binding in the reference
 *  window — the only fires the ledger is charged for. */
export function bindingFiresPerMonth(binding: AgentBinding): number {
  if (!isOrchestratorOwnedCcr(binding)) return 0;
  const cron = binding.trigger?.cron;
  if (typeof cron !== "string" || cron.length === 0) return 0;
  try {
    return countFires(cron, RUNWAY_WINDOW_START, RUNWAY_WINDOW_END);
  } catch {
    // The tick throws on the same expression and skips the binding, so a
    // cron the engine cannot evaluate genuinely burns nothing. The shape
    // error itself is validateBinding's to report, not this estimate's.
    return 0;
  }
}

export function modelledMonthlyBurn(bindings: readonly AgentBinding[]): MonthlyBurn {
  const per_binding = bindings.map((b): BindingBurn => {
    const fires_per_month = bindingFiresPerMonth(b);
    const usd_per_fire = estimateFireCostUsd(b.skill);
    return {
      skill: b.skill,
      project_id: b.project_id,
      cron: b.trigger?.cron,
      fires_per_month,
      usd_per_fire,
      usd_per_month: round2(fires_per_month * usd_per_fire),
    };
  });
  return {
    total_usd: round2(per_binding.reduce((a, b) => a + b.usd_per_month, 0)),
    per_binding,
  };
}

export function budgetRunway(bindings: readonly AgentBinding[], capUsd: number): BudgetRunway {
  const burn = modelledMonthlyBurn(bindings);
  const ratio = capUsd > 0 ? burn.total_usd / capUsd : Number.POSITIVE_INFINITY;
  const fits = burn.total_usd <= capUsd;
  return {
    ...burn,
    cap_usd: capUsd,
    ratio,
    fits,
    // Day on which cumulative burn first exceeds the cap, at a uniform daily
    // rate. Day 1 = the first of the month; a burn of 2.5/day against 8 is
    // spent during day 4, which is the day the fires stop.
    cap_reached_on_day: fits || burn.total_usd <= 0 ? null : Math.max(1, Math.ceil(capUsd / (burn.total_usd / RUNWAY_WINDOW_DAYS))),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
