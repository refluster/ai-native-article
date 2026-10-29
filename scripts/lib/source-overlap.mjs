// source-overlap.mjs — front 1 (reproduction) of the podcast rights gate:
// does the narration script copy a run of text out of a cited source?
//
// Issue #673, design note workforce/docs/design/podcast-rights-gate.md §Slice 2.
// Until now "no verbatim reproduction" was the generating LLM auditing its own
// script (self-attestation, counted as `llm-judged`). This compares the script
// to the cited pages' fetched text, so a copied passage is caught by code.
//
// Method: normalise both sides to letters+digits only (NFKC, lowercase, no
// whitespace/punctuation — so reflowed or re-punctuated copying still matches,
// and the check works for Japanese, which has no word spaces), then look for
// any run of OVERLAP_MIN_CHARS consecutive normalised characters present in a
// source. Below that length a match is a short attributed quote, a name or a
// stock phrase and is deliberately NOT flagged (the design note's named
// false-positive class). A paraphrase shares no long run and is not flagged;
// this is a verbatim check only, and the report note says so.
//
// The threshold is the operator's (as with any rights threshold). 80 is a
// conservative starting value: ~80 Japanese characters or ~13 English words.
// It needs tuning against a corpus of real scripts; env WF_OVERLAP_MIN_CHARS
// overrides it at the call site.

export const OVERLAP_MIN_CHARS = 80;

/** Letters and digits only, NFKC-folded and lowercased. */
export function normalizeForOverlap(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Longest verbatim run of `script` found in `source`, in normalised characters.
 * Only runs of at least `minChars` are located; shorter ones return length 0.
 *
 * @returns {{length: number, excerpt: string}}
 */
export function longestSharedRun(script, source, minChars = OVERLAP_MIN_CHARS) {
  if (!Number.isInteger(minChars) || minChars < 1) {
    throw new Error(`source-overlap: minChars must be a positive integer (got ${minChars})`);
  }
  const a = normalizeForOverlap(script);
  const b = normalizeForOverlap(source);
  if (a.length < minChars || b.length < minChars) return { length: 0, excerpt: "" };

  const shingles = new Set();
  for (let i = 0; i + minChars <= b.length; i++) shingles.add(b.slice(i, i + minChars));

  let best = 0;
  let bestStart = 0;
  let runStart = -1;
  for (let i = 0; i + minChars <= a.length; i++) {
    if (shingles.has(a.slice(i, i + minChars))) {
      if (runStart < 0) runStart = i;
      const len = i - runStart + minChars;
      if (len > best) {
        best = len;
        bestStart = runStart;
      }
    } else {
      runStart = -1;
    }
  }
  return { length: best, excerpt: best ? a.slice(bestStart, bestStart + Math.min(best, 40)) : "" };
}

/**
 * Compare a script against fetched sources.
 *
 * @param {string} script
 * @param {Array<{url: string, text?: string|null}>} sources  text null/empty = could not be fetched
 * @returns {{ok: boolean, compared: number, total: number, flagged: Array<{url: string, length: number, excerpt: string}>, reason?: string}}
 */
export function checkSourceOverlap(script, sources, { minChars = OVERLAP_MIN_CHARS } = {}) {
  const usable = sources.filter((s) => normalizeForOverlap(s.text).length > 0);
  const flagged = [];
  for (const s of usable) {
    const { length, excerpt } = longestSharedRun(script, s.text, minChars);
    if (length >= minChars) flagged.push({ url: s.url, length, excerpt });
  }
  const result = { ok: flagged.length === 0, compared: usable.length, total: sources.length, flagged };
  if (!result.ok) {
    result.reason = `script copies a verbatim run of >= ${minChars} characters from ${flagged
      .map((f) => `${f.url} (${f.length} chars, starts "${f.excerpt}")`)
      .join(", ")}`;
  }
  return result;
}

/**
 * Front 1 report for the scoped verdict, or null when nothing could be
 * compared (the caller then falls back to the LLM-judged report: a check that
 * compared zero sources examined nothing). Only called for a passing check.
 */
export function overlapFrontReport(check, minChars = OVERLAP_MIN_CHARS) {
  if (check.compared === 0) return null;
  const scope = `no verbatim run >= ${minChars} chars vs ${check.compared}/${check.total} cited source(s); paraphrase not examined`;
  return {
    state: check.compared === check.total ? "machine" : "machine-partial",
    note: check.compared === check.total ? scope : `${scope}; ${check.total - check.compared} source(s) not fetchable`,
  };
}
