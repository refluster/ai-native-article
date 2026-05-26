// EventBridge cron expression matcher.
//
// The orchestrator-tick (Epic-006 S1) runs every 5 minutes and asks each
// agent: "should you run in this 5-minute window?" Each agent's
// schedule_cron lives in DDB; this module is the data-level evaluator.
//
// Supports the EventBridge form `cron(Minutes Hours DayOfMonth Month DayOfWeek Year)`.
// EventBridge uses ? for any-value on DoM/DoW (mutually exclusive with the
// other), comma-separated lists, ranges (-), step (/), and SUN/MON/.../SAT
// or 1-7 (1=SUN) day names. Year is optional in many forms but EventBridge
// requires all 6 fields.
//
// "Matches now" means: at least one minute in [now, now + windowMinutes)
// falls inside the cron schedule's fire times.

const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export interface MatchOptions {
  /** Window size in minutes — must align with the orchestrator-tick rate. */
  windowMinutes: number;
}

/**
 * Returns true if the cron expression would fire at any minute in the
 * window [now, now + windowMinutes). Always evaluates in UTC, matching
 * how EventBridge interprets cron expressions.
 */
export function matchesNow(
  cronExpr: string,
  now: Date,
  opts: MatchOptions,
): boolean {
  const m = /^cron\((.+)\)$/.exec(cronExpr.trim());
  if (!m) throw new Error(`invalid cron expression "${cronExpr}"`);
  const fields = m[1]!.split(/\s+/);
  if (fields.length !== 6) {
    throw new Error(`cron expression must have 6 fields, got ${fields.length}: "${cronExpr}"`);
  }
  const [minutes, hours, dom, month, dow, year] = fields as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  // Walk every minute in the window. windowMinutes is small (5 in v1)
  // so this is trivially cheap.
  for (let i = 0; i < opts.windowMinutes; i++) {
    const t = new Date(now.getTime() + i * 60_000);
    const inMin = matchField(minutes, t.getUTCMinutes(), 0, 59);
    const inHour = matchField(hours, t.getUTCHours(), 0, 23);
    const inMonth = matchField(month, t.getUTCMonth() + 1, 1, 12);
    const inYear = matchField(year, t.getUTCFullYear(), 1970, 9999);
    const inDom = matchField(dom, t.getUTCDate(), 1, 31);
    const inDow = matchDow(dow, t.getUTCDay()); // JS getUTCDay: 0=Sun..6=Sat

    if (!inMin || !inHour || !inMonth || !inYear) continue;

    // EventBridge: DoM and DoW are mutually exclusive — one must be '?'.
    if (dom === "?") {
      if (inDow) return true;
    } else if (dow === "?") {
      if (inDom) return true;
    } else {
      // Pre-2019 EventBridge or unusual: if neither '?', match if either.
      if (inDom || inDow) return true;
    }
  }
  return false;
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
    hi = lo;
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
