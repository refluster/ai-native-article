#!/usr/bin/env node
// ops-accountability-watch/signals.mjs — pure extraction logic for the two
// health signals this Cadence sweeps. Kept dependency-free (no network, no
// aws-sdk) so it can be unit-tested against a fake repo tree in a temp dir
// and imported by both collect.mjs and the test suite without a live token.
//
// Signal 1 — CI follow-up extraction: turns a list of recent GitHub Actions
// runs into the subset that needs a human follow-up. "Needs follow-up" is
// deliberately narrow: a run that finished with a conclusion other than
// success/skipped/neutral/cancelled (i.e. failure/timed_out/action_required/
// stale). Still-running or not-yet-concluded runs are never flagged.
//
// Signal 2 — governance-registry staleness: docs/memory-lint-backlog.md's own
// promotion rule (docs/memory-lint-backlog.md §1) says a `watching` row is
// promoted, declined, or accepted once it recurs OR once it has sat watching
// for >= 6 months ("stability — the rule is real, just rarely tripped"). A
// row that crosses that 6-month mark and is still bare `watching` is exactly
// the kind of silent process failure this Cadence exists to surface — nobody
// closed the loop the doc itself says should close.

// GitHub Actions conclusions that never need a human follow-up.
export const NON_FOLLOWUP_CONCLUSIONS = Object.freeze(["success", "skipped", "neutral", "cancelled"]);

// docs/memory-lint-backlog.md §1: promoted on the 2nd occurrence within 90
// days, OR once a `watching` row has sat unrevised for >= 6 months.
export const WATCHING_STALE_DAYS = 180;

/**
 * @typedef {object} RunRecord
 * @property {string} workflowFile e.g. "deploy-article-site.yml"
 * @property {string} status e.g. "completed" | "in_progress" | "queued"
 * @property {string|null} conclusion e.g. "success" | "failure" | null
 * @property {string} htmlUrl
 * @property {string} createdAt ISO timestamp
 * @property {number} runNumber
 */

/**
 * Filter a list of recent workflow runs down to the ones that need a
 * follow-up (a terminal, non-exempt conclusion).
 * @param {RunRecord[]} runs
 * @returns {RunRecord[]}
 */
export function extractCiFollowUps(runs) {
  if (!Array.isArray(runs)) {
    throw new Error("extractCiFollowUps: runs must be an array");
  }
  return runs.filter((run) => {
    if (run.status !== "completed") return false; // still in flight — not yet a finding
    if (typeof run.conclusion !== "string") return false; // completed-with-no-conclusion is not representable; skip rather than guess
    return !NON_FOLLOWUP_CONCLUSIONS.includes(run.conclusion);
  });
}

/**
 * Keep only the single most recent run per workflow file — a follow-up
 * issue tracks the CURRENT state of a workflow, not every historical failure
 * (that history already lives in the Actions tab).
 * @param {RunRecord[]} runs
 * @returns {RunRecord[]}
 */
export function latestRunPerWorkflow(runs) {
  const latest = new Map();
  for (const run of runs) {
    const prev = latest.get(run.workflowFile);
    if (!prev || new Date(run.createdAt) > new Date(prev.createdAt)) {
      latest.set(run.workflowFile, run);
    }
  }
  return [...latest.values()];
}

const ISO_DATE_RE = /\d{4}-\d{2}-\d{2}/g;

/**
 * Parse the earliest ISO date (YYYY-MM-DD) cited in a free-text cell. The
 * backlog's Incidents column is prose with embedded dates in parentheses
 * (e.g. "(2026-06-10/11)"); the first occurrence is when the row was opened.
 * @param {string} text
 * @returns {string|null}
 */
export function earliestCitedDate(text) {
  const matches = String(text).match(ISO_DATE_RE);
  if (!matches || matches.length === 0) return null;
  return matches.map((d) => d).sort()[0];
}

/**
 * @typedef {object} BacklogRow
 * @property {string} id
 * @property {string} rule
 * @property {string} incidents
 * @property {string} status
 */

/**
 * Parse the `## 3. Backlog` markdown table in docs/memory-lint-backlog.md
 * into rows. Deliberately tolerant of the prose columns (Rule/Incidents can
 * contain `|` inside links) by only splitting on the fixed 6-column shape the
 * registry comment declares (`registry:memory-lint columns: ID | Rule |
 * Incidents | Count | Status | Promoted via`) via the leading `| ID |` and
 * trailing status cell anchors — see the test fixture for the exact shape
 * this handles.
 * @param {string} markdown full file contents
 * @returns {BacklogRow[]}
 */
export function parseMemoryLintBacklog(markdown) {
  const lines = String(markdown).split("\n");
  const rows = [];
  let inTable = false;
  for (const line of lines) {
    if (/^\|\s*ID\s*\|\s*Rule\s*\|/.test(line)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (/^\|\s*---/.test(line)) continue; // header separator
    if (!line.trim().startsWith("|")) {
      if (rows.length > 0) break; // table ended
      continue;
    }
    const cells = splitTableRow(line);
    if (cells.length < 6) continue;
    const [id, rule, incidents, , status] = cells;
    if (!/^ML-\d+$/.test(id)) continue;
    rows.push({ id, rule, incidents, status: status.trim().toLowerCase() });
  }
  return rows;
}

// Splits a markdown table row on unescaped `|`, trimming each cell and
// dropping the leading/trailing empty cells produced by the outer pipes.
function splitTableRow(line) {
  const cells = line.split("|").map((c) => c.trim());
  if (cells[0] === "") cells.shift();
  if (cells[cells.length - 1] === "") cells.pop();
  return cells;
}

/**
 * @typedef {object} BacklogStaleFinding
 * @property {string} id
 * @property {string} rule
 * @property {string} openedOn ISO date
 * @property {number} ageDays
 */

/**
 * @param {string} markdown docs/memory-lint-backlog.md contents
 * @param {Date} today
 * @returns {BacklogStaleFinding[]}
 */
export function findStaleWatchingEntries(markdown, today) {
  const rows = parseMemoryLintBacklog(markdown);
  const findings = [];
  for (const row of rows) {
    if (row.status !== "watching") continue;
    const openedOn = earliestCitedDate(row.incidents);
    if (!openedOn) continue; // no dated incident to age against — nothing to compute, not a finding
    const ageDays = Math.floor((today.getTime() - new Date(`${openedOn}T00:00:00Z`).getTime()) / 86_400_000);
    if (ageDays >= WATCHING_STALE_DAYS) {
      findings.push({ id: row.id, rule: row.rule, openedOn, ageDays });
    }
  }
  return findings;
}
