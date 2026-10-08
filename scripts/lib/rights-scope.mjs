// Scoped compliance verdict for the podcast rights gate (issue #673 item 2,
// design note workforce/docs/design/podcast-rights-gate.md §1).
//
// A green verdict must state its own scope. The trailer is rendered by code,
// from per-front state REPORTED by the checks that actually ran (each check
// returns its own {state, note}; `assembleFrontStates` collects them), so it
// cannot drift from the gate: N is COUNTED, never typed, and a front whose
// check did not report is "not-examined" by construction. An LLM-judged front
// is shown but not counted (the generating model auditing its own script is
// self-attestation, not a check). A partial front is shown separately and is
// not part of N. LLM text that makes its own "N of 7"/"fronts" claim is
// replaced, never kept next to the code-rendered scope.

export const FRONTS = [
  { id: 1, label: "reproduction" },
  { id: 2, label: "market substitution" },
  { id: 3, label: "voice/likeness" },
  { id: 4, label: "CMI removal" },
  { id: 5, label: "officer liability" },
  { id: 6, label: "acquisition method" },
  { id: 7, label: "agent-access permission" },
];

export const STATES = ["machine", "machine-partial", "llm-judged", "not-examined"];

/**
 * Collect per-front reports from the checks that ran. `reports` maps front id to
 * the `{state, note}` that check returned; any front without a report is
 * "not-examined". There is deliberately no table of default states: skipping a
 * check removes its report and the trailer follows.
 */
export function assembleFrontStates(reports = {}) {
  const states = {};
  for (const f of FRONTS) states[f.id] = reports[f.id] ?? { state: "not-examined" };
  return states;
}

/** Front 4 (CMI removal) report from the citation-resolution guard. Presence only. */
export function citationFrontReport(checkedCount) {
  return {
    state: "machine-partial",
    note: `presence only (citations non-empty, every URL resolved ${checkedCount}/${checkedCount})`,
  };
}

/** Front 1 (reproduction) report: an LLM verdict was supplied, nothing compared script to sources. */
export function llmFrontReport() {
  return { state: "llm-judged", note: "self-attested, not counted until a script compares script to sources" };
}

/** Counts derived from the states. Throws on a missing/unknown state (C-4). */
export function countScope(states) {
  let machine = 0;
  let partial = 0;
  let llm = 0;
  for (const f of FRONTS) {
    const s = states?.[f.id]?.state;
    if (!STATES.includes(s)) {
      throw new Error(`rights-scope: front ${f.id} (${f.label}) has no valid state (got ${JSON.stringify(s)})`);
    }
    if (s === "machine") machine += 1;
    else if (s === "machine-partial") partial += 1;
    else if (s === "llm-judged") llm += 1;
  }
  return { machine, partial, llm };
}

export function scopeSummary(states) {
  const { machine, partial, llm } = countScope(states);
  return `scope: ${machine} of ${FRONTS.length} fronts fully machine-examined; ${partial} partial (presence only); ${llm} more LLM-judged only`;
}

const STATE_TEXT = {
  machine: "machine",
  "machine-partial": "machine, partial",
  "llm-judged": "LLM-judged",
  "not-examined": "NOT examined",
};

/** Per-front lines of the trailer (no verdict word). */
export function renderTrailer(states) {
  const width = Math.max(...FRONTS.map((f) => f.label.length));
  return FRONTS.map((f) => {
    const { state, note } = states[f.id];
    const head = `  ${f.id} ${f.label.padEnd(width)} ... ${STATE_TEXT[state]}`;
    return note ? `${head}: ${note}` : head;
  }).join("\n");
}

// Coverage claims only ("N of 7", "all/every 7|seven [fronts]", "fully verified", "full scope"). The bare words
// "front"/"scope" are NOT claims: a FLAG that says "front page of Nikkei" must survive intact.
const SCOPE_CLAIM = /\b\d+\s*(?:of|\/|out of)\s*(?:7|seven)\b|\b(?:all|every)\s+(?:7|seven)(?:\s+fronts?)?\b|\b(?:all|every)\s+fronts?\b|\b(?:fully|completely)\s+(?:verified|examined|checked)\b|\b(?:full|complete|entire)\s+scope\b/gi;
const SCOPE_CLAIM_REMOVED = "[LLM-typed scope claim removed — scope is rendered by code below]";

/**
 * The scope is the code's to state; an LLM-typed coverage claim is replaced inline.
 * Only the claim is replaced, never the line: a leading FLAG/FAIL/BLOCK token and its
 * reason keep their text (C-4 — a negative verdict must not be erasable by wording).
 */
export function stripScopeClaim(line) {
  return String(line).replace(SCOPE_CLAIM, SCOPE_CLAIM_REMOVED);
}

/**
 * Combine the LLM's verdict text with the code-rendered scope. The first line
 * can never read as a bare PASS: it always carries "N of 7".
 * `llmVerdict` may be empty (no --compliance-file): the result then says so
 * rather than implying a pass.
 */
export function scopedVerdict(llmVerdict, states) {
  const summary = scopeSummary(states);
  const lines = String(llmVerdict ?? "").trim().split("\n").map(stripScopeClaim);
  let first = lines[0].trim();
  let rest = lines.slice(1);
  if (first === "") {
    first = `NO LLM VERDICT SUPPLIED (${summary})`;
  } else if (/^PASS(?:ED)?\b/i.test(first)) {
    first = first.replace(/^PASS(?:ED)?\b[:\s.-]*/i, "").trim();
    first = `PASS (${summary})${first ? ` ${first}` : ""}`;
  } else {
    first = `${first} (${summary})`;
  }
  return [first, ...rest, "", renderTrailer(states)].join("\n").trim();
}
