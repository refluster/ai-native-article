// The scrape window. Both ingest scripts back up a closed [since, until)
// interval, defaulting to "yesterday, UTC" so a daily cron run at any hour
// captures exactly one whole day and never a partial one.

const COMPACT = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/;

/**
 * Accepts either the compact `YYYYMMDDTHHMMSS` form inherited from the
 * luckyhat-ms scrapers (so an operator's existing runbook invocations keep
 * working) or any ISO-8601 string. Always interpreted as UTC.
 */
export function parseInstant(value, label) {
  const compact = COMPACT.exec(value);
  const iso = compact
    ? `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z`
    : value;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label}: not a valid instant: ${JSON.stringify(value)} (want YYYYMMDDTHHMMSS or ISO-8601)`);
  }
  return date;
}

/** Midnight UTC of the day containing `date`. */
export function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Resolve the window from explicit values, falling back to yesterday.
 * @returns {{since: Date, until: Date}}
 */
export function resolveWindow({ since, until, now = new Date() } = {}) {
  const todayStart = startOfUtcDay(now);
  const resolvedUntil = until ? parseInstant(until, "--until") : todayStart;
  const resolvedSince = since
    ? parseInstant(since, "--since")
    : new Date(resolvedUntil.getTime() - 86_400_000);

  if (resolvedSince >= resolvedUntil) {
    throw new Error(
      `empty window: since (${resolvedSince.toISOString()}) must be before until (${resolvedUntil.toISOString()})`,
    );
  }
  return { since: resolvedSince, until: resolvedUntil };
}

/** `2026-08-29` — the day a window belongs to, used for the day-log path. */
export function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

// Discord snowflakes embed a millisecond timestamp in their high bits. Turning
// the window bound into a snowflake lets us ask the API for messages `after=`
// a point in time, so a quiet channel costs one request instead of paging back
// through its whole history.
const DISCORD_EPOCH = 1_420_070_400_000n;

export function timestampToSnowflake(date) {
  const ms = BigInt(date.getTime()) - DISCORD_EPOCH;
  return ((ms < 0n ? 0n : ms) << 22n).toString();
}
