// Defensive ISO timestamp formatting for API-sourced values.
//
// `new Date(bad).toISOString()` THROWS (`RangeError: Invalid time value`), and
// a throw during render unmounts the whole React tree. On 2026-11-10 one EXEC
// row with `started_at: "x"` reached /stats as an agent's last_run_at and
// blanked the /agents page. Values that come off the wire go through here so a
// malformed timestamp renders as a placeholder instead of taking the page down.

/**
 * Format an ISO-ish timestamp as UTC `YYYY-MM-DDTHH:MM…` truncated to `len`
 * characters (10 → date, 16 → minute). Returns `fallback` when the value is
 * missing or does not parse.
 */
export function fmtUtc(value: string | number | null | undefined, len = 16, fallback = '—'): string {
  if (value === null || value === undefined || value === '') return fallback;
  const t = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(t)) return fallback;
  return new Date(t).toISOString().slice(0, len);
}
