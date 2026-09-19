#!/usr/bin/env node
// issue-triage/issue-lanes.mjs — the closed lane vocabulary for issue dispatch
// (adr-0022, extended by adr-0038; prose twin:
// workforce/docs/runbooks/issue-to-merge-flow.md).
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
// adr-0038 adds the three things the intake half was missing next to the PR
// half it was modelled on: ONE hand-back state instead of a per-worker parked
// label, a stated human ROLE on the operator lane, and a mechanical HOP BOUND
// so re-routing cannot ping-pong forever.
//
// Dependency-free and pure so the scan, the post script and the tests share one
// vocabulary. Fail loud (C-4): an unknown lane throws, never becomes a label
// nobody consumes.

export const LANE_LABEL_PREFIX = "wf:lane:";
export const OWNER_LABEL_PREFIX = "wf:owner:";
export const HUMAN_ROLE_LABEL_PREFIX = "wf:human:";

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

/** The cadence that consumes each lane — the other half of "a lane exists only
 *  where a real consumer exists". `null` is the operator, who has no cadence to
 *  wake. Two readers depend on this being the single declaration: the router's
 *  post script (which dispatches the lane's worker, adr-0038) and
 *  `check-binding-queues.mjs` (which refuses a project wired for a producer but
 *  not its consumer, R-N11). */
export const LANE_WORKER_SKILL = Object.freeze({
  implement: "issue-implement",
  design: "issue-design",
  operator: null,
});

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

// ── The operator lane's roles (adr-0038) ───────────────────────────────────
//
// `operator` answered "who owns this?" with "a human", which is the same
// non-answer the lanes replaced one level up: the queue was unsorted, so the
// operator had to re-read every issue to find the ones they could actually act
// on today. A role says WHICH human act is owed, and — more usefully — makes
// the split rule checkable: if the act is `architect-ratify` then a document
// exists (or can be drafted) and only the SIGNATURE is human, so the issue's
// drafting half belongs in the design lane and only the residue belongs here.
//
// Closed set, like the lanes and for the same reason. A role nobody can
// perform is a label nobody consumes.
export const HUMAN_ROLES = Object.freeze({
  "architect-ratify": "a drafted decision exists and needs an Architect's signature/ratification",
  legal: "needs a legal or consent review a persona cannot perform or be accountable for",
  product: "needs a product/scope judgement call with real-world consequences",
  console: "needs AWS console, credential, or spend action outside git",
  field: "needs physical or live verification against real hardware/households",
});
export const HUMAN_ROLE_NAMES = Object.freeze(Object.keys(HUMAN_ROLES));

export function assertHumanRole(role) {
  if (!HUMAN_ROLE_NAMES.includes(role)) {
    throw new Error(
      `unknown human role "${role}" — must be one of: ${HUMAN_ROLE_NAMES.join(", ")} (adr-0038; C-4: never invent a role)`,
    );
  }
  return role;
}

export function humanRoleLabel(role) {
  return `${HUMAN_ROLE_LABEL_PREFIX}${assertHumanRole(role)}`;
}

export function humanRoleOf(labels = []) {
  for (const l of labels) {
    const name = String(l || "").toLowerCase();
    if (name.startsWith(HUMAN_ROLE_LABEL_PREFIX)) return assertHumanRole(name.slice(HUMAN_ROLE_LABEL_PREFIX.length));
  }
  return null;
}

// ── Hand-back: one parked state, and the router is its only reader ─────────
//
// Before adr-0038 each worker stamped its OWN parked label
// (`issue-implement:needs-human`, `issue-design:needs-human`). Two problems,
// both observed on PSVL/asp-cloud: the operator's queue was two searches rather
// than one, and — the load-bearing one — the label read as "a human must act"
// when what the worker actually meant was "not mine". Those are different
// claims, and collapsing them is how 18 issues came to sit in a state whose
// name asserted something nobody had decided.
//
// `wf:handback` says only "the worker declines, the router decides next" and is
// answered by the ROUTER, not by a human. Where a human really is owed, the
// router says so by routing to `operator` + a `wf:human:<role>`.
export const HANDBACK_LABEL = "wf:handback";

/** The pre-adr-0038 parked labels. Still READ — PSVL/asp-cloud has 18 open
 *  issues wearing them and they must re-enter the loop — but never written
 *  again. They age into the requeue window; `wf:handback` does not wait. */
export const LEGACY_PARKED_LABELS = Object.freeze(["issue-implement:needs-human", "issue-design:needs-human"]);

/** Everything that means "parked", old and new, for readers. */
export const PARKED_LABELS = Object.freeze([HANDBACK_LABEL, ...LEGACY_PARKED_LABELS]);
export const DEFAULT_REQUEUE_DAYS = 14;

/** In-progress markers — an issue actively held by a worker is never re-triaged
 *  out from under it. */
export const IN_PROGRESS_LABELS = Object.freeze([
  "issue-implement:in-progress",
  "issue-implement:pr-open",
  "issue-design:in-progress",
  "issue-design:pr-open",
]);

// ── The hop bound (adr-0038) ───────────────────────────────────────────────
//
// The PR half of this loop has had a mechanical attempt bound since adr-0022:
// `REMEDIATION_CAP` (3), counted from `<!-- autopilot:remediation:<n> -->`
// markers. The intake half had none — nothing stopped an issue cycling
// route → hand back → route → hand back. Before adr-0038 that cycle had a
// 14-day period (the requeue window), which is slow enough to look like a
// stalled issue rather than a loop; making the hand-off immediate makes the
// same cycle fast enough to matter. So the bound ships WITH the accelerator.
//
// Deliberately the same idiom as the PR side rather than a new one: a marker in
// the dispatch comment, not a label. The count is visible where the reasoning
// is, and the label vocabulary does not grow an unbounded `wf:hops:N` family.
export const HOP_CAP = 3;
const HOP_MARKER_RE = /<!--\s*wf:hops:(\d+)\s*-->/g;

/** The marker the router writes into every dispatch comment. */
export function hopMarker(n) {
  const v = Number(n);
  if (!Number.isInteger(v) || v < 1) throw new Error(`hop count must be a positive integer, got ${n}`);
  return `<!-- wf:hops:${v} -->`;
}

/** Highest hop number recorded across an issue's comment bodies (0 if none).
 *  Max rather than count: a comment that failed to post must not silently
 *  reset the bound, and a re-read of the same thread must be stable. */
export function parseHops(commentBodies = []) {
  let max = 0;
  for (const body of commentBodies) {
    for (const m of String(body || "").matchAll(HOP_MARKER_RE)) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n > max) max = n;
    }
  }
  return max;
}

/**
 * The bound, as a pure decision. Given the lane the router wants and the hops
 * already spent, returns the lane it may actually apply.
 *
 * At the cap the issue goes to `operator` with `hop-cap-exceeded` — not because
 * a human is the right worker, but because an issue that has been routed
 * HOP_CAP times without resolving has a vocabulary or scoping problem that only
 * a human can name. That escalation IS the finding (SKILL.md Step 4), exactly
 * as `remediation-cap-exceeded` is on the PR side.
 *
 * @returns {{lane: string, hops: number, capped: boolean, why: string}}
 */
export function applyHopCap(lane, priorHops = 0, { cap = HOP_CAP } = {}) {
  assertLane(lane);
  const hops = Number(priorHops) + 1;
  if (hops > cap) {
    return {
      lane: "operator",
      hops,
      capped: true,
      why: `hop-cap-exceeded — routed ${priorHops}× already (cap ${cap}); the lane vocabulary or the issue's scope is the problem, and naming that is a human's call`,
    };
  }
  return { lane, hops, capped: false, why: `hop ${hops}/${cap}` };
}

/**
 * The pure triage decision for one issue. Returns:
 *   { action: "skip" | "triage" | "requeue", why, current }
 *
 *  - `skip`     — actively worked, or already in a lane and not handed back.
 *  - `triage`   — no lane yet: the router assigns one.
 *  - `requeue`  — the router must look again, because either a worker handed it
 *                 back (adr-0038: immediately — the worker has already done the
 *                 reading, so waiting adds latency and no information), or it
 *                 wears a legacy parked label and has been untouched for
 *                 requeueDays. NOT an automatic unblock — the router still
 *                 decides; this only guarantees somebody looks.
 */
export function triageAction(
  { labels = [], updatedAt } = {},
  { now = Date.now(), requeueDays = DEFAULT_REQUEUE_DAYS } = {},
) {
  const names = labels.map((l) => String(l || "").toLowerCase());
  const current = laneOf(names);

  if (names.some((n) => IN_PROGRESS_LABELS.includes(n))) {
    return { action: "skip", why: "a worker holds this issue right now", current };
  }
  // A hand-back is an event, not a timer (adr-0038/adr-0025). The worker read
  // the issue and declined this minute; the router's answer is owed now.
  if (names.includes(HANDBACK_LABEL)) {
    return { action: "requeue", why: "a worker handed this back — route it now", current };
  }
  const legacy = names.filter((n) => LEGACY_PARKED_LABELS.includes(n));
  if (legacy.length > 0) {
    const updated = Date.parse(updatedAt ?? "");
    if (Number.isNaN(updated)) return { action: "skip", why: "unparseable updated_at — leave it alone", current };
    if (now - updated > requeueDays * 86400_000) {
      return { action: "requeue", why: `parked (${legacy.join(", ")}) and untouched for >${requeueDays}d — re-examine`, current };
    }
    return { action: "skip", why: `parked (${legacy.join(", ")}), still inside the ${requeueDays}d re-examination window`, current };
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
