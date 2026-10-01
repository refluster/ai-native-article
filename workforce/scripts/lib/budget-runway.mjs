// budget-runway.mjs — plain-JS mirror of workforce/lambdas/shared/budget-runway.ts
// (+ the slice of cron-match.ts it needs), for scripts that cannot import
// TypeScript. Keep the arithmetic identical; budget-runway-parity-tests.ts in
// the lambdas tree asserts the two counters agree on a fixture of every cron
// shape the roster uses, so a drift here fails `npm test` there.
//
// Why the estimate exists at all: ML-038. The orchestrator charges a modelled
// cost per dispatched fire (fire-cost-estimate.ts) and refuses to dispatch past
// the agent's cap, so a cap below the bindings' modelled monthly burn is a kill
// switch with a date on it. This computes the date.

const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** USD per invocation, per declared cost class — the same table
 *  fire-cost-estimate.ts reads from the skill-meta schema. */
export const COST_CLASS_USD = Object.freeze({ small: 0.05, medium: 0.2, large: 0.6 });
/** An unmodelled skill is charged the most expensive class, as the Lambda does. */
export const UNKNOWN_SKILL_USD = COST_CLASS_USD.large;

export const RUNWAY_WINDOW_DAYS = 30;
export const RUNWAY_WINDOW_START = new Date("2026-06-01T00:00:00Z");
export const RUNWAY_WINDOW_END = new Date(RUNWAY_WINDOW_START.getTime() + RUNWAY_WINDOW_DAYS * 86_400_000);

export function parseCron(cronExpr) {
  const m = /^cron\((.+)\)$/.exec(String(cronExpr ?? "").trim());
  if (!m) throw new Error(`invalid cron expression "${cronExpr}"`);
  const fields = m[1].split(/\s+/);
  if (fields.length !== 6) {
    throw new Error(`cron expression must have 6 fields, got ${fields.length}: "${cronExpr}"`);
  }
  const [minutes, hours, dom, month, dow, year] = fields;
  return { minutes, hours, dom, month, dow, year };
}

function matchRange(part, value, min, max) {
  let stepStr;
  let base = part;
  if (part.includes("/")) [base, stepStr] = part.split("/", 2);
  const step = stepStr ? parseInt(stepStr, 10) : 1;
  if (!Number.isFinite(step) || step <= 0) return false;
  let lo;
  let hi;
  if (base === "*") {
    lo = min;
    hi = max;
  } else if (base.includes("-")) {
    const [a, b] = base.split("-", 2);
    lo = parseInt(a, 10);
    hi = parseInt(b, 10);
  } else {
    lo = parseInt(base, 10);
    hi = stepStr !== undefined ? max : lo;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
  if (value < lo || value > hi) return false;
  return (value - lo) % step === 0;
}

function matchField(field, value, min, max) {
  if (field === "*" || field === "?") return true;
  return field.split(",").some((part) => matchRange(part, value, min, max));
}

function matchDow(field, jsDay) {
  if (field === "*" || field === "?") return true;
  const target = jsDay + 1;
  return field.split(",").some((part) => {
    const normalised = part.replace(/\b(SUN|MON|TUE|WED|THU|FRI|SAT)\b/gi, (m) =>
      String(DAY_NAMES.indexOf(m.toUpperCase()) + 1),
    );
    return matchRange(normalised, target, 1, 7);
  });
}

export function firesAtMinute(f, t) {
  const inMin = matchField(f.minutes, t.getUTCMinutes(), 0, 59);
  const inHour = matchField(f.hours, t.getUTCHours(), 0, 23);
  const inMonth = matchField(f.month, t.getUTCMonth() + 1, 1, 12);
  const inYear = matchField(f.year, t.getUTCFullYear(), 1970, 9999);
  if (!inMin || !inHour || !inMonth || !inYear) return false;
  const inDom = matchField(f.dom, t.getUTCDate(), 1, 31);
  const inDow = matchDow(f.dow, t.getUTCDay());
  if (f.dom === "?") return inDow;
  if (f.dow === "?") return inDom;
  return inDom || inDow;
}

/** Fires in [from, to), walking every minute — same semantics as the TS. */
export function countFires(cronExpr, from, to) {
  const fields = parseCron(cronExpr);
  let n = 0;
  const start = Math.floor(from.getTime() / 60_000) * 60_000;
  for (let ms = start; ms < to.getTime(); ms += 60_000) {
    if (firesAtMinute(fields, new Date(ms))) n++;
  }
  return n;
}

/** The orchestrator's own gate (agent.ts isOrchestratorOwnedCcr): only these
 *  bindings are dispatched by the tick, so only these are charged. */
export function isOrchestratorOwnedCcr(binding) {
  return (
    binding?.executor === "claude-code-routine" &&
    binding?.trigger?.scheduler === "external" &&
    binding?.trigger?.invoked_by === "api"
  );
}

export function bindingFiresPerMonth(binding) {
  if (!isOrchestratorOwnedCcr(binding)) return 0;
  const cron = binding?.trigger?.cron;
  if (typeof cron !== "string" || cron.length === 0) return 0;
  try {
    return countFires(cron, RUNWAY_WINDOW_START, RUNWAY_WINDOW_END);
  } catch {
    return 0;
  }
}

/** @param {(skill: string) => string | undefined} costClassOf  skill → cost_class */
export function modelledMonthlyBurn(bindings, costClassOf) {
  const per_binding = (bindings ?? []).map((b) => {
    const fires_per_month = bindingFiresPerMonth(b);
    const klass = costClassOf(b.skill);
    const usd_per_fire = klass && klass in COST_CLASS_USD ? COST_CLASS_USD[klass] : UNKNOWN_SKILL_USD;
    return {
      skill: b.skill,
      project_id: b.project_id,
      cron: b?.trigger?.cron,
      cost_class: klass ?? "unknown",
      fires_per_month,
      usd_per_fire,
      usd_per_month: round2(fires_per_month * usd_per_fire),
    };
  });
  return { total_usd: round2(per_binding.reduce((a, b) => a + b.usd_per_month, 0)), per_binding };
}

export function budgetRunway(bindings, capUsd, costClassOf) {
  const burn = modelledMonthlyBurn(bindings, costClassOf);
  const ratio = capUsd > 0 ? burn.total_usd / capUsd : Number.POSITIVE_INFINITY;
  const fits = burn.total_usd <= capUsd;
  return {
    ...burn,
    cap_usd: capUsd,
    ratio,
    fits,
    cap_reached_on_day:
      fits || burn.total_usd <= 0 ? null : Math.max(1, Math.ceil(capUsd / (burn.total_usd / RUNWAY_WINDOW_DAYS))),
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
