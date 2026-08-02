// source-fetch.mjs — deterministic "can we actually ground an article in this
// URL?" fetcher, shared by the L1→L2 picker and anything else that needs a
// source body.
//
// Replaces the host-enumeration rule that used to live in prose in
// workforce/skills/article-level2/SKILL.md ("for x.com, twitter.com,
// linkedin.com, nytimes/ft/wsj/bloomberg/mckinsey, fetch via Jina Reader").
// That list was a snapshot of which hosts were bot-walled at the time it was
// written, and it decayed: as of 2026-08 r.jina.ai returns 403 for x.com, so
// the documented fallback for the hosts it was written for no longer works,
// while hosts NOT on the list (reuters.com) are bot-walled and were never
// routed to the reader at all.
//
// The rule here is host-agnostic and cannot decay the same way:
//
//   1. Fetch the URL directly, strip the markup, count the text.
//   2. If that yields too little text to ground an article, retry through
//      r.jina.ai, which returns pre-extracted Markdown.
//   3. If both are thin, the source is NOT groundable — say so, with the
//      reason, and let the caller record the failure and move on.
//
// Step 3 is the important one. Silently producing an article from a
// consent-wall page would violate C-1; padding from an empty L1 summary would
// invent facts. Returning `{ok: false}` is the honest outcome.

import { ensureProxyAwareEntry } from "./proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

/** Below this, the extracted text cannot ground a ~3000-character article. */
export const MIN_CHARS = 1200;
/** Whitespace-token floor. Only meaningful for space-delimited scripts — see
 *  isGroundable, which makes it non-binding for CJK. */
export const MIN_WORDS = 200;
/** Scripts that do not delimit words with whitespace, so countWords is
 *  meaningless for them: hiragana, katakana, CJK ideographs (incl. ext-A) and
 *  compatibility ideographs. */
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
/** Refuse to buffer more than this from one source. */
const MAX_BODY_BYTES = 5_000_000;
/** Only these render as prose. A PDF or an image decodes to mojibake that
 *  clears every length threshold and would be handed to the generator as
 *  "evidence" — an article grounded in garbage, which the W-1 guard cannot
 *  catch because the resulting prose looks fine (C-1). */
const TEXTUAL = /^(?:text\/html|text\/plain|application\/xhtml\+xml|text\/markdown|application\/json)/i;

const DEFAULT_TIMEOUT_MS = 45_000;
/** r.jina.ai throttles bursts with 403/429; give it room before judging. */
const JINA_RETRIES = 3;
const JINA_BACKOFF_MS = [3_000, 9_000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Crude but dependency-free HTML → text. Only used to decide "is there
 *  enough real text here", and as the body when no reader output exists. */
export function htmlToText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Enough text to ground an article?
 *
 *  The word floor is deliberately non-binding for CJK. Japanese prose carries
 *  no inter-word whitespace, so countWords collapses to roughly the paragraph
 *  count: a 5,433-char note.com article measures ~30 "words" and would be
 *  rejected. That is not hypothetical — of three note.com URLs that have
 *  already produced published articles, two failed this predicate before the
 *  `||` below replaced an `&&`. On a Japanese-first site an AND here is a
 *  silent content-loss path for a whole language class, and because
 *  pick-l1-source.mjs records a failure per rejection it would evict those
 *  rows from the queue permanently after MAX_ATTEMPTS. */
export function isGroundable(text) {
  if (text.length < MIN_CHARS) return false;
  return countWords(text) >= MIN_WORDS || CJK.test(text);
}

async function get(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9,ja;q=0.8",
      },
    });
    const contentType = res.headers.get("content-type") ?? "";
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_BODY_BYTES) {
      return { status: res.status, ok: false, body: "", contentType, oversize: true };
    }
    const body = (await res.text()).slice(0, MAX_BODY_BYTES);
    return { status: res.status, ok: res.ok, body, contentType };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a source URL and return groundable text, or an explicit failure.
 *
 * @returns {Promise<
 *   | {ok: true, via: "direct" | "jina", text: string, chars: number, words: number}
 *   | {ok: false, reason: string, attempts: Array<{via: string, status: number|string, chars: number}>}
 * >}
 */
export async function fetchSourceBody(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const attempts = [];

  // 1. Direct.
  try {
    const res = await get(url, timeoutMs);
    const textual = res.contentType === "" || TEXTUAL.test(res.contentType);
    const text = textual ? htmlToText(res.body) : "";
    attempts.push({
      via: "direct",
      status: textual ? res.status : `${res.status} non-text (${res.contentType.split(";")[0]})`,
      chars: text.length,
    });
    if (res.ok && textual && isGroundable(text)) {
      return { ok: true, via: "direct", text, chars: text.length, words: countWords(text) };
    }
  } catch (err) {
    attempts.push({
      via: "direct",
      status: err?.name === "AbortError" ? "timeout" : `error: ${err?.message ?? err}`,
      chars: 0,
    });
  }

  // 2. Jina Reader — pre-extracted Markdown, works through consent walls and
  //    JS-only pages that step 1 cannot see through. The reader throttles
  //    aggressively (403/429 on burst), and a throttled response is NOT
  //    evidence that the source is ungroundable, so retry with backoff before
  //    concluding anything.
  let jinaThrottled = false;
  for (let attempt = 0; attempt < JINA_RETRIES; attempt++) {
    if (attempt > 0) await sleep(JINA_BACKOFF_MS[attempt - 1]);
    try {
      const res = await get(`https://r.jina.ai/${encodeURI(url)}`, timeoutMs);
      // Reader output is already Markdown; do not run it through htmlToText.
      const text = res.body.trim();
      attempts.push({ via: "jina", status: res.status, chars: text.length });
      if (res.ok && isGroundable(text)) {
        return { ok: true, via: "jina", text, chars: text.length, words: countWords(text) };
      }
      jinaThrottled = res.status === 403 || res.status === 429 || res.status >= 500;
      if (!jinaThrottled) break; // a real 404/200-but-thin — retrying won't help
    } catch (err) {
      const aborted = err?.name === "AbortError";
      attempts.push({
        via: "jina",
        status: aborted ? "timeout" : `error: ${err?.message ?? err}`,
        chars: 0,
      });
      jinaThrottled = aborted;
      if (!aborted) break; // a DNS/TLS failure will not fix itself in 12s
    }
  }

  // A definitive direct verdict (a bot wall's 401/403/404/410, or a 2xx page
  // that simply has too little text) tells us about the SOURCE. Only when no
  // leg reached such a verdict is a throttled reader the whole story — the
  // distinction matters because callers use `transient` to decide whether a
  // failure counts against a row's attempt budget, and r.jina.ai throttles
  // often enough that treating every throttle as transient would stop the
  // budget from ever advancing.
  const directAttempt = attempts.find((a) => a.via === "direct");
  const directWasDefinitive =
    typeof directAttempt?.status === "number" &&
    (directAttempt.status === 200 || [401, 403, 404, 410].includes(directAttempt.status));

  const detail = attempts
    .map((a) => `${a.via}=${a.status}/${a.chars}c`)
    .join(" ");
  return {
    ok: false,
    // `transient` tells the caller the verdict is about the reader being
    // throttled, not about the source. Callers should still move on to the
    // next candidate, but an operator reading the recorded error needs to
    // know the difference between "this URL is a bot wall" and "we were
    // rate-limited at 04:00".
    transient: jinaThrottled && !directWasDefinitive,
    reason:
      `no groundable body (need >=${MIN_CHARS} chars, plus >=${MIN_WORDS} words unless CJK): ${detail}` +
      (jinaThrottled ? " [reader throttled — may be transient]" : ""),
    attempts,
  };
}
