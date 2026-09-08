// letter-structure.mjs — the VP-letter-specific structure guard.
//
// This is NOT a second copy of the W-1 editorial guard (that stays single-
// sourced in workforce/skills/monthly-report/post.mjs, which this Cadence's
// post.mjs forwards to). W-1 asks "is this a real, complete, publishable
// body?". This module asks a different, series-specific question: "is this a
// VP letter in the *shape the series promises the reader*?"
//
// Why the shape is load-bearing (operator direction, 2026-09-07)
// -------------------------------------------------------------
// The VP letters were structurally sound and editorially dull: each month
// re-reported that month's internal events, then listed hypotheses that no
// later letter ever came back to. Three things make a letter in this series
// worth a general reader's time, and all three are checkable:
//
//   1. **A running research programme, not a monthly restart.** Every letter
//      closes a verdict on the hypotheses the previous letter opened. A
//      hypothesis nobody ever scores is decoration; a scored one makes the
//      series a story with continuity, and makes being WRONG interesting.
//   2. **A falsifiable next step.** A "hypothesis" with no stated refutation
//      condition is a wish. Each next-month hypothesis carries the one
//      observation that would make the VP drop it.
//   3. **Transfer to the reader.** The reader does not run a 40-agent AI
//      organisation. A chapter that states the month's finding in a form the
//      reader's own (all-human) organisation can use is what turns "an
//      interesting company" into "something about my own work".
//
// So the letter must carry two named sections, and the scoreboard must parse.
// The prose inside them stays entirely the LLM's judgment — this module never
// grades the writing, only asserts the load-bearing skeleton is there. When it
// fails, it fails LOUD (post.mjs exit 2, W-4): a letter that silently drops
// the scoreboard breaks next month's letter too, because next month's verdicts
// are read back out of this month's page.

/** Heading matcher: any level, the section name appearing anywhere in the text. */
const heading = (line) => /^(#{1,6})\s+(.*)$/.exec(line.trim());

/** Section names the series contract requires (matched as substrings). */
export const TRANSFER_SECTION = "読者の組織";
export const SCOREBOARD_SECTION = "仮説スコアボード";

/** The transfer chapter must carry real prose, not a stub heading. */
const TRANSFER_MIN_CHARS = 400;
/** A verdict reason / a claim / a refutation condition must say something. */
const MIN_CLAUSE_CHARS = 10;
/** The frontier is 2–3 bets. Fewer is not a programme; more is a todo list. */
const NEXT_MIN = 2;
const NEXT_MAX = 3;

// ── Scoreboard line grammar ────────────────────────────────────────────────
// Deliberately forgiving on punctuation (full-width vs ASCII colon, the three
// dash glyphs a Japanese writer reaches for) and strict on the parts that
// carry meaning: which hypothesis, what verdict, and — for next month — the
// observation that would refute it.
const PREV_NONE = /^[-*]\s*前月の仮説\s*[:：]\s*なし/;
const PREV = /^[-*]\s*前月の仮説\s*(\d+)\s*[:：]\s*(支持|反証|判定保留)\s*[—–ー-]\s*(\S.*)$/;
const NEXT = /^[-*]\s*次の仮説\s*(\d+)\s*[:：]\s*(\S.*?)[（(]\s*反証条件\s*[:：]\s*(\S.*?)\s*[）)]\s*$/;

const VERDICTS = new Set(["支持", "反証", "判定保留"]);

/** Character count that matches how a reader perceives length (code points). */
const chars = (s) => [...s.trim()].length;

/**
 * Slice the lines belonging to the section whose heading text contains `name`,
 * up to the next heading of the same or a higher level (or EOF).
 * Returns null when the section is absent.
 */
function sectionLines(lines, name) {
  for (let i = 0; i < lines.length; i++) {
    const h = heading(lines[i]);
    if (!h || !h[2].includes(name)) continue;
    const level = h[1].length;
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      const h2 = heading(lines[j]);
      if (h2 && h2[1].length <= level) break;
      body.push(lines[j]);
    }
    return body;
  }
  return null;
}

/**
 * Check a VP monthly letter's series skeleton.
 *
 * @param {string} body - the full letter markdown (H1 included).
 * @returns {{ errors: string[], prev: Array<{n:number, verdict:string, reason:string}>,
 *             prevNone: boolean, next: Array<{n:number, claim:string, refutation:string}> }}
 */
export function checkLetterStructure(body) {
  const errors = [];
  const lines = String(body ?? "").split(/\r?\n/);

  // ── The transfer chapter ────────────────────────────────────────────────
  const transfer = sectionLines(lines, TRANSFER_SECTION);
  if (transfer === null) {
    errors.push(
      `missing the transfer chapter — the letter needs a section whose heading contains 「${TRANSFER_SECTION}」 ` +
        "(what this month's finding means for a reader's own, all-human organisation)",
    );
  } else {
    const prose = transfer.filter((l) => l.trim() && !heading(l)).join("");
    if (chars(prose) < TRANSFER_MIN_CHARS) {
      errors.push(
        `the 「${TRANSFER_SECTION}」 chapter carries ${chars(prose)} chars of prose (< ${TRANSFER_MIN_CHARS}) — ` +
          "a heading with a sentence under it is not a transfer chapter",
      );
    }
  }

  // ── The hypothesis scoreboard ───────────────────────────────────────────
  const board = sectionLines(lines, SCOREBOARD_SECTION);
  const prev = [];
  const next = [];
  let prevNone = false;

  if (board === null) {
    errors.push(
      `missing the hypothesis scoreboard — the letter needs a section whose heading contains 「${SCOREBOARD_SECTION}」, ` +
        "carrying the verdict on last month's hypotheses and this month's new ones",
    );
    return { errors, prev, prevNone, next };
  }

  for (const raw of board) {
    const line = raw.trim();
    if (!line.startsWith("-") && !line.startsWith("*")) continue;
    if (PREV_NONE.test(line)) { prevNone = true; continue; }
    let m;
    if ((m = PREV.exec(line))) {
      const [, n, verdict, reason] = m;
      if (chars(reason) < MIN_CLAUSE_CHARS) {
        errors.push(`前月の仮説${n} has a verdict but no substantive reason ("${reason.slice(0, 30)}") — say which observation decided it`);
      }
      prev.push({ n: Number(n), verdict, reason: reason.trim() });
      continue;
    }
    if ((m = NEXT.exec(line))) {
      const [, n, claim, refutation] = m;
      if (chars(claim) < MIN_CLAUSE_CHARS) errors.push(`次の仮説${n}'s claim is too short to be a claim ("${claim.slice(0, 30)}")`);
      if (chars(refutation) < MIN_CLAUSE_CHARS) {
        errors.push(`次の仮説${n}'s 反証条件 is too short ("${refutation.slice(0, 30)}") — name the observation that would make you drop the hypothesis`);
      }
      next.push({ n: Number(n), claim: claim.trim(), refutation: refutation.trim() });
      continue;
    }
    // A bullet in the scoreboard that matches neither grammar is a silent
    // drift back to free prose — the exact thing that made the old letters
    // unreadable across months. Name it rather than ignoring it.
    if (/前月の仮説|次の仮説/.test(line)) {
      errors.push(
        `scoreboard line does not parse: "${line.slice(0, 60)}" — use ` +
          "`- 前月の仮説N：支持|反証|判定保留 — <決め手になった観測>` or " +
          "`- 次の仮説N：<主張>（反証条件: <来月これが観測されたら捨てる>）`",
      );
    }
  }

  if (prev.length === 0 && !prevNone) {
    errors.push(
      "the scoreboard scores no previous hypothesis — carry a verdict for each of last month's " +
        "(`- 前月の仮説N：…`), or state `- 前月の仮説：なし` when this is the series' first letter for your lens",
    );
  }
  if (prev.length > 0 && prevNone) {
    errors.push("the scoreboard says 前月の仮説：なし and also scores previous hypotheses — one or the other");
  }
  for (const p of prev) {
    if (!VERDICTS.has(p.verdict)) errors.push(`前月の仮説${p.n} carries an unknown verdict "${p.verdict}"`);
  }

  if (next.length < NEXT_MIN || next.length > NEXT_MAX) {
    errors.push(
      `the scoreboard carries ${next.length} next-month hypotheses — the series contract is ${NEXT_MIN}–${NEXT_MAX} ` +
        "(fewer is not a research programme; more is a todo list)",
    );
  }
  const dupes = next.map((h) => h.n).filter((n, i, a) => a.indexOf(n) !== i);
  if (dupes.length) errors.push(`次の仮説 numbers repeat: ${[...new Set(dupes)].join(", ")}`);

  return { errors, prev, prevNone, next };
}
