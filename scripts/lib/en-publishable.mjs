// en-publishable.mjs — the W-1 editorial guard applied to a translated edition,
// as a pure function.
//
// Why this is a module and not four `if`s inside backfill-en.mjs: that script
// runs its batch and `process.exit()`s at module scope, so nothing can import
// it, so the code that produced the nine false rejections of ML-020 was the one
// surface on the whole change that no test could reach. The assertions had
// landed one layer below (the truncation heuristic) and one layer sideways (the
// retry helper) — everywhere except the composition that actually ran.
//
// The message contents are part of the contract, not incidental formatting.
// ML-021 is precisely the failure of a guard that rejects content without
// preserving the evidence for its own verdict, so "the message names the
// finish_reason and the full last line" is a behaviour worth pinning.

import { isTruncatedMarkdown } from './truncation.mjs'

// Deliberately the LOWER of the two cadence floors (L2's 200): the backfill
// processes explanations and analyses alike, and a floor tuned for the longer
// form would reject legitimate short explanations.
export const MIN_BODY_CHARS = 200

// LLM-failure preludes, rejected in the first 50 chars.
export const ARTEFACT_PRELUDE =
  /^\s*(as an ai|here is|here's|i apologize|i'm sorry|certainly!|sure,|of course)/i

/** How many trailing characters the message quotes verbatim. */
const TAIL_CHARS = 80

// Zero-width and bidi characters that `JSON.stringify` passes through
// unescaped — it only escapes control characters below U+0020. Left alone,
// these print as nothing at all, which is the worst possible rendering for the
// one character a truncation verdict may turn on.
// Built from escapes, not literals: U+2028 is a line terminator in JS source
// and silently breaks a regex literal that contains it.
const INVISIBLES = new RegExp('[\\u200b-\\u200f\\u2028\\u2029\\u2060\\ufeff]', 'g')

/** Quote a fragment so every character in it is visible, including the ones
 *  that normally render as nothing. */
function quoteVisibly(text) {
  return JSON.stringify(text).replace(
    INVISIBLES,
    ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

/**
 * Check a translated edition against W-1.
 *
 * @param {{title?: string, body?: string, finishReason?: string}} en
 * @returns {{ok: true} | {ok: false, reason: string, message: string}}
 *   `reason` is a stable machine key (`no-title` | `too-short` | `prelude` |
 *   `truncated`); `message` is the operator-facing text.
 */
export function checkEnPublishable(en) {
  const title = (en?.title ?? '').trim()
  const body = (en?.body ?? '').trim()

  if (!title) {
    return { ok: false, reason: 'no-title', message: 'translation has no `# Title` heading (W-1)' }
  }
  if (body.length < MIN_BODY_CHARS) {
    return {
      ok: false,
      reason: 'too-short',
      message: `translated body is ${body.length} chars (< ${MIN_BODY_CHARS}) (W-1)`,
    }
  }
  if (ARTEFACT_PRELUDE.test(body.slice(0, 50))) {
    return {
      ok: false,
      reason: 'prelude',
      message: 'translated body opens with an LLM-failure prelude (W-1)',
    }
  }
  if (isTruncatedMarkdown(body)) {
    // Report the tail separately from the line. Bodies here are one paragraph
    // per line, so "the full last line" can be 1,500+ characters while the
    // verdict turns on the last one or two — and an invisible character there
    // is exactly the class of thing that produces a "why is this flagged?"
    // ticket. `.trim()` matches what the heuristic itself tested, so the quoted
    // text is the text that was judged.
    const lines = body.split('\n').map(l => l.trim()).filter(Boolean)
    const last = lines[lines.length - 1] ?? ''
    return {
      ok: false,
      reason: 'truncated',
      message:
        'translated body looks cut off (W-1)\n' +
        `       finish_reason: ${en?.finishReason || 'unknown'}\n` +
        `       ends with: ${quoteVisibly(last.slice(-TAIL_CHARS))}\n` +
        `       last line in full: ${last}`,
    }
  }
  return { ok: true }
}
