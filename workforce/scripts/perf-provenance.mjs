#!/usr/bin/env node
// Writer-boundary provenance guard for `PERF#{scope}` rows (issue #505).
//
// Two occurrences inside 90 days — #498 (`wf:hana` H2, a degraded read
// rendering as a real low) and #503 (`fetchCodeFrequency` reading GitHub's
// `200`-with-empty-array as "this repo genuinely had zero churn") — share one
// root cause: **conflating _no data_ with _data showing none_.** Both were
// fixed per-fetch, which is why #498's fix did not cover #503's branch.
//
// This guard moves the check to the one place every fetch path converges on:
// the point where a `PERF#{scope}` row is persisted. A zero metric may be
// published only when the row says which kind of zero it is:
//
//   - the signal is listed in `degraded_signals` — an honest unknown, **or**
//   - the signal is listed in `measured_zero`   — we looked, it really is zero.
//
// A zero carrying neither marker is refused.
//
// ## The caveat that makes or breaks it (`wf:dario`, #505)
//
//   > the guard has to distinguish *measured zero* from *unknown* — if it
//   > merely rejects zeros, teams will route around it by writing
//   > `partial: true` everywhere and the deck gets less honest, not more.
//
// So the `measured_zero` path must be as cheap to write as the degraded path,
// or the incentive runs backwards. Callers therefore do **not** hand-maintain
// it: `measuredZeroSignals()` derives it from the same per-signal `partial`
// bookkeeping the fetchers already do. A signal that was fetched cleanly and
// came back zero is a measured zero, for free. The only way to get a row
// rejected is to add a fetch path that tracks no provenance at all — which is
// exactly the failure this guard exists to catch.
//
// Scope: the `/REPO` and `/PR` row shapes (issue #505 "Scope"). The
// `/LIFECYCLE` roll-up is out of scope — it is derived from DDB rows the
// workforce itself wrote, not from a third-party API that can return an
// ambiguous empty.

export class PerfProvenanceError extends Error {
  constructor(message, { pk, sk, unprovenanced }) {
    super(message);
    this.name = "PerfProvenanceError";
    this.pk = pk;
    this.sk = sk;
    this.unprovenanced = unprovenanced;
  }
}

/**
 * Signals whose value is zero and which carry no provenance either way.
 *
 * @param {object} args
 * @param {Record<string, number>} args.metrics  signal name -> value
 * @param {string[]} [args.degraded_signals]     signals known to be undercounts
 * @param {string[]} [args.measured_zero]        signals fetched cleanly that really are zero
 * @returns {string[]} sorted signal names lacking provenance (empty = row is publishable)
 */
export function unprovenancedZeros({ metrics, degraded_signals = [], measured_zero = [] }) {
  const degraded = new Set(degraded_signals);
  const measured = new Set(measured_zero);
  return Object.entries(metrics ?? {})
    .filter(([, value]) => Number(value) === 0)
    .map(([signal]) => signal)
    .filter((signal) => !degraded.has(signal) && !measured.has(signal))
    .sort();
}

/**
 * Throw unless every zero in the row is provenanced. Call immediately before
 * the `PutCommand` that persists a `PERF#{scope}` row.
 *
 * Fail-loud by design (W-4): a false zero on the Repository Performance deck
 * is indistinguishable from a real low to every downstream reader, so the
 * write is refused rather than published with a caveat nobody reads.
 */
export function assertPerfProvenance({ pk, sk, metrics, degraded_signals, measured_zero }) {
  const unprovenanced = unprovenancedZeros({ metrics, degraded_signals, measured_zero });
  if (unprovenanced.length === 0) return;
  throw new PerfProvenanceError(
    `${pk}/${sk}: refusing to publish zero-valued signal(s) with no provenance: ` +
      `${unprovenanced.join(", ")}. Each zero must be listed in degraded_signals ` +
      `(an unknown) or measured_zero (a real zero we measured) — see workforce/scripts/perf-provenance.mjs.`,
    { pk, sk, unprovenanced },
  );
}

/**
 * Derive `measured_zero` from the per-signal `partial` bookkeeping a fetcher
 * already keeps: a signal counts as a measured zero when its fetch did NOT
 * come back partial and its value is 0.
 *
 * @param {Record<string, number>} metrics    signal name -> value
 * @param {Record<string, boolean>} partialBySignal  signal name -> fetch was incomplete
 */
export function measuredZeroSignals(metrics, partialBySignal = {}) {
  return Object.entries(metrics ?? {})
    .filter(([signal, value]) => Number(value) === 0 && !partialBySignal[signal])
    .map(([signal]) => signal)
    .sort();
}

// ── Row-shape signal vocabularies ────────────────────────────────────────────
// The guard compares provenance lists against metric names, so both sides have
// to agree on the vocabulary. Keeping the projections here (rather than in each
// builder) is what makes "one check at one boundary" true.

/** `PERF#{scope}/REPO` — additions and deletions come from one `code_frequency`
 *  fetch, so they share one `code_churn` signal: that fetch either landed or it
 *  didn't. The other four match `degraded_signals`' existing names. */
export function repoSignals(summary) {
  return {
    issues_opened: summary.issues_opened,
    issues_closed: summary.issues_closed,
    prs_opened: summary.prs_opened,
    prs_closed: summary.prs_closed,
    code_churn: summary.total_additions + summary.total_deletions,
  };
}

/** `PERF#{scope}/PR` — the roll-up the `/performance` endpoint reads. */
export function prSignals(pr_summary) {
  return {
    total_prs: pr_summary.total_prs,
    autopilot_merged: pr_summary.autopilot_merged,
    total_additions: pr_summary.total_additions,
    total_deletions: pr_summary.total_deletions,
  };
}

// ── Per-writer provenance derivations ────────────────────────────────────────
// Cycle-1 review (`wf:owen` O1): every test targeted the predicate, while both
// shipped defects (#498, #503) lived in what a *caller* handed the predicate.
// A derivation that stays inline in a builder's `main()` cannot be driven by a
// test, so it is asserted by the diff and by nothing else. These functions are
// that derivation, lifted out so each call site is testable — the refactor is
// the test more than the assertion is.

/**
 * `PERF#{scope}/PR` provenance for the **GitHub-metadata** builder
 * (`build-pr-metrics-github.mjs`).
 *
 * Cycle-1 review (`wf:dario` D1 / `wf:ren` R1 / `wf:nadia` N1): this path
 * previously handed the guard a hardcoded empty `partialBySignal`, which
 * stamped every zero as a measured zero and left the assertion with nothing to
 * refuse — routing around the guard by blanket-*measuring*, which is worse than
 * the blanket-degrading D1 predicted on #505, because a degraded row at least
 * renders as "unknown" instead of as a real low.
 *
 * The premise that empty map rested on ("every fetch on this path is
 * fail-closed") is true of the three Search loops — each returns non-zero on a
 * non-200 — and false of the per-PR fan-out, whose three unchecked GETs degrade
 * to `{}` / `[]` on a 403 and contribute `0/0` churn plus a misclassified
 * autopilot flag. So the fan-out's status is threaded in here instead.
 *
 * @param {object} pr_summary                    the aggregated `/PR` roll-up
 * @param {object} [opts]
 * @param {boolean} [opts.prFetchPartial]  a per-PR fan-out GET came back non-200
 * @returns {{ degraded_signals: string[], measured_zero: string[] }}
 */
export function githubPrProvenance(pr_summary, { prFetchPartial = false } = {}) {
  // `total_prs` legitimately stays clean: it is the length of the merged-PR
  // Search result, and that loop is genuinely fail-closed. The other three are
  // all derived from the fan-out, so they inherit its provenance — churn
  // directly, `autopilot_merged` via classifyPr's comment/review bodies.
  const partialBySignal = {
    total_prs: false,
    autopilot_merged: prFetchPartial,
    total_additions: prFetchPartial,
    total_deletions: prFetchPartial,
  };
  return {
    degraded_signals: Object.entries(partialBySignal)
      .filter(([, partial]) => partial)
      .map(([signal]) => signal)
      .sort(),
    measured_zero: measuredZeroSignals(prSignals(pr_summary), partialBySignal),
  };
}

/**
 * Does the local clone's history reach back past the window start?
 *
 * git is authoritative for the commits it HAS — but a shallow clone (CI's
 * default `fetch-depth: 1`) has almost none, so `git log --since` returns an
 * empty list indistinguishable from a quiet month. Coverage, not shallowness,
 * is the honest test: a clone reaching back past `sinceIso` can answer the
 * question whichever way `git clone --depth` was called.
 *
 * `exec` is injected (cycle-1 `wf:owen` O2) so both branches are drivable from
 * a test — the builder passes a real `execFileSync`. Argv-array form, not a
 * shell string (cycle-1 `wf:ren` R2): the previous template interpolated
 * `BRANCH` (from argv) unquoted, so a value containing a space resolved to a
 * different command, threw, and landed in the `catch` — arriving at
 * "degraded" by accident rather than by measurement.
 *
 * @param {(file: string, args: string[]) => string} exec  runs git, returns stdout
 * @param {{ sinceIso: string, branch: string }} args
 * @returns {boolean} false when the window is truncated OR undeterminable
 */
export function windowCovered(exec, { sinceIso, branch }) {
  try {
    return String(exec("git", ["rev-list", "-1", `--before=${sinceIso}`, branch])).trim() !== "";
  } catch {
    return false; // cannot tell -> unknown, and an unknown is never a measured zero
  }
}

/**
 * `PERF#{scope}/PR` provenance for the **git-derived** builder
 * (`build-pr-metrics.mjs`). Every signal it derives comes from the same
 * `git log --since` walk, so they share one provenance: the window either is
 * covered or it isn't.
 *
 * @param {object} pr_summary
 * @param {{ windowCovered: boolean }} args
 */
export function gitPrProvenance(pr_summary, { windowCovered: covered }) {
  const partialBySignal = Object.fromEntries(
    Object.keys(prSignals(pr_summary)).map((signal) => [signal, !covered]),
  );
  return {
    degraded_signals: covered ? [] : Object.keys(partialBySignal).sort(),
    measured_zero: measuredZeroSignals(prSignals(pr_summary), partialBySignal),
  };
}
