// Run-duration formatters shared by the workforce console KPIs.
//
// The dashboard / crew / agent-profile surfaces report run DURATION as the
// spend-proxy metric: per-run token/cost usage is not observable from the
// CCR execution path (the agent's Claude Code session writes its EXEC row
// but has no access to its own usage), so duration — derivable from every
// row's started_at/ended_at — stands in for "how much compute did this
// cost" without fabricating a dollar/token figure.

/** A single run duration (seconds) → compact `Ns` / `Nm Ns`. */
export function fmtDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

/** A cumulative compute total (seconds) → `Nm` / `Nh Nm`. */
export function fmtCompute(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
