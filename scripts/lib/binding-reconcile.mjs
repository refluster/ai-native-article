// Shared reconciliation for the workforce/scripts/wire-*.mjs family
// (Epic-021 Story 4 follow-up, #574).
//
// Every wire-*.mjs script GETs an agent's live bindings[], computes a
// desired binding literal, and PATCHes back either an in-place replacement
// (drift) or an append (new binding) — a "declare desired state" idiom
// repeated across a dozen scripts. Adding `bound_at` (the ISO timestamp a
// binding was first created, consumed by the idle-digest's "bound, pending
// enable, N days" annotation) to that idiom naively — by putting
// `bound_at: new Date().toISOString()` directly on the desired-state literal
// each script builds — breaks the idempotency the scripts document: the
// stable-serialize equality check would never match twice (the desired
// literal's bound_at is always "now"), so every re-run of an
// already-current script would read as drift and stamp a fresh "just now"
// bound_at over the real one. That defeats the field's entire purpose.
//
// This module is the one place that gets bound_at's lifecycle right, so no
// wire-*.mjs script has to reimplement it:
//   - a genuinely NEW binding (no existing slot) is stamped bound_at=now;
//   - an EXISTING binding — whether unchanged or drifted — carries its
//     bound_at forward untouched (drift never resets the clock);
//   - bound_at itself is excluded from the drift/no-op comparison, so its
//     presence never manufactures a false "drifted" verdict.

/** Key-order-independent, `bound_at`-excluding serialization — the same
 *  "stable()" idiom every wire-*.mjs script already used, minus the one key
 *  that must never participate in the equality check. */
export function stableExcludingBoundAt(v) {
  if (Array.isArray(v)) return `[${v.map(stableExcludingBoundAt).join(",")}]`;
  if (v && typeof v === "object") {
    const keys = Object.keys(v)
      .filter((k) => k !== "bound_at")
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableExcludingBoundAt(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * Reconcile one desired binding against an agent's current bindings[].
 *
 * @param {ReadonlyArray<Record<string, unknown>>} currentBindings - the
 *   agent's live bindings[] as returned by `GET /agents/{slug}`.
 * @param {Record<string, unknown>} desired - the desired binding literal.
 *   Must NOT set `bound_at` — this function owns that field entirely.
 * @param {(b: Record<string, unknown>) => boolean} matchFn - identifies the
 *   existing binding this desired state targets (each script's own
 *   (skill, project_id) key, or whatever key that script already used).
 * @param {() => string} [now] - injectable clock, for tests.
 * @returns {{
 *   bindings: Record<string, unknown>[],
 *   verb: "bound" | "updated (in-place, binding_idx preserved)" | "no-op",
 *   changed: boolean,
 * }}
 */
export function reconcileBinding(currentBindings, desired, matchFn, now = () => new Date().toISOString()) {
  if ("bound_at" in desired) {
    throw new Error(
      "reconcileBinding: `desired` must not set bound_at — this function stamps/carries it",
    );
  }
  const idx = currentBindings.findIndex(matchFn);
  if (idx === -1) {
    const bound = { ...desired, bound_at: now() };
    return { bindings: [...currentBindings, bound], verb: "bound", changed: true };
  }
  const existing = currentBindings[idx];
  if (stableExcludingBoundAt(existing) === stableExcludingBoundAt(desired)) {
    return { bindings: currentBindings, verb: "no-op", changed: false };
  }
  // Drift: apply the new desired shape but carry the original bound_at
  // forward. A binding created before this field existed has none — it
  // stays absent (never invented) rather than being back-dated to "now".
  const updated = existing.bound_at !== undefined ? { ...desired, bound_at: existing.bound_at } : { ...desired };
  const next = currentBindings.map((b, i) => (i === idx ? updated : b));
  return { bindings: next, verb: "updated (in-place, binding_idx preserved)", changed: true };
}
