// Epic-020 Story 2 — the pure human-touch aggregation.
//
// Lives here, in plain ESM, because both consumers must import the SAME
// function: build-human-touch.mjs (a .mjs script) and its fixture test. The
// TypeScript half of the contract is workforce/lambdas/shared/performance.ts,
// which owns the *shapes* (HumanTouchBlock / HumanTouchClassTable /
// HumanTouchTypeResult) the endpoint serves; only the writer aggregates, so
// the arithmetic belongs on the writer's side of the seam rather than being
// duplicated across it.
//
// Pure and total: same input → same output, no clock, no IO. Every judgment
// call it encodes is one the taxonomy or Epic-020 states explicitly.

/** Stable published order. Always all three, even when empty — an absent
 *  class is indistinguishable from a class with no touches. */
const CLASS_ORDER = ["gate", "digest", "one-time"];

/**
 * @param {import("../../lambdas/shared/performance.js").HumanTouchTypeResult[]} results
 * @param {{month: string, window: {start: string, end: string}, taxonomyVersion: string, updatedAt: string}} opts
 * @returns {import("../../lambdas/shared/performance.js").HumanTouchBlock}
 */
export function aggregateHumanTouches(results, opts) {
  const classes = CLASS_ORDER.map((cls) => {
    const types = results.filter((r) => r.class === cls);
    // `touches: null` means "we did not look" — excluded from every sum, and
    // named in `unavailable` so the class reads as a floor, not a count.
    const readable = types.filter((r) => r.touches !== null);
    const touches = readable.reduce((n, r) => n + r.touches, 0);
    // Classes are never blended; neither are work units within a class. T5
    // releases USD headroom and T7 registers personas, and both are one-time
    // — summing them is the same category error one level down.
    const units = [...new Set(readable.map((r) => r.unit))].sort();
    const work_units = units.length <= 1 ? readable.reduce((n, r) => n + r.work_units, 0) : null;
    return {
      class: cls,
      types,
      touches,
      work_units,
      leverage:
        work_units !== null && touches > 0 ? Math.round((work_units / touches) * 1000) / 1000 : null,
      units,
      unavailable: types.filter((r) => r.touches === null).map((r) => r.type),
    };
  });

  // Epic-020's anti-gaming clause: estimated types are excluded from the
  // denominator, otherwise the falsifier is gameable by marking a resistant
  // type "estimated" and watching coverage rise.
  const countable = results.filter((r) => r.designation === "counted");
  const counted = countable.filter((r) => r.touches !== null);
  const share = countable.length === 0 ? 0 : Math.round((counted.length / countable.length) * 1000) / 1000;

  return {
    month: opts.month,
    window: opts.window,
    taxonomy_version: opts.taxonomyVersion,
    classes,
    coverage: {
      countable_designated: countable.length,
      mechanically_counted: counted.length,
      share,
      meets_bar: share >= 0.8,
      missing: countable.filter((r) => r.touches === null).map((r) => r.type),
    },
    definition: "leverage-not-price",
    updated_at: opts.updatedAt,
  };
}
