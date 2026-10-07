// Scoped compliance verdict for the podcast rights gate (issue #673 item 2,
// design note workforce/docs/design/podcast-rights-gate.md §1).
//
// A green verdict must state its own scope. The trailer is rendered by code,
// from per-front state set by the code that actually ran, so it cannot drift
// from the gate: N is COUNTED, never typed. An LLM-judged front is shown but
// not counted (the generating model auditing its own script is
// self-attestation, not a check).

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

/** State of each front for today's code (design note §1 table). */
export function defaultFrontStates({ citationsChecked = 0 } = {}) {
  return {
    1: { state: "llm-judged", note: "self-attested, not counted until a script compares script to sources" },
    2: { state: "not-examined" },
    3: { state: "not-examined", note: "stock TTS voice only" },
    4: {
      state: "machine-partial",
      note: `presence only (citations non-empty, every URL resolved ${citationsChecked}/${citationsChecked})`,
    },
    5: { state: "not-examined", note: "human" },
    6: { state: "not-examined" },
    7: { state: "not-examined" },
  };
}

/** Counts derived from the states. Throws on a missing/unknown state (C-4). */
export function countScope(states) {
  let machine = 0;
  let llm = 0;
  for (const f of FRONTS) {
    const s = states?.[f.id]?.state;
    if (!STATES.includes(s)) {
      throw new Error(`rights-scope: front ${f.id} (${f.label}) has no valid state (got ${JSON.stringify(s)})`);
    }
    if (s === "machine" || s === "machine-partial") machine += 1;
    else if (s === "llm-judged") llm += 1;
  }
  return { machine, llm };
}

export function scopeSummary(states) {
  const { machine, llm } = countScope(states);
  return `scope: ${machine} of ${FRONTS.length} fronts machine-examined; ${llm} more LLM-judged only`;
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

/**
 * Combine the LLM's verdict text with the code-rendered scope. The first line
 * can never read as a bare PASS: it always carries "N of 7".
 * `llmVerdict` may be empty (no --compliance-file): the result then says so
 * rather than implying a pass.
 */
export function scopedVerdict(llmVerdict, states) {
  const summary = scopeSummary(states);
  const lines = String(llmVerdict ?? "").trim().split("\n");
  let first = lines[0].trim();
  let rest = lines.slice(1);
  if (first === "") {
    first = `NO LLM VERDICT SUPPLIED (${summary})`;
  } else if (/^PASS\b/i.test(first)) {
    first = first.replace(/^PASS\b[:\s-]*/i, "").trim();
    first = `PASS (${summary})${first ? ` ${first}` : ""}`;
  } else {
    first = `${first} (${summary})`;
  }
  return [first, ...rest, "", renderTrailer(states)].join("\n").trim();
}
