// ISO-8601 timestamp guard for ledger writes.
//
// EXEC rows key GSI1/GSI2 on `started_at` and every reader (/stats, the
// public summary, the SPA) compares it lexicographically against
// `new Date().toISOString()` bounds and feeds it to `new Date()`. A
// non-timestamp value ("x") sorts above every real ISO string, so it lands
// inside every `from=` window forever, wins every "latest run" pick, and
// crashed the console's /agents page with `RangeError: Invalid time value`
// (2026-11-10). Reject it at the write boundary (W-4) instead.

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** True when `v` is a full ISO-8601 date-time (with zone) that parses to a real instant. */
export function isIsoTimestamp(v: unknown): v is string {
  return typeof v === "string" && ISO_8601.test(v) && Number.isFinite(Date.parse(v));
}
