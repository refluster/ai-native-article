#!/usr/bin/env node
// pr-autopilot/escalation-reasons.mjs — the versioned escalation-reason
// taxonomy (Epic-019 Story 1; prose twin: workforce/docs/pr-escalation-reasons.md).
//
// Every `autopilot:needs-human` hand-off records WHY it escalated, twice:
//   - an `autopilot:reason:<code>` label — the aggregation source
//     (build-pr-metrics-github.mjs buckets escalated PRs by this family into
//     the PERF#{scope}/PR roll-up), and
//   - a hidden comment marker `<!-- autopilot:reason:<code> -->` — the per-PR
//     audit trail, extending the existing `<!-- autopilot:… -->` convention
//     (`other` carries its MANDATORY free text inside the marker).
//
// These codes measure the autopilot's WIRING — which predicate clause or
// process leg forced the hand-off — never reviewer performance; they are
// inadmissible as Epic-023 "incidents" (Epic-019 RFC 2026-07-07).
//
// Dependency-free and pure so pr-merge.mjs / pr-autopilot-post.mjs /
// pr-autopilot-sweep.mjs all import it without cycles. Fail loud (C-4): an
// unknown code is a thrown Error, never a silently-invented bucket.

export const REASON_LABEL_PREFIX = "autopilot:reason:";

// Taxonomy v2 (2026-07-29). The terminal-state sweep's kind strings are
// reused VERBATIM as codes (never flattened); the merge-engine clauses map via
// refusalReasonCode() below. Adding/renaming a code = a version bump of the
// prose twin in the same PR.
//
// v2 (adr-0022) splits the hand-off into two lanes. A reason code now says
// which lane a PR was handed to as well as why:
//   - the HUMAN lane (`autopilot:needs-human`) — nothing an agent may do next;
//   - the AUTHOR lane (`autopilot:needs-author`) — an agent-fixable defect the
//     `pr-remediate` cadence owns (AUTHOR_LANE_CODES below).
// The funnel is unaffected: build-pr-metrics-github.mjs searches
// `label:autopilot:needs-human`, so an author-lane hand-off is never counted
// as an escalation — which is the point, it is not one.
export const REASON_CODES = Object.freeze([
  // pr-autopilot-sweep.mjs violation kinds — verbatim.
  "unlabelled-handoff",
  "stale-routed",
  "never-routed",
  // adr-0022: a PR parked in the author lane whose head never moved — the
  // remediation cadence failed to act, so the sweep escalates it to a human.
  "author-stale",
  // Merge-engine refusal clauses (pr-merge.mjs `why` strings) + the SKILL.md
  // verdict-table / session hand-off causes.
  "l0l1-path",
  "human-changes-requested",
  "checks-failing",
  "checks-pending-aged",
  "no-reviewer-consensus",
  "not-mergeable",
  "kill-switch-off",
  "no-r-n10-delegation",
  "cannot-seat-panel",
  "persona-escalation-trigger",
  "cycle-cap-exceeded",
  "merge-engine-refusal",
  // adr-0022 AUTHOR-lane causes: an agent-fixable defect, handed to the
  // author-side `pr-remediate` cadence rather than to a human.
  "merge-conflict",
  "branch-behind",
  "review-findings-open",
  // adr-0022 author-lane EXITS to the human lane: remediation was tried and
  // could not finish (bounded), or could not be tried safely.
  "remediation-cap-exceeded",
  "remediation-blocked",
  // Catch-all — REQUIRES free text (the codes we didn't anticipate are the
  // finding; a bare `other` would let the 100%-coverage criterion be met by
  // mislabeling).
  "other",
]);

const CODE_SET = new Set(REASON_CODES);

// adr-0022: the subset whose cause is AGENT-FIXABLE. A hand-off carrying one of
// these goes to the author lane (`autopilot:needs-author`, worked by the
// `pr-remediate` cadence), not to a human — the human lane is for decisions an
// agent may not make, and "main moved under this branch" is not one of them.
//
// Deliberately NOT in this set: `checks-failing`. A failing check can be an
// author-side defect OR a real product breakage, and the flaky-rerun latch
// (Story 2c) already owns the bounded retry — routing every red check into an
// automatic fix loop would launder a genuine failure into a patch attempt. The
// router may still hand a checks-failing PR to the author lane explicitly
// (SKILL.md Step 5) when the lens reviews located the defect in the diff; the
// default direction stays the loud one (C-4).
export const AUTHOR_LANE_CODES = Object.freeze([
  "merge-conflict",
  "branch-behind",
  "review-findings-open",
]);
const AUTHOR_LANE_SET = new Set(AUTHOR_LANE_CODES);

/** True when `code` names an agent-fixable cause (the author lane). Throws on
 *  an unknown code — the same C-4 posture as every other reader here. */
export function isAuthorLaneCode(code) {
  return AUTHOR_LANE_SET.has(assertReasonCode(code));
}

/** C-4 gate: an unknown code throws, never becomes a quiet new bucket. */
export function assertReasonCode(code) {
  if (!CODE_SET.has(code)) {
    throw new Error(
      `unknown escalation-reason code "${code}" — must be one of: ${REASON_CODES.join(", ")} ` +
        `(taxonomy v2, workforce/docs/pr-escalation-reasons.md; C-4: never invent a bucket)`,
    );
  }
  return code;
}

/** The label carrier: `autopilot:reason:<code>`. Throws on an unknown code. */
export function reasonLabel(code) {
  return `${REASON_LABEL_PREFIX}${assertReasonCode(code)}`;
}

/** The hidden-marker carrier: `<!-- autopilot:reason:<code> [free text] -->`.
 *  Free text is optional for every code except `other`, where it is mandatory. */
export function reasonMarker(code, freeText = "") {
  assertReasonCode(code);
  // "--\x3e" inside the text would close the HTML comment early; neutralise it.
  const text = String(freeText || "").trim().replace(/-->/g, "→");
  if (code === "other" && !text) {
    throw new Error(`escalation reason "other" requires free text — the unanticipated cause IS the finding (taxonomy v2)`);
  }
  return text ? `<!-- autopilot:reason:${code} ${text} -->` : `<!-- autopilot:reason:${code} -->`;
}

const REASON_MARKER_RE = /<!--\s*autopilot:reason:([a-z0-9-]+)([^>]*?)\s*-->/g;

/** Parse every reason marker in a comment body → [{ code, text }]. Throws
 *  (C-4) on an unknown code or an `other` marker missing its free text. */
export function findReasonMarkers(body) {
  const found = [];
  const re = new RegExp(REASON_MARKER_RE.source, "g");
  let m;
  while ((m = re.exec(String(body ?? ""))) !== null) {
    const code = assertReasonCode(m[1].toLowerCase());
    const text = m[2].trim();
    if (code === "other" && !text) {
      throw new Error(`marker <!-- autopilot:reason:other --> is missing its mandatory free text (taxonomy v2)`);
    }
    found.push({ code, text });
  }
  return found;
}

// Map a pr-merge.mjs refusal `why` string onto its taxonomy code. Ordered:
// first match wins, specific clauses before generic ones. The patterns quote
// the engine's exact phrasing (verifyMergeable / resolveL0L1Paths); anything
// unmatched is `merge-engine-refusal`, the engine's own catch-all (closed PR,
// draft-flip failure, a rejected GitHub write) — never a guess at a clause.
const REFUSAL_WHY_MAP = [
  [/autopilot:off/i, "kill-switch-off"],
  // resolveL0L1Paths failures: the target's delegation block is unreadable /
  // absent / empty, i.e. no readable R-N10 delegation (fail-closed).
  [/cannot read target governance|declares no .* block|l0\/l1 block is empty/i, "no-r-n10-delegation"],
  [/touches l0\/l1 path/i, "l0l1-path"],
  [/changes_requested/i, "human-changes-requested"],
  [/check '.*' is /i, "checks-pending-aged"], // status ≠ completed at verdict time
  [/check '.*' = /i, "checks-failing"], // completed with a non-green conclusion
  // adr-0022: split the engine's single `not mergeable (mergeable=…, state=…)`
  // refusal by GitHub's mergeable_state, because two of its values name an
  // agent-fixable branch condition rather than a human decision:
  //   dirty  → the head conflicts with the base (main moved) → author lane
  //   behind → the head is out of date under a strict branch rule → author lane
  // Every other state (blocked / unstable / unknown) stays `not-mergeable`,
  // the human lane, unchanged. Ordered before the generic pattern.
  [/not mergeable.*state=dirty/i, "merge-conflict"],
  [/not mergeable.*state=behind/i, "branch-behind"],
  [/not mergeable/i, "not-mergeable"],
  [/w-4 hard cap/i, "cycle-cap-exceeded"],
  [/missing green marker|unanimous-green reviewers|distinct reviewer/i, "no-reviewer-consensus"],
];

export function refusalReasonCode(why) {
  const s = String(why || "");
  for (const [re, code] of REFUSAL_WHY_MAP) {
    if (re.test(s)) return code;
  }
  return "merge-engine-refusal";
}
