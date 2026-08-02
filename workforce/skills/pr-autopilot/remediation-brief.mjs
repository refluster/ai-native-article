#!/usr/bin/env node
// pr-autopilot/remediation-brief.mjs — the 🔴 → author loop's payload
// (adr-0023, extending adr-0022's author lane).
//
// WHY THIS EXISTS. Under adr-0022 a 🟡 verdict (a reviewer left an open finding)
// goes to the author lane and a 🔴 verdict (a reviewer vetoed) went to a human —
// so a single blocking lens ended the loop, even when the veto named a concrete,
// diff-local defect the `pr-remediate` cadence could have fixed. adr-0023 routes
// that class back to the author instead: the router (the PdM lens) synthesises
// the panel's blocking findings into an ORDERED, ACCEPTANCE-CRITERIA'd brief,
// hands the PR to the author lane with `review-findings-blocking`, and the next
// tick re-reviews at cycle N+1. The human gate moves from "any 🔴" to "the cycle
// budget is spent" (W-4 / the binding's `cycle_cap`).
//
// The brief is the load-bearing artefact of that loop, so it is machine-checked
// rather than merely templated (C-4): a hand-off that says "reviewers had
// concerns" hands the remediation cadence the same ambiguity a human would have
// had to resolve, and the loop then burns its cycle budget on guesses. Every
// item must name WHICH finding, WHERE, WHAT to change, and HOW the next panel
// will know it was done.
//
// Pure + dependency-free so pr-autopilot-post.mjs (the enforcer) and
// pr-remediate-scan.mjs (the consumer) share one definition.

/** The hidden marker a verdict carrying a remediation brief must end up with.
 *  pr-autopilot-post.mjs appends it once the brief validates, so a body that
 *  carries the marker has been through the parser — the marker is a *result*,
 *  never a claim the router can make on its own. */
export const BRIEF_MARKER = "<!-- autopilot:brief -->";

/** The reason code whose hand-off REQUIRES a brief (adr-0023). Kept here beside
 *  the parser so the enforcement site and the taxonomy can't drift. */
export const BLOCKING_FINDINGS_CODE = "review-findings-blocking";

/** The brief section's opening line. Anchors the parse so prose above/below it
 *  (the synthesis, the panel-provenance paragraph, the markers) is ignored. */
const HEADING_RE = /^\s*\*\*Remediation brief[^*]*\*\*\s*$/mu;

// One item, e.g.
//   1. `A1` (`workforce/skills/pr-merge.mjs:88`) — drop the silent catch and
//      rethrow. Done when: the refusal surfaces as a non-zero exit.
// The ID and the location are backticked (never an @-mention, ML-012); the
// requirement is free prose; the acceptance clause is introduced by
// "Done when:" — case-insensitive, anywhere in the item's text.
const ITEM_RE = /^\s*(?:\d+[.)]|[-*])\s+`([A-Za-z]+\d+)`\s*\(`([^`]+)`\)\s*[—\-–:]\s*([\s\S]*?)(?=\n\s*(?:\d+[.)]|[-*])\s+`[A-Za-z]+\d+`|\n\s*\n|$)/gmu;
const ACCEPTANCE_RE = /done when\s*:?\s*(\S[\s\S]*)$/iu;

/**
 * Parse a verdict body's remediation brief.
 *
 * Returns `{ present, items, problems }`:
 *   - `present` — the brief heading was found at all;
 *   - `items`   — `[{ id, location, requirement, acceptance }]`;
 *   - `problems`— human-readable reasons the brief is not usable as-is.
 *
 * Never throws: the caller decides whether a defective brief is fatal (the post
 * script) or merely worth reporting (the remediation scanner reading an older
 * comment written before this contract existed).
 */
export function parseRemediationBrief(body = "") {
  const text = String(body ?? "");
  const h = HEADING_RE.exec(text);
  if (!h) {
    return {
      present: false,
      items: [],
      problems: ["no **Remediation brief …** section found"],
    };
  }
  const section = text.slice(h.index + h[0].length);
  const items = [];
  const problems = [];
  const seen = new Set();
  const re = new RegExp(ITEM_RE.source, "gmu");
  let m;
  while ((m = re.exec(section)) !== null) {
    const id = m[1];
    const location = m[2].trim();
    const raw = m[3].trim().replace(/\s+/g, " ");
    const acc = ACCEPTANCE_RE.exec(raw);
    const requirement = (acc ? raw.slice(0, acc.index) : raw).trim().replace(/[—\-–,;:]\s*$/u, "");
    const acceptance = acc ? acc[1].trim() : "";
    if (seen.has(id)) problems.push(`finding \`${id}\` is listed twice — one item per finding-ID`);
    seen.add(id);
    if (!acceptance) {
      problems.push(`item \`${id}\` has no "Done when: …" acceptance clause — the next panel must be able to check it off`);
    }
    if (requirement.length < 12) {
      problems.push(`item \`${id}\` states no concrete change ("${requirement}") — name what to do, not that something is wrong`);
    }
    items.push({ id, location, requirement, acceptance });
  }
  if (items.length === 0) {
    problems.push(
      'the brief lists no parsable finding — each item is "1. `A1` (`path/to/file:line`) — <change>. Done when: <acceptance>."',
    );
  }
  return { present: true, items, problems };
}

/** True when the body carries a brief this contract accepts. */
export function briefIsUsable(body = "") {
  const b = parseRemediationBrief(body);
  return b.present && b.problems.length === 0;
}

/**
 * The C-4 gate at the hand-off site (adr-0023). Throws unless the body carries
 * a usable brief. `codes` is the resolved reason-code set: the requirement
 * attaches to `review-findings-blocking` only, so adr-0022's 🟡 lane
 * (`review-findings-open`, whose findings already sit verbatim in the thread)
 * keeps working unchanged and no running SKILL body breaks on this landing.
 */
export function assertBriefForCodes(codes = [], body = "") {
  if (!codes.includes(BLOCKING_FINDINGS_CODE)) return null;
  const brief = parseRemediationBrief(body);
  if (!brief.present || brief.problems.length > 0) {
    throw new Error(
      `--reason ${BLOCKING_FINDINGS_CODE} requires a machine-checkable remediation brief in the verdict body ` +
        `(adr-0023): ${brief.problems.join("; ")}. A 🔴 handed to the author lane is only as good as the brief ` +
        `it carries — the remediation cadence cannot re-derive a panel's blocking findings from "concerns were raised".`,
    );
  }
  return brief;
}

/**
 * The loop's bound (adr-0023). The 🔴 → author → re-review loop is bounded by
 * the SAME cycle budget the review loop always had: hand a PR back to the author
 * only while a further cycle may legitimately run. At or past the cap, the
 * decision is a human's and the code is `cycle-cap-exceeded`.
 *
 * `cycle` is the cycle this verdict closes; the loop it authorises is `cycle+1`.
 * Returns `{ ok, why }` rather than throwing — the caller renders the refusal.
 */
export function cycleBudgetAllowsAuthorLoop(cycle, cap) {
  const n = Number(cycle);
  const c = Number(cap);
  if (!Number.isFinite(n) || n < 1) return { ok: false, why: `--cycle must be a positive integer (got "${cycle}")` };
  if (!Number.isFinite(c) || c < 1) return { ok: false, why: `--cycle-cap must be a positive integer (got "${cap}")` };
  if (n + 1 > c) {
    return {
      ok: false,
      why:
        `this verdict closes cycle ${n} of ≤ ${c}, so the loop it would authorise (cycle ${n + 1}) is past the cap — ` +
        `the author lane may not extend a review loop beyond its budget. Post as ` +
        `--needs-human --reason cycle-cap-exceeded (adr-0023).`,
    };
  }
  return { ok: true, why: `cycle ${n + 1} of ≤ ${c} remains within the budget` };
}
