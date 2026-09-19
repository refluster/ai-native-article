// perf-provenance.mjs — the ONE writer-boundary guard #505 asked for.
//
// #498 (`wf:hana` H2) and #503 (`fetchCodeFrequency` reading GitHub's `200`
// with an empty array as "this repo genuinely had zero churn") are the same
// bug twice: a fetch path degrades, the writer never learns, and an all-zero
// PERF#{scope} row is persisted with nothing to say it is an undercount
// rather than a real low. #504 fixed the retry budget on the one path that
// broke; it does nothing for the next fetch path nobody has written yet.
//
// Dario's proposed boundary (filed as #505): the check belongs at the
// WRITER — the point where a PERF#{scope} row is persisted — not re-derived
// per fetch. This module is that one check, shared by every PERF#{scope}
// writer (today: build-repo-performance.mjs's /REPO row, build-pr-metrics-
// github.mjs's /PR row).
//
// The caveat that makes or breaks this (also dario's, quoted verbatim in
// #505): a guard that only rejects zeros pushes people to route around it by
// writing `partial: true` everywhere, which makes the deck LESS honest. So a
// genuinely-measured zero needs a path that is exactly as easy to write as
// the "unknown" path. Every current call site already computes a per-signal
// `partial` flag when it fetches (searchAll, fetchCodeFrequency, the
// PR-detail fetch loop) — this guard asks the caller to plumb that
// already-computed signal straight through as `unmeasured`, the metric names
// it could NOT confirm this run, rather than inventing new bookkeeping. A
// zero metric NOT named in `unmeasured` is a *measured* zero (real data came
// back and it really was zero, or the metric was never subject to a fetch
// that can degrade) and publishes exactly as it does today — a writer that
// already reports its own degraded signals correctly (which both current
// writers do) sees no behaviour change. The guard only refuses the row a
// FUTURE fetch path would otherwise publish silently if it forgot to mark
// what it could not confirm.

/** Thrown by `assertProvenance` — a distinct class so a caller (or a test)
 *  can tell "refused, no provenance" apart from any other failure. */
export class UnprovenanceError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnprovenanceError";
  }
}

/**
 * Refuse to publish a PERF#{scope} row whose headline metrics are ALL zero
 * when one or more of those zeros is a metric the caller could not actually
 * confirm this run. Throws `UnprovenanceError` in that case; otherwise
 * returns undefined (publish as-is).
 *
 * A row with even one nonzero metric always publishes, and an all-zero row
 * where every zero metric is confirmed (`unmeasured` is empty, or names only
 * metrics that came back nonzero) always publishes too — this guard exists
 * for the specific shape of the #498/#503 bug (every number reads zero
 * because nothing arrived, not because nothing happened), not as a general
 * "activity" gate.
 *
 * @param {{ scope: string, sk: string, metrics: Record<string, number>, unmeasured?: string[] }} args
 *   - metrics: the row's own headline counters (e.g. `{ total_prs, total_additions }`
 *     or `{ issues_opened, prs_closed, ... }`) — plain numbers, already summed.
 *   - unmeasured: names (matching `metrics`' keys) the caller could NOT
 *     positively confirm this run — a fetch that failed, timed out, or hit a
 *     cold cache. Reuse the `partial` / `degraded_signals` flag already
 *     computed at the fetch site; do not re-derive it from the numbers.
 */
export function assertProvenance({ scope, sk, metrics, unmeasured = [] }) {
  const keys = Object.keys(metrics ?? {});
  if (keys.length === 0) return; // nothing to be honest or dishonest about
  const allZero = keys.every((k) => Number(metrics[k] ?? 0) === 0);
  if (!allZero) return;
  const unaccounted = keys.filter((k) => unmeasured.includes(k));
  if (unaccounted.length === 0) return; // every zero was positively measured
  throw new UnprovenanceError(
    `PERF#${scope}/${sk}: refusing to publish an all-zero row with no provenance ` +
      `(${unaccounted.join(", ")} read zero and the fetch that produced ${unaccounted.length === 1 ? "it" : "them"} ` +
      `could not be confirmed this run). Either the fetch degraded silently — that is expected, but say so by ` +
      `leaving it out of \`unmeasured\` only once it is genuinely confirmed — or this really is a quiet window, ` +
      `in which case the fetch itself should report \`partial: false\` so it never reaches \`unmeasured\` (#505).`,
  );
}
