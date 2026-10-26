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
// PDFs (detected by their %PDF- magic, whatever the Content-Type says) are
// extracted with poppler's pdftotext in step 1 and judged by the same floor.
//
// Step 3 is the important one. Silently producing an article from a
// consent-wall page would violate C-1; padding from an empty L1 summary would
// invent facts. Returning `{ok: false}` is the honest outcome.

import { ensureProxyAwareEntry } from "./proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Below this, the extracted text cannot ground a ~3000-character article. */
export const MIN_CHARS = 1200;
/** Whitespace-token floor. Only meaningful for space-delimited scripts — see
 *  isGroundable, which makes it non-binding for CJK. */
export const MIN_WORDS = 200;
/** Scripts that do not delimit words with whitespace, so countWords is
 *  meaningless for them: hiragana, katakana, CJK ideographs (incl. ext-A) and
 *  compatibility ideographs. */
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
/** Refuse to buffer more than this from one HTML/text source. */
const MAX_BODY_BYTES = 5_000_000;
/** PDFs are routinely far larger than the prose they carry (a 25k-character
 *  playbook shipped as a 12.7 MB file), so they get their own ceiling. */
export const MAX_PDF_BYTES = 60_000_000;
/** Cap on extracted PDF text handed to the generator. A whitepaper is ~50–100k
 *  chars; anything past this is a book, and the excerpt is marked as such. */
export const MAX_PDF_TEXT_CHARS = 200_000;
/** Only these render as prose when decoded as text. A PDF or an image decoded
 *  as UTF-8 is mojibake that clears every length threshold and would be handed
 *  to the generator as "evidence" (C-1) — PDFs therefore go through a real
 *  extractor (pdfToText), never through this path. */
const TEXTUAL = /^(?:text\/html|text\/plain|application\/xhtml\+xml|text\/markdown|application\/json)/i;
const PDFISH = /^(?:application\/pdf|application\/x-pdf|application\/octet-stream|binary\/octet-stream)/i;

const DEFAULT_TIMEOUT_MS = 45_000;
/** r.jina.ai throttles bursts with 429; give it room before judging. */
const JINA_RETRIES = 3;
const JINA_BACKOFF_MS = [3_000, 9_000];
/** Node's fetch rejects response headers above 16 KiB (UND_ERR_HEADERS_OVERFLOW).
 *  finance.yahoo.com sends more than that, so every Yahoo URL failed the direct
 *  leg with a bare "fetch failed". The retry runs in a child node with a
 *  larger limit — there is no per-request knob without the undici package. */
const LARGE_HEADER_BYTES = 262_144;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const REQUEST_HEADERS = {
  "user-agent": UA,
  accept: "text/html,application/xhtml+xml,text/plain;q=0.9,application/pdf;q=0.8,*/*;q=0.7",
  "accept-language": "en-US,en;q=0.9,ja;q=0.8",
};

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

/** The innermost error code/message — undici wraps the real cause (DNS, TLS,
 *  header overflow) in a generic "fetch failed" that tells an operator nothing. */
export function errorCause(err) {
  let e = err;
  for (let i = 0; i < 5 && e?.cause; i++) e = e.cause;
  return e?.code ?? e?.message ?? String(err);
}

/** Read at most `limit` bytes of a response body, cancelling the rest. */
async function readCapped(res, limit) {
  if (!res.body) return { bytes: Buffer.alloc(0), truncated: false };
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return { bytes: Buffer.concat(chunks).subarray(0, limit), truncated: true };
    }
  }
  return { bytes: Buffer.concat(chunks), truncated: false };
}

async function get(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: REQUEST_HEADERS,
    });
    const contentType = res.headers.get("content-type") ?? "";
    const limit = PDFISH.test(contentType) ? MAX_PDF_BYTES : MAX_BODY_BYTES;
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > limit) {
      await res.body?.cancel().catch(() => {});
      return { status: res.status, ok: false, bytes: Buffer.alloc(0), contentType, oversize: true };
    }
    const { bytes, truncated } = await readCapped(res, limit);
    // A truncated PDF is unparseable; a truncated HTML page is still text.
    const oversize = truncated && PDFISH.test(contentType);
    return { status: res.status, ok: res.ok && !oversize, bytes, contentType, oversize };
  } finally {
    clearTimeout(timer);
  }
}

// The child inherits NODE_USE_ENV_PROXY from this process (proxy-bootstrap
// set it on the re-exec), so it is routed through the agent proxy too.
const LARGE_HEADER_CHILD = `
const [url, timeoutMs, limit] = process.argv.slice(1);
const c = new AbortController();
setTimeout(() => c.abort(), Number(timeoutMs)).unref();
fetch(url, { redirect: "follow", signal: c.signal, headers: JSON.parse(process.env.SF_HEADERS) })
  .then(async (r) => {
    const b = Buffer.from(await r.arrayBuffer()).subarray(0, Number(limit));
    process.stdout.write(JSON.stringify({ status: r.status, ok: r.ok,
      contentType: r.headers.get("content-type") ?? "", b64: b.toString("base64") }));
  })
  .catch((e) => {
    let x = e; for (let i = 0; i < 5 && x?.cause; i++) x = x.cause;
    process.stdout.write(JSON.stringify({ error: x?.code ?? x?.message ?? String(e) }));
  });`;

async function getWithLargeHeaders(url, timeoutMs) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      `--max-http-header-size=${LARGE_HEADER_BYTES}`,
      "--disable-warning=UNDICI-EHPA",
      "-e",
      LARGE_HEADER_CHILD,
      url,
      String(timeoutMs),
      String(MAX_PDF_BYTES),
    ],
    {
      env: { ...process.env, SF_HEADERS: JSON.stringify(REQUEST_HEADERS) },
      maxBuffer: Math.ceil(MAX_PDF_BYTES * 1.4) + 4096,
      timeout: timeoutMs + 5_000,
    },
  );
  const out = JSON.parse(stdout);
  if (out.error) throw new Error(`large-header retry: ${out.error}`);
  return { status: out.status, ok: out.ok, contentType: out.contentType, bytes: Buffer.from(out.b64, "base64") };
}

/** True when the bytes are a PDF, whatever the server called them. */
export function isPdfBytes(bytes) {
  return bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-";
}

/**
 * Extract the text layer of a PDF with poppler's `pdftotext`.
 *
 * Shelling out rather than bundling a JS parser keeps scripts/ dependency-free
 * (the CCR runner runs these with a bare `node`, no `npm install`). A runner
 * without poppler is reported as such and falls through to the reader, rather
 * than being mistaken for an ungroundable source. A scanned PDF has no text
 * layer and comes back empty — that is an honest "not groundable" (no OCR).
 *
 * @returns {Promise<{ok: true, text: string, truncated: boolean} | {ok: false, error: string}>}
 */
export async function pdfToText(bytes) {
  const dir = await mkdtemp(join(tmpdir(), "source-pdf-"));
  const file = join(dir, "source.pdf");
  try {
    await writeFile(file, bytes);
    const { stdout } = await execFileAsync("pdftotext", ["-enc", "UTF-8", "-q", file, "-"], {
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
    });
    let text = stdout
      .replace(/\f/g, "\n\n") // page breaks
      .replace(/[ \t\u00a0]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const truncated = text.length > MAX_PDF_TEXT_CHARS;
    if (truncated) {
      text =
        text.slice(0, MAX_PDF_TEXT_CHARS) +
        `\n\n[source-fetch: PDF text truncated at ${MAX_PDF_TEXT_CHARS} characters — ` +
        "do not cite anything as absent from the document on the strength of this excerpt]";
    }
    return { ok: true, text, truncated };
  } catch (err) {
    return { ok: false, error: err?.code === "ENOENT" ? "pdftotext not installed" : errorCause(err) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Classify a non-groundable r.jina.ai response.
 *
 *   "anon-blocked" — 403 `AbuseAlleviationError` (status 40305): the reader has
 *                    blocked *anonymous* access to that domain for ~1h because
 *                    of someone else's abuse. Retrying in 12s cannot help, and
 *                    an API key lifts it. This was most of the "jina=403"
 *                    history, previously mislabelled as throttling.
 *   "throttled"    — 429 / 5xx: worth a backoff retry; says nothing about the
 *                    source.
 *   "final"        — anything else (a relayed origin 403 consent page, a 404,
 *                    a 200 with a CAPTCHA stub): retrying won't change it.
 */
export function classifyJinaResponse(status, body) {
  if (status === 403 && /AbuseAlleviationError|"status"\s*:\s*40305/.test(body)) return "anon-blocked";
  if (status === 429 || status >= 500) return "throttled";
  return "final";
}

/**
 * Fetch a source URL and return groundable text, or an explicit failure.
 *
 * @returns {Promise<
 *   | {ok: true, via: "direct" | "direct-pdf" | "jina", text: string, chars: number, words: number}
 *   | {ok: false, reason: string, attempts: Array<{via: string, status: number|string, chars: number}>}
 * >}
 */
export async function fetchSourceBody(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const attempts = [];
  const ok = (via, text) => ({ ok: true, via, text, chars: text.length, words: countWords(text) });

  // 1. Direct.
  try {
    let res;
    try {
      res = await get(url, timeoutMs);
    } catch (err) {
      if (errorCause(err) !== "UND_ERR_HEADERS_OVERFLOW") throw err;
      res = await getWithLargeHeaders(url, timeoutMs);
    }
    const ctype = res.contentType.split(";")[0];
    if (res.oversize) {
      attempts.push({ via: "direct", status: `${res.status} oversize (${ctype})`, chars: 0 });
    } else if (isPdfBytes(res.bytes)) {
      const pdf = res.ok ? await pdfToText(res.bytes) : { ok: false, error: `HTTP ${res.status}` };
      const text = pdf.ok ? pdf.text : "";
      attempts.push({
        via: "direct-pdf",
        status: pdf.ok ? res.status : `${res.status} pdf (${pdf.error})`,
        chars: text.length,
      });
      if (pdf.ok && isGroundable(text)) return ok("direct-pdf", text);
    } else {
      const textual = res.contentType === "" || TEXTUAL.test(res.contentType);
      const text = textual ? htmlToText(res.bytes.toString("utf8")) : "";
      attempts.push({
        via: "direct",
        status: textual ? res.status : `${res.status} non-text (${ctype})`,
        chars: text.length,
      });
      if (res.ok && textual && isGroundable(text)) return ok("direct", text);
    }
  } catch (err) {
    attempts.push({
      via: "direct",
      status: err?.name === "AbortError" ? "timeout" : `error: ${errorCause(err)}`,
      chars: 0,
    });
  }

  // 2. Jina Reader — pre-extracted Markdown, works through consent walls and
  //    JS-only pages that step 1 cannot see through. Only a genuine throttle
  //    (429/5xx/timeout) is retried; see classifyJinaResponse.
  let jinaThrottled = false;
  let jinaAnonBlocked = false;
  for (let attempt = 0; attempt < JINA_RETRIES; attempt++) {
    if (attempt > 0) await sleep(JINA_BACKOFF_MS[attempt - 1]);
    try {
      const res = await get(`https://r.jina.ai/${encodeURI(url)}`, timeoutMs);
      // Reader output is already Markdown; do not run it through htmlToText.
      const text = res.bytes.toString("utf8").trim();
      if (res.ok && isGroundable(text)) {
        attempts.push({ via: "jina", status: res.status, chars: text.length });
        return ok("jina", text);
      }
      const verdict = classifyJinaResponse(res.status, text);
      attempts.push({
        via: "jina",
        status: verdict === "anon-blocked" ? `${res.status} anon-blocked` : res.status,
        chars: verdict === "anon-blocked" ? 0 : text.length,
      });
      jinaThrottled = verdict === "throttled";
      jinaAnonBlocked = verdict === "anon-blocked";
      if (!jinaThrottled) break;
    } catch (err) {
      const aborted = err?.name === "AbortError";
      attempts.push({
        via: "jina",
        status: aborted ? "timeout" : `error: ${errorCause(err)}`,
        chars: 0,
      });
      jinaThrottled = aborted;
      if (!aborted) break; // a DNS/TLS failure will not fix itself in 12s
    }
  }

  // A definitive direct verdict (a bot wall's 401/403/404/410, or a 2xx page
  // that simply has too little text) tells us about the SOURCE. Only when no
  // leg reached such a verdict is a throttled reader the whole story — callers
  // use `transient` to decide whether a failure counts against a row's attempt
  // budget. An anonymous-access block is NOT transient for that purpose: it
  // recurs per domain, and a row that never counts would sit at the head of
  // the queue and be re-fetched by every fire.
  const directAttempt = attempts.find((a) => a.via.startsWith("direct"));
  const directWasDefinitive =
    typeof directAttempt?.status === "number" &&
    (directAttempt.status === 200 || [401, 403, 404, 410].includes(directAttempt.status));

  const detail = attempts.map((a) => `${a.via}=${a.status}/${a.chars}c`).join(" ");
  return {
    ok: false,
    transient: jinaThrottled && !directWasDefinitive,
    reason:
      `no groundable body (need >=${MIN_CHARS} chars, plus >=${MIN_WORDS} words unless CJK): ${detail}` +
      (jinaThrottled ? " [reader throttled — may be transient]" : "") +
      (jinaAnonBlocked
        ? " [reader blocks anonymous access to this domain for ~1h at a time — retried after cooldown; a Jina API key lifts it]"
        : ""),
    attempts,
  };
}
