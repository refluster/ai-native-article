// EventBridge cron expression matcher.
//
// The orchestrator-tick (Epic-006 S1) runs every 2 hours and asks each
// agent: "did your cron fire in the last 120 minutes?" Each agent's
// schedule_cron lives in DDB; this module is the data-level evaluator.
//
// Supports the EventBridge form `cron(Minutes Hours DayOfMonth Month DayOfWeek Year)`.
// EventBridge uses ? for any-value on DoM/DoW (mutually exclusive with the
// other), comma-separated lists, ranges (-), step (/), and SUN/MON/.../SAT
// or 1-7 (1=SUN) day names. Year is optional in many forms but EventBridge
// requires all 6 fields.
//
// "Matches now" means: at least one minute in (now - windowMinutes, now]
// falls inside the cron schedule's fire times. The window is **past-facing**
// because each tick asks "what cron fires did I miss since the last tick?"
// — never "what's about to fire?". This used to be future-facing and the
// 30-minute discord-ping cron (`cron(0 0/6 * * ? *)`) was silently missed
// every cycle: a tick at 12:25 looked at [12:25, 12:55) which doesn't
// contain 12:00, and the next tick at 12:55 looked at [12:55, 13:25) which
// is even further past. Fixed in claude/lucid-feynman-cron-match-past-window.

const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export interface MatchOptions {
  /** Window size in minutes — must align with the orchestrator-tick rate. */
  windowMinutes: number;
}

/**
 * Returns true if the cron expression would fire at any minute in the
 * past window (now - windowMinutes, now]. Always evaluates in UTC, matching
 * how EventBridge interprets cron expressions.
 *
 * The window is past-facing (looks backward from `now`) because the
 * orchestrator tick fires at the *end* of each interval and asks "did I
 * miss anything?". Looking forward would make the tick a forecaster and
 * silently drop crons whose fire times fell between ticks.
 */
export function matchesNow(
  cronExpr: string,
  now: Date,
  opts: MatchOptions,
): boolean {
  const fields = parseCron(cronExpr);

  // Walk every minute in the past window (now, now-1min, ..., now-(W-1)min).
  // windowMinutes is small (120 at the 2-hourly tick) so this is trivially cheap. The first
  // iteration (i=0) sees `now` itself, so a cron firing exactly at this
  // minute is caught — even when ticks are slightly delayed.
  for (let i = 0; i < opts.windowMinutes; i++) {
    const t = new Date(now.getTime() - i * 60_000);
    if (firesAtMinute(fields, t)) return true;
  }
  return false;
}

/** The six EventBridge fields, validated once. Both evaluators below read
 *  the same parse so a cron the tick can fire and a cron the runway
 *  estimate can count are the same set by construction. */
export interface CronFields {
  minutes: string;
  hours: string;
  dom: string;
  month: string;
  dow: string;
  year: string;
}

export function parseCron(cronExpr: string): CronFields {
  const m = /^cron\((.+)\)$/.exec(cronExpr.trim());
  if (!m) throw new Error(`invalid cron expression "${cronExpr}"`);
  const fields = m[1]!.split(/\s+/);
  if (fields.length !== 6) {
    throw new Error(`cron expression must have 6 fields, got ${fields.length}: "${cronExpr}"`);
  }
  const [minutes, hours, dom, month, dow, year] = fields as [string, string, string, string, string, string];
  return { minutes, hours, dom, month, dow, year };
}

/** Does this schedule fire at exactly minute `t` (UTC)? The single
 *  fire-time predicate `matchesNow` (the tick) and `countFires` (the W-3
 *  runway estimate) share. */
export function firesAtMinute(f: CronFields, t: Date): boolean {
  const inMin = matchField(f.minutes, t.getUTCMinutes(), 0, 59);
  const inHour = matchField(f.hours, t.getUTCHours(), 0, 23);
  const inMonth = matchField(f.month, t.getUTCMonth() + 1, 1, 12);
  const inYear = matchField(f.year, t.getUTCFullYear(), 1970, 9999);
  if (!inMin || !inHour || !inMonth || !inYear) return false;
  const inDom = matchField(f.dom, t.getUTCDate(), 1, 31);
  const inDow = matchDow(f.dow, t.getUTCDay()); // JS getUTCDay: 0=Sun..6=Sat

  // EventBridge: DoM and DoW are mutually exclusive — one must be '?'.
  if (f.dom === "?") return inDow;
  if (f.dow === "?") return inDom;
  // Pre-2019 EventBridge or unusual: if neither '?', match if either.
  return inDom || inDow;
}

/**
 * How many times the schedule fires in [from, to), walking every minute.
 *
 * This is the modelled-burn half of the W-3 runway check (ML-038): the
 * orchestrator charges `estimateFireCostUsd(skill)` per dispatched fire, so an
 * agent's monthly burn is fires × cost — and a cap set below that number is a
 * kill switch with a date on it, not a budget. A 30-day window is 43,200
 * iterations of the same cheap field matches the tick runs 120 of; it is
 * meant for write-time validation and audits, not for a hot path.
 *
 * Throws on a malformed expression exactly as `matchesNow` does — a cron the
 * tick cannot evaluate is one it never fires, and the caller decides whether
 * that is "0 fires" or a validation error.
 */
export function countFires(cronExpr: string, from: Date, to: Date): number {
  const fields = parseCron(cronExpr);
  let n = 0;
  const start = Math.floor(from.getTime() / 60_000) * 60_000;
  for (let ms = start; ms < to.getTime(); ms += 60_000) {
    if (firesAtMinute(fields, new Date(ms))) n++;
  }
  return n;
}

function matchField(field: string, value: number, min: number, max: number): boolean {
  if (field === "*" || field === "?") return true;
  return field.split(",").some((part) => matchRange(part, value, min, max));
}

function matchRange(part: string, value: number, min: number, max: number): boolean {
  // "x/y": step from x to max with step y. "x-y/z": step from x to y with step z.
  let stepStr: string | undefined;
  let base = part;
  if (part.includes("/")) {
    [base, stepStr] = part.split("/", 2) as [string, string];
  }
  const step = stepStr ? parseInt(stepStr, 10) : 1;
  if (!Number.isFinite(step) || step <= 0) return false;

  let lo: number;
  let hi: number;
  if (base === "*") {
    lo = min;
    hi = max;
  } else if (base.includes("-")) {
    const [a, b] = base.split("-", 2) as [string, string];
    lo = parseInt(a, 10);
    hi = parseInt(b, 10);
  } else {
    lo = parseInt(base, 10);
    // `x/y` (single base + step) means "start at x, step by y up to max"
    // per cron spec — e.g. `0/6` in hours matches {0, 6, 12, 18}, not just 0.
    // Without a step, `x` alone matches only x.
    hi = stepStr !== undefined ? max : lo;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;

  if (value < lo || value > hi) return false;
  return (value - lo) % step === 0;
}

function matchDow(field: string, jsDay: number): boolean {
  if (field === "*" || field === "?") return true;
  // EventBridge DoW: 1-7 = SUN..SAT, or SUN/MON/.../SAT.
  // Normalise both to 1-7 (1=SUN).
  const target = jsDay + 1; // JS 0=Sun -> 1=Sun
  return field.split(",").some((part) => {
    const normalised = part.replace(/\b(SUN|MON|TUE|WED|THU|FRI|SAT)\b/gi, (m) =>
      String(DAY_NAMES.indexOf(m.toUpperCase()) + 1),
    );
    return matchRange(normalised, target, 1, 7);
  });
}
