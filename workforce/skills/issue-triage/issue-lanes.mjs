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

// ── A claim is only as good as the PR behind it ────────────────────────────
//
// The in-progress markers above were read as facts, and they are claims. Two
// ways a claim outlives its work, both observed on this repo on 2026-09-28:
//
//   - `*:pr-open` after the PR MERGED AS A PARTIAL SLICE. issue-implement's
//     Step 4 ships "the smallest complete, mergeable slice" and cites the issue
//     without a closing keyword, so the merge leaves the issue open with its
//     `pr-open` label on. #671/#672/#673 (PRs #708/#709/#726, merged
//     2026-09-10..14) and #458 (since 2026-08-10) sat that way: the router
//     skipped them ("a worker holds this"), the worker skipped them ("claimed"),
//     and the remaining items were eligible for nobody.
//   - `*:in-progress` after the worker's run DIED before Step 5/6 relabelled.
//
// So a claim label counts only while an OPEN PR references the issue. The scan
// passes the set of issue numbers the repo's open PRs reference; a claim
// without one is stale, and a stale claim is the router's to re-examine.
export const PR_OPEN_LABELS = Object.freeze(["issue-implement:pr-open", "issue-design:pr-open"]);
/** An in-progress marker with no PR is stale only after this long: a worker run
 *  takes minutes to a couple of hours, so a day without a PR is a dead run, not
 *  a slow one. */
export const STALE_IN_PROGRESS_HOURS = 24;

// `Closes #N`, `Fixes #N`, `Resolves #N` and `Refs #N` (issue-design cites the
// issue with `Refs` when the document is not the whole deliverable). Same-repo
// references only: `owner/repo#N` is a different tracker's N.
const ISSUE_REF_RE = /(?:^|[^\w/])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\b[:\s]+#(\d+)\b/gi;
// Every lane worker's branch convention: `<slug>/issue-<N>-<kebab>`.
const ISSUE_BRANCH_RE = /(?:^|\/)issue-(\d+)(?:-|$)/;

/** The issue numbers one PR claims, from its body's closing/`Refs` keywords
 *  and its head branch name. */
export function issueRefsOfPr({ body = "", headRef = "" } = {}) {
  const refs = new Set();
  for (const m of String(body || "").matchAll(ISSUE_REF_RE)) refs.add(Number(m[1]));
  const b = String(headRef || "").match(ISSUE_BRANCH_RE);
  if (b) refs.add(Number(b[1]));
  return refs;
}

// ── A lane must be one its worker can take ──────────────────────────────────
//
// The implement lane's worker is bound with a deny-list (bindings-manifest.mjs:
// `issue_selection.deny_labels`) that refuses `layer:L0`, `layer:L1` and
// `type:tracker` — the operator's surface and epics. Laning such an issue
// `implement` therefore parks it in a queue whose only consumer is configured
// never to take it: #572 (`layer:L1`, laned implement 2026-09-10) was eligible
// for nobody from that day. The deliverable for those labels is a proposal or a
// decomposition, which is the design lane (adr-0022). Kept in step with the
// manifest by a test, so the two cannot drift.
export const LANE_ENTRY_DENY = Object.freeze({
  implement: Object.freeze(["layer:l0", "layer:l1", "type:tracker"]),
});

/** The labels that make `lane` a dead end for this issue (empty = fine). */
export function laneEntryConflicts(lane, labels = []) {
  const deny = LANE_ENTRY_DENY[lane] ?? [];
  return labels.map((l) => String(l || "").toLowerCase()).filter((n) => deny.includes(n));
}

/** The `wf:owner:<slug>` an issue carries, or null. */
export function ownerOf(labels = []) {
  for (const l of labels) {
    const name = String(l || "").toLowerCase();
    if (name.startsWith(OWNER_LABEL_PREFIX)) return name.slice(OWNER_LABEL_PREFIX.length);
  }
  return null;
}

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
 *                 requeueDays, or its current state is one no worker can ever
 *                 act on (a stale claim, a lane its worker denies, an owner
 *                 with no binding for the lane). NOT an automatic unblock — the
 *                 router still decides; this only guarantees somebody looks.
 *
 * The last three checks need facts the labels do not carry, so they run only
 * when the caller supplies them (the scan does): `number` + `openPrRefs` (the
 * issue numbers the repo's open PRs reference, from `issueRefsOfPr`), and
 * `workerOwners` (lane → the slugs bound to that lane's worker skill on this
 * project). Without them the function behaves exactly as before.
 */
export function triageAction(
  { labels = [], updatedAt, number } = {},
  { now = Date.now(), requeueDays = DEFAULT_REQUEUE_DAYS, openPrRefs, workerOwners } = {},
) {
  const names = labels.map((l) => String(l || "").toLowerCase());
  const current = laneOf(names);

  const claims = names.filter((n) => IN_PROGRESS_LABELS.includes(n));
  if (claims.length > 0) {
    const canVerify = openPrRefs instanceof Set && Number.isInteger(number);
    if (!canVerify || openPrRefs.has(number)) {
      return { action: "skip", why: "a worker holds this issue right now", current };
    }
    const prOpen = claims.filter((n) => PR_OPEN_LABELS.includes(n));
    if (prOpen.length > 0) {
      return {
        action: "requeue",
        why: `stale claim: ${prOpen.join(", ")} but no open PR references #${number} — its PR merged as a partial slice or was closed; re-examine what is left`,
        current,
      };
    }
    const updated = Date.parse(updatedAt ?? "");
    if (!Number.isNaN(updated) && now - updated > STALE_IN_PROGRESS_HOURS * 3600_000) {
      return {
        action: "requeue",
        why: `stale claim: ${claims.join(", ")} for >${STALE_IN_PROGRESS_HOURS}h with no PR — the worker's run died before handing back`,
        current,
      };
    }
    return { action: "skip", why: "a worker holds this issue right now (in progress, no PR yet)", current };
  }
  // A hand-back is an event, not a timer (adr-0038/adr-0025). The worker read
  // the issue and declined this minute; the router's answer is owed now.
  if (names.includes(HANDBACK_LABEL)) {
    return { action: "requeue", why: "a worker handed this back — route it now", current };
  }
  const legacy = names.filter((n) => LEGACY_PARKED_LABELS.includes(n));
  if (legacy.length > 0) {
    // Parked AND laned is the state adr-0038 §3 says no longer exists ("posting
    // a lane is the router's answer to the park"). It exists anyway, on issues
    // laned before that ADR retired `--requeue` and then parked by the worker
    // the lane dispatched to (#664, #665, #739, #748 …). The 14-day window below
    // never releases them in practice: it keys on `updated_at`, which every
    // bot comment and label edit resets. The worker has already declined, so
    // this is a hand-back in the old vocabulary — answer it now.
    if (current) {
      return {
        action: "requeue",
        why: `parked (${legacy.join(", ")}) while laned "${current}" — a worker declined its lane under the pre-adr-0038 label; route it now`,
        current,
      };
    }
    const updated = Date.parse(updatedAt ?? "");
    if (Number.isNaN(updated)) return { action: "skip", why: "unparseable updated_at — leave it alone", current };
    if (now - updated > requeueDays * 86400_000) {
      return { action: "requeue", why: `parked (${legacy.join(", ")}) and untouched for >${requeueDays}d — re-examine`, current };
    }
    return { action: "skip", why: `parked (${legacy.join(", ")}), still inside the ${requeueDays}d re-examination window`, current };
  }
  if (current) {
    const conflicts = laneEntryConflicts(current, names);
    if (conflicts.length > 0) {
      return {
        action: "requeue",
        why: `laned "${current}" but carries ${conflicts.join(", ")}, which that lane's worker is bound to refuse — nobody can take it there`,
        current,
      };
    }
    const workerSkill = LANE_WORKER_SKILL[current];
    const bound = workerOwners?.[current];
    if (workerSkill && Array.isArray(bound)) {
      const owner = ownerOf(names);
      if (!owner || !bound.includes(owner)) {
        return {
          action: "requeue",
          why: `laned "${current}" with owner ${owner ? `wf:owner:${owner}` : "(none)"}, but ${workerSkill} on this project is bound only to ${bound.length ? bound.join(", ") : "nobody"} — no worker will pick it up`,
          current,
        };
      }
    }
    return { action: "skip", why: `already in lane "${current}"`, current };
  }
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

// ── Settling an issue: consolidate a duplicate, close what is done or moot ──
//
// The lanes answer "who works this?", and the router used to be comment+label
// only, so it had no answer for an issue nobody should work: a DUPLICATE of
// another open issue, one a merged PR already COMPLETED (incidentally, or
// without a closing keyword), or one a later decision made OBSOLETE. Those sat
// in their lane forever — worst on the operator lane, which has no worker to
// notice — and inflated every queue the operator reads. `backlog-reconcile`
// closes shipped work too, but it is plan-driven (epics/specs), large-cost, and
// bound to one repo; it never looked for duplicates at all.
//
// So the router gets a fourth answer, alongside the three lanes: SETTLE. Three
// closing verdicts, each with the one piece of evidence that makes it
// checkable, plus `still-valid` — the recorded "looked, it stands" that keeps a
// long-idle laned issue from being re-reviewed every day.
export const SETTLE_VERDICTS = Object.freeze({
  duplicate: "the same deliverable as another open issue — consolidated into it (--of <canonical>)",
  completed: "a merged PR already delivered it (--pr <merged PR>)",
  obsolete: "a later decision or change made it moot (--superseded-by <ADR / issue / PR>)",
  "still-valid": "reviewed after a long idle stretch and it still stands — recorded, left open in its lane",
});
export const SETTLE_VERDICT_NAMES = Object.freeze(Object.keys(SETTLE_VERDICTS));
export const CLOSE_VERDICTS = Object.freeze(["duplicate", "completed", "obsolete"]);
/** GitHub's close reason for each closing verdict. */
export const CLOSE_STATE_REASON = Object.freeze({ duplicate: "not_planned", completed: "completed", obsolete: "not_planned" });
/** Stamped on every issue the router closes, so a close is auditable in one
 *  search and — load-bearing — a REOPEN is recognisable: an open issue wearing
 *  it was reopened by a human, who has overruled the router. */
export const CLOSED_LABEL_PREFIX = "wf:closed:";
/** A laned issue untouched this long gets a settle review (is it still
 *  wanted?). Long enough that live work is never reviewed, short enough that a
 *  moot issue does not sit a quarter in a queue. */
export const DEFAULT_REVIEW_DAYS = 30;
/** Closing an L0/L1 issue as obsolete, or closing an epic at all, is a design
 *  decision — `backlog-reconcile` and the operator own those. */
export const SETTLE_DENY = Object.freeze(["layer:l0", "layer:l1", "type:tracker"]);

export function assertSettleVerdict(v) {
  if (!SETTLE_VERDICT_NAMES.includes(v)) {
    throw new Error(`unknown verdict "${v}" — must be one of: ${SETTLE_VERDICT_NAMES.join(", ")} (C-4: never invent a verdict)`);
  }
  return v;
}

export function closedLabel(verdict) {
  if (!CLOSE_VERDICTS.includes(verdict)) throw new Error(`"${verdict}" is not a closing verdict`);
  return `${CLOSED_LABEL_PREFIX}${verdict}`;
}

/** True when the issue was closed by the router once and reopened since. */
export function wasReopened(labels = []) {
  return labels.some((l) => String(l || "").toLowerCase().startsWith(CLOSED_LABEL_PREFIX));
}

/**
 * Should an issue `triageAction` skipped as "already in lane" get a settle
 * review? Only a laned issue with no live claim, no open PR, idle for
 * `reviewDays`, and not reopened by a human after a router close.
 */
export function needsSettleReview(
  { labels = [], updatedAt, number } = {},
  { now = Date.now(), reviewDays = DEFAULT_REVIEW_DAYS, openPrRefs } = {},
) {
  const names = labels.map((l) => String(l || "").toLowerCase());
  if (!laneOf(names)) return false;
  if (names.some((n) => IN_PROGRESS_LABELS.includes(n) || PARKED_LABELS.includes(n))) return false;
  if (openPrRefs instanceof Set && openPrRefs.has(number)) return false;
  if (wasReopened(names)) return false;
  const updated = Date.parse(updatedAt ?? "");
  if (Number.isNaN(updated)) return false;
  return now - updated > reviewDays * 86400_000;
}

/**
 * The guards a settle verdict must pass. Pure + exported (unit-tested);
 * `null` = may be applied, else the refusal reason.
 *
 *  - `heldBy`: open PRs referencing the issue. A worker holds it — closing it
 *    under a live branch strands that branch. For a duplicate, close the OTHER
 *    one (the one nobody is working) instead.
 *  - a human reopened it after a router close (`wf:closed:*`): the human has
 *    overruled the router; a second close is an argument, not a verdict.
 *  - `SETTLE_DENY`: an L0/L1 or tracker issue closes only through the operator
 *    or `backlog-reconcile`; `still-valid` is always allowed.
 *  - duplicate: the canonical must be another OPEN issue (not a PR). If the
 *    "original" is already closed, this issue is completed or obsolete — say
 *    which, with that evidence.
 *  - completed: the cited PR must be MERGED.
 *  - obsolete: must name what superseded it.
 */
export function settleRefusal({ verdict, issue, labels = [], heldBy = [], of = null, canonical = null, mergedPr = null, supersededBy = "" }) {
  assertSettleVerdict(verdict);
  if (verdict === "still-valid") return null;
  if (heldBy.length > 0) {
    return `#${issue} is held by open PR ${heldBy.map((n) => `#${n}`).join(", ")} — a worker has it; do not close it under a live branch${verdict === "duplicate" ? " (close the other issue into this one instead)" : ""}`;
  }
  const names = labels.map((l) => String(l || "").toLowerCase());
  if (wasReopened(names)) {
    return `#${issue} was closed by the router before and reopened by a human — that overrules the router; lane it or report it, do not close it again`;
  }
  const denied = names.filter((n) => SETTLE_DENY.includes(n));
  if (denied.length > 0) {
    return `#${issue} carries ${denied.join(", ")} — closing it is a design decision; route it to "operator" (role product / architect-ratify) or leave it to backlog-reconcile`;
  }
  if (verdict === "duplicate") {
    if (!Number.isInteger(of) || of <= 0) return "--of <canonical issue number> is required for a duplicate";
    if (of === Number(issue)) return "an issue cannot be a duplicate of itself";
    if (!canonical) return `canonical #${of} could not be read`;
    if (canonical.pull_request) return `#${of} is a pull request — a duplicate consolidates into an ISSUE; if that PR delivered this, the verdict is "completed"`;
    if (canonical.state !== "open") return `canonical #${of} is ${canonical.state} — if it was done, this issue is "completed" (cite the PR) or "obsolete"; a duplicate needs a live issue to fold into`;
    return null;
  }
  if (verdict === "completed") {
    if (!mergedPr) return "--pr <merged PR number> is required for completed — evidence or it didn't ship";
    if (!mergedPr.merged_at) return `PR #${mergedPr.number} is not merged — "completed" needs a merged PR`;
    return null;
  }
  if (!String(supersededBy || "").trim()) return "--superseded-by <ADR path / issue / PR> is required for obsolete — name what replaced it";
  return null;
}
