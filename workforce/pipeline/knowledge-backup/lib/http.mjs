// Dependency-free HTTP helper shared by the knowledge-backup ingest scripts.
//
// Every upstream we talk to (Discord, Notion, GitHub) rate-limits, and each
// announces it differently. Rather than three ad-hoc retry loops we keep one
// helper that understands the two shapes that actually occur: a 429 with a
// retry hint, and a transient 5xx. Everything else is returned to the caller
// verbatim so the caller can decide whether it is fatal (C-4 / W-4: a broken
// state throws, it never degrades into a partial backup).

/** Sleep for `ms` milliseconds. */
import { ensureProxyAwareEntry } from "../../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A minimal token-bucket pacer. Notion documents ~3 requests/second; Discord
 * publishes per-route buckets we do not model, relying on 429 handling
 * instead. `new Pacer(3)` spaces calls at >= 1/3s.
 */
export class Pacer {
  constructor(perSecond) {
    this.minGapMs = perSecond > 0 ? 1000 / perSecond : 0;
    this.last = 0;
  }

  async wait() {
    if (this.minGapMs === 0) return;
    const gap = Date.now() - this.last;
    if (gap < this.minGapMs) await sleep(this.minGapMs - gap);
    this.last = Date.now();
  }
}

export class HttpError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} for ${url}: ${String(body).slice(0, 400)}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

/**
 * Seconds to wait after a 429, preferring the upstream's own hint.
 * Discord replies `{"retry_after": 1.5}` (seconds, JSON body) and also sets
 * `Retry-After`; Notion and GitHub set `Retry-After` only.
 */
function retryAfterMs(res, bodyText) {
  const header = res.headers.get("retry-after");
  if (header && Number.isFinite(Number(header))) return Number(header) * 1000;
  try {
    const parsed = JSON.parse(bodyText);
    if (Number.isFinite(parsed?.retry_after)) return parsed.retry_after * 1000;
  } catch {
    /* body was not JSON — fall through to the default */
  }
  return 1000;
}

/**
 * fetch() with 429 / 5xx retry. Returns the parsed JSON body on 2xx.
 *
 * `attempts` counts total tries, not retries. On exhaustion the last response
 * is thrown as an HttpError — we never return a sentinel that a caller could
 * mistake for an empty result.
 */
export async function requestJson(url, options = {}, { attempts = 5, pacer } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (pacer) await pacer.wait();
    let res;
    try {
      res = await fetch(url, options);
    } catch (err) {
      // Network-level failure (DNS, reset, proxy). Retry with backoff.
      lastError = err;
      if (attempt === attempts) throw err;
      await sleep(2 ** attempt * 250);
      continue;
    }

    const text = await res.text();
    if (res.ok) return text ? JSON.parse(text) : null;

    if (res.status === 429) {
      const waitMs = retryAfterMs(res, text);
      lastError = new HttpError(429, url, text);
      if (attempt === attempts) throw lastError;
      await sleep(waitMs);
      continue;
    }

    if (res.status >= 500) {
      lastError = new HttpError(res.status, url, text);
      if (attempt === attempts) throw lastError;
      await sleep(2 ** attempt * 250);
      continue;
    }

    // 4xx other than 429 is a caller problem (bad token, missing scope,
    // forbidden channel) — surface it immediately, do not burn retries.
    throw new HttpError(res.status, url, text);
  }
  throw lastError;
}
