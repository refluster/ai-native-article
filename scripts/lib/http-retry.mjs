// http-retry.mjs — retry/backoff for the outbound calls this repo makes, and
// the error reporting that makes their failures diagnosable.
//
// Why this exists as a module rather than a loop inlined at each call site:
// the ja→en backfill's first production run failed 7 of 25 articles with the
// single word "fetch failed" and no retry ever attempted, because the Notion
// half of that script had a retry loop and the Azure half — the one issuing the
// long, slow requests most likely to have a socket reset — had none. Both the
// retry policy and the error unwrapping belong somewhere they can be tested
// (ML-021).
//
// `fetch` is injected so the loop is testable without a network.

/**
 * Flatten an Error and its `cause` chain into one line.
 *
 * Node's fetch reports every transport failure as the bare string "fetch
 * failed" and puts the actual reason (ECONNRESET, UND_ERR_HEADERS_TIMEOUT,
 * ENOTFOUND, …) in `err.cause`. Logging only `err.message` converts a
 * diagnosable fault into an unactionable one.
 */
export function describeError(err) {
  if (!(err instanceof Error)) return String(err)
  const parts = []
  let current = err
  const seen = new Set()
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current)
    // Only string codes are errno-like and worth printing. DOMException carries
    // a NUMERIC legacy `code` (a real timeout reports 23), which in a log whose
    // entire job is naming causes reads exactly like an errno and isn't one.
    const code = typeof current.code === 'string' ? current.code : ''
    parts.push(code ? `${current.message} (${code})` : current.message)
    current = current.cause
  }
  return parts.join(' ← ')
}

/**
 * Is this a transport failure worth another attempt?
 *
 * An error marked `fatal` never is — that is how a caller says "this is a 4xx,
 * or a content problem; retrying it just burns tokens and time".
 */
export function isRetryableNetworkError(err) {
  if (!(err instanceof Error)) return false
  if (err.fatal) return false
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return true
  return /fetch failed|network|socket|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|UND_ERR/i.test(
    describeError(err),
  )
}

/** Retryable HTTP status: rate limit or server-side fault. */
export function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status < 600)
}

/**
 * Exponential backoff, honouring a `Retry-After` header when the server sent a
 * usable one.
 */
export function backoffMs(attempt, retryAfterHeader, baseMs = 2000) {
  // The emptiness guard is load-bearing: `Number(null)` and `Number('')` are
  // both 0, so testing `Number.isFinite` alone turns a MISSING Retry-After —
  // what `headers.get()` returns for most responses — into a zero-millisecond
  // backoff. The retry loop then hammers the endpoint with no delay at all,
  // which is worse than not retrying (ML-021).
  if (retryAfterHeader !== null && retryAfterHeader !== undefined && `${retryAfterHeader}`.trim() !== '') {
    const retryAfter = Number(retryAfterHeader)
    if (Number.isFinite(retryAfter) && retryAfter >= 0) return retryAfter * 1000
  }
  return baseMs * 2 ** attempt
}

/**
 * Perform a request, retrying transport failures and retryable statuses.
 *
 * Returns `{ status, headers, body }` with the body already read as text.
 * Reading it INSIDE the retry scope is deliberate: the per-attempt
 * `AbortSignal.timeout` stays armed until the body is consumed, so a caller
 * that reads it after this function returns can have the abort fire mid-read
 * and surface as an unretried, unlabelled `AbortError`.
 *
 * Throws on a non-retryable status (the error carries `.status` and
 * `.fatal = true`), on a retryable status whose budget is exhausted, or on a
 * transport error that will not settle.
 *
 * ## Retrying a write is not the same as retrying a read
 *
 * A retryable *status* means the server answered and declined — nothing was
 * applied. A *transport* error means the request may have committed server-side
 * and then lost the socket, so retrying it can apply the same mutation twice.
 * For `POST /pages` that is a duplicate `EN` child page under one article; for
 * the `PATCH /blocks/{id}/children` chunk loop it is a duplicated block chunk
 * inside a published body. Both are invisible to the export (every discovery
 * site takes the first match) and to R-10 (which does not detect duplicated
 * prose), while Notion — the C-2 source of truth — holds the damage.
 *
 * So a mutating caller passes `retryTransport: false` (and usually
 * `retryServerErrors: false`, since a 5xx is equally ambiguous about whether the
 * write landed), keeping only the 429 retry, which is unambiguous: rate-limited
 * means not applied. Reads keep the full policy — reads are where the batch
 * actually dies.
 *
 * @param {Object} options
 * @param {string} options.url
 * @param {RequestInit} [options.init]      a caller-supplied `signal` is NOT
 *   supported — it would be overwritten by the per-attempt timeout below.
 * @param {number} [options.maxRetries]
 * @param {number} [options.timeoutMs]      per-attempt timeout; 0 disables
 * @param {number} [options.baseMs]         backoff base
 * @param {boolean} [options.retryTransport] retry socket-level failures
 * @param {boolean} [options.retryServerErrors] retry 5xx (429 always retries)
 * @param {string} [options.label]          used in error/log messages
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(ms: number) => Promise<void>} [options.sleepImpl]
 * @param {(message: string) => void} [options.logger]
 * @returns {Promise<{status: number, headers: Headers, body: string}>}
 */
export async function fetchWithRetry(options) {
  const {
    url,
    init = {},
    maxRetries = 3,
    timeoutMs = 300_000,
    baseMs = 2000,
    retryTransport = true,
    retryServerErrors = true,
    label = url,
    fetchImpl = fetch,
    sleepImpl = ms => new Promise(resolve => setTimeout(resolve, ms)),
    logger,
  } = options

  let attempt = 0
  for (;;) {
    try {
      const requestInit = timeoutMs > 0
        ? { ...init, signal: AbortSignal.timeout(timeoutMs) }
        : init
      const res = await fetchImpl(url, requestInit)
      const body = await res.text().catch(() => '')
      if (res.ok) return { status: res.status, headers: res.headers, body }

      const statusRetryable =
        res.status === 429 || (retryServerErrors && isRetryableStatus(res.status))
      if (!statusRetryable || attempt >= maxRetries) {
        const err = new Error(`${label} → HTTP ${res.status}: ${body.slice(0, 300)}`)
        err.status = res.status
        // A 4xx fails identically on retry; an exhausted budget must not be
        // retried again by an outer loop either.
        err.fatal = true
        throw err
      }
      const waitMs = backoffMs(attempt, res.headers?.get?.('retry-after'), baseMs)
      logger?.(`${label} → ${res.status}; retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`)
      await sleepImpl(waitMs)
      attempt += 1
    } catch (err) {
      if (!retryTransport || !isRetryableNetworkError(err) || attempt >= maxRetries) throw err
      const waitMs = backoffMs(attempt, undefined, baseMs)
      logger?.(`${label} → ${describeError(err)}; retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`)
      await sleepImpl(waitMs)
      attempt += 1
    }
  }
}

/** `fetchWithRetry` + JSON parse. An empty body parses to `{}`. */
export async function fetchJsonWithRetry(options) {
  const { body } = await fetchWithRetry(options)
  if (!body.trim()) return {}
  try {
    return JSON.parse(body)
  } catch {
    const err = new Error(`${options.label ?? options.url} → response was not JSON: ${body.slice(0, 200)}`)
    err.fatal = true
    throw err
  }
}
