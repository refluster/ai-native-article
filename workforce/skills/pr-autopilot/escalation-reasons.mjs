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

// Taxonomy v1 (2026-07-08). The terminal-state sweep's three kind strings are
// reused VERBATIM as codes (never flattened); the merge-engine clauses map via
// refusalReasonCode() below. Adding/renaming a code = a version bump of the
// prose twin in the same PR.
export const REASON_CODES = Object.freeze([
  // pr-autopilot-sweep.mjs violation kinds — verbatim.
  "unlabelled-handoff",
  "stale-routed",
  "never-routed",
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
  // Catch-all — REQUIRES free text (the codes we didn't anticipate are the
  // finding; a bare `other` would let the 100%-coverage criterion be met by
  // mislabeling).
  "other",
]);

const CODE_SET = new Set(REASON_CODES);

/** C-4 gate: an unknown code throws, never becomes a quiet new bucket. */
export function assertReasonCode(code) {
  if (!CODE_SET.has(code)) {
    throw new Error(
      `unknown escalation-reason code "${code}" — must be one of: ${REASON_CODES.join(", ")} ` +
        `(taxonomy v1, workforce/docs/pr-escalation-reasons.md; C-4: never invent a bucket)`,
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
    throw new Error(`escalation reason "other" requires free text — the unanticipated cause IS the finding (taxonomy v1)`);
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
      throw new Error(`marker <!-- autopilot:reason:other --> is missing its mandatory free text (taxonomy v1)`);
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
