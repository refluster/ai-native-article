#!/usr/bin/env node
// issue-triage/issue-lanes.mjs — the closed lane vocabulary for issue dispatch
// (adr-0022; prose twin: workforce/docs/runbooks/issue-to-merge-flow.md).
//
// The backlog stalled for a structural reason, not a capacity one: the only
// cadence that took issues was an ENGINEER's (`issue-implement`), which
// self-selected implementable work. An architecture/product/L1 issue was
// therefore eligible for nobody — no cadence claimed it and no cadence declined
// it, so it aged untouched. `issue-implement:needs-human` had the same shape
// from the other side: an absorbing state with no path back.
//
// A lane is the answer: every open issue is assigned exactly one worker class,
// by a router persona, as a machine-readable label. An issue with no lane is a
// triage backlog item (visible); an issue in a lane has a named worker whose
// binding filters on that label. Nothing is "eligible for nobody" any more.
//
// Dependency-free and pure so the scan, the post script and the tests share one
// vocabulary. Fail loud (C-4): an unknown lane throws, never becomes a label
// nobody consumes.

export const LANE_LABEL_PREFIX = "wf:lane:";
export const OWNER_LABEL_PREFIX = "wf:owner:";

// The three worker classes. Deliberately few: a lane exists only where a real
// consumer exists, because a lane with no worker is the exact failure this
// vocabulary replaces. Adding a fourth means wiring its cadence in the same PR.
export const LANES = Object.freeze({
  // Code/config change with a testable outcome → `issue-implement` (engineer).
  implement: "a code or config change with a verifiable acceptance criterion — worked by issue-implement",
  // Decision/document work: an ADR, an epic, a design record, a governance
  // amendment proposal → `issue-design` (architecture/product). The deliverable
  // is a reviewable DIFF, not code — which is what unblocked this class: an
  // L0/L1 issue may not be implemented autonomously, but a PROPOSAL for it can
  // always be drafted, and the operator merges it.
  design: "a decision or document to be drafted (ADR / epic / design record / governance proposal) — worked by issue-design",
  // Genuinely human/operator-only: AWS console work, credentials, spend,
  // physical verification. Named explicitly so it is a *decision*, not a
  // default — the queue is small and visible instead of being everything the
  // agents happened not to pick up.
  operator: "requires operator action no agent can perform (console/credentials/spend/live verification)",
});
export const LANE_NAMES = Object.freeze(Object.keys(LANES));

export function assertLane(lane) {
  if (!LANE_NAMES.includes(lane)) {
    throw new Error(`unknown lane "${lane}" — must be one of: ${LANE_NAMES.join(", ")} (adr-0022; C-4: never invent a lane)`);
  }
  return lane;
}

export function laneLabel(lane) {
  return `${LANE_LABEL_PREFIX}${assertLane(lane)}`;
}

/** The assigned worker persona: `wf:owner:<slug>`. Slug-shaped like every other
 *  agent reference (never an `@`-mention — ML-012). */
export function ownerLabel(slug) {
  const s = String(slug || "").toLowerCase();
  if (!/^[a-z]+$/.test(s)) throw new Error(`owner must be an agent slug ([a-z]+), got "${slug}"`);
  return `${OWNER_LABEL_PREFIX}${s}`;
}

/** The lane an issue is already in, or null. Throws on a label that looks like
 *  a lane but names an unknown one — a typo'd lane silently routes to nobody. */
export function laneOf(labels = []) {
  for (const l of labels) {
    const name = String(l || "").toLowerCase();
    if (name.startsWith(LANE_LABEL_PREFIX)) return assertLane(name.slice(LANE_LABEL_PREFIX.length));
  }
  return null;
}

// Parked states the lanes' workers stamp when they cannot proceed. These are the
// absorbing states adr-0022 un-absorbs: after `requeueDays` of no activity the
// router re-examines the issue, because "blocked on 2026-07-08" is a claim about
// a world that has since changed — the blocking PR merged, the design landed,
// the question was answered in another thread.
export const PARKED_LABELS = Object.freeze(["issue-implement:needs-human", "issue-design:needs-human"]);
export const DEFAULT_REQUEUE_DAYS = 14;

/** In-progress markers — an issue actively held by a worker is never re-triaged
 *  out from under it. */
export const IN_PROGRESS_LABELS = Object.freeze([
  "issue-implement:in-progress",
  "issue-implement:pr-open",
  "issue-design:in-progress",
  "issue-design:pr-open",
]);

/**
 * The pure triage decision for one issue. Returns:
 *   { action: "skip" | "triage" | "requeue", why, current }
 *
 *  - `skip`     — actively worked, or already in a lane and not stale-parked.
 *  - `triage`   — no lane yet: the router assigns one.
 *  - `requeue`  — parked in a needs-human state, untouched for requeueDays: the
 *                 router re-examines it and either re-lanes it or restates the
 *                 blocker with today's evidence. NOT an automatic unblock — the
 *                 router still decides; this only guarantees somebody looks.
 */
export function triageAction(
  { labels = [], updatedAt } = {},
  { now = Date.now(), requeueDays = DEFAULT_REQUEUE_DAYS } = {},
) {
  const names = labels.map((l) => String(l || "").toLowerCase());
  const current = laneOf(names);
  const parked = names.filter((n) => PARKED_LABELS.includes(n));

  if (names.some((n) => IN_PROGRESS_LABELS.includes(n))) {
    return { action: "skip", why: "a worker holds this issue right now", current };
  }
  if (parked.length > 0) {
    const updated = Date.parse(updatedAt ?? "");
    if (Number.isNaN(updated)) return { action: "skip", why: "unparseable updated_at — leave it alone", current };
    const staleFor = now - updated;
    if (staleFor > requeueDays * 86400_000) {
      return { action: "requeue", why: `parked (${parked.join(", ")}) and untouched for >${requeueDays}d — re-examine`, current };
    }
    return { action: "skip", why: `parked (${parked.join(", ")}), still inside the ${requeueDays}d re-examination window`, current };
  }
  if (current) return { action: "skip", why: `already in lane "${current}"`, current };
  return { action: "triage", why: "no lane assigned", current: null };
}

// Label-shaped hints the router starts from. These are a STARTING POINT, not the
// decision: the router reads the issue. They exist so the common cases are
// consistent across fires and so a router that disagrees has to say why (the
// dispatch comment states the lane and the reason).
const DESIGN_HINTS = ["role:architecture", "layer:l1", "layer:l0", "type:tracker", "needs-design"];
const OPERATOR_HINTS = ["type:ops", "area:infra"];

/** The heuristic first guess. `null` means "the labels do not say" — the router
 *  reads the body and decides, which is the normal case for a well-written
 *  issue and never a failure. */
export function suggestLane({ labels = [] } = {}) {
  const names = labels.map((l) => String(l || "").toLowerCase());
  const has = (set) => names.some((n) => set.includes(n));
  // Design first: an L1/architecture issue that ALSO carries type:ops is still a
  // decision to be drafted before anyone can act on it.
  if (has(DESIGN_HINTS)) return "design";
  if (has(OPERATOR_HINTS) && !names.includes("type:feature") && !names.includes("type:chore")) return "operator";
  if (names.some((n) => n.startsWith("type:") || n.startsWith("area:"))) return "implement";
  return null;
}
