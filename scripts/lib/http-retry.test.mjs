import assert from 'node:assert/strict'
import test from 'node:test'

import {
  backoffMs,
  describeError,
  fetchJsonWithRetry,
  fetchWithRetry,
  isRetryableNetworkError,
  isRetryableStatus,
} from './http-retry.mjs'

const noSleep = async () => {}
const res = (status, body = '', headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
  headers: { get: k => headers[k] ?? null },
})

test('describeError unwraps the cause chain undici hides "fetch failed" behind', () => {
  const cause = new Error('read ECONNRESET')
  cause.code = 'ECONNRESET'
  const err = new Error('fetch failed', { cause })
  assert.equal(describeError(err), 'fetch failed ← read ECONNRESET (ECONNRESET)')
})

test('describeError survives a self-referential cause chain', () => {
  const err = new Error('loop')
  err.cause = err
  assert.equal(describeError(err), 'loop')
})

test('describeError handles non-Errors', () => {
  assert.equal(describeError('plain string'), 'plain string')
  assert.equal(describeError(undefined), 'undefined')
})

test('isRetryableNetworkError recognises transport failures', () => {
  const cause = new Error('read ECONNRESET')
  assert.equal(isRetryableNetworkError(new Error('fetch failed', { cause })), true)
  assert.equal(isRetryableNetworkError(Object.assign(new Error('x'), { name: 'TimeoutError' })), true)
  assert.equal(isRetryableNetworkError(new Error('getaddrinfo EAI_AGAIN api.example')), true)
})

test('isRetryableNetworkError refuses anything marked fatal', () => {
  const err = new Error('fetch failed')
  err.fatal = true
  assert.equal(isRetryableNetworkError(err), false)
})

test('isRetryableNetworkError ignores ordinary content errors', () => {
  assert.equal(isRetryableNetworkError(new Error('model returned an empty completion')), false)
})

test('isRetryableStatus covers 429 and 5xx only', () => {
  assert.deepEqual(
    [429, 500, 503, 400, 401, 404, 200].map(isRetryableStatus),
    [true, true, true, false, false, false, false],
  )
})

test('backoffMs prefers Retry-After, else doubles', () => {
  assert.equal(backoffMs(0, '7'), 7000)
  assert.equal(backoffMs(1, '0'), 0) // server explicitly said "immediately"
  assert.equal(backoffMs(2, 'not-a-number'), 8000)
})

test('backoffMs treats a MISSING Retry-After as absent, not as zero', () => {
  // Number(null) === 0 and Number('') === 0, so a naive isFinite check makes
  // every header-less retry fire instantly. headers.get() returns null for the
  // overwhelmingly common case of no header at all.
  for (const missing of [null, undefined, '', '   ']) {
    assert.equal(backoffMs(0, missing), 2000, `missing=${JSON.stringify(missing)}`)
    assert.equal(backoffMs(1, missing), 4000, `missing=${JSON.stringify(missing)}`)
    assert.equal(backoffMs(3, missing), 16000, `missing=${JSON.stringify(missing)}`)
  }
})

test('fetchWithRetry retries a transport failure and then succeeds', async () => {
  let calls = 0
  const out = await fetchWithRetry({
    url: 'https://x.test',
    timeoutMs: 0,
    sleepImpl: noSleep,
    fetchImpl: async () => {
      calls += 1
      if (calls < 3) throw new Error('fetch failed', { cause: new Error('socket hang up') })
      return res(200, 'ok')
    },
  })
  assert.equal(calls, 3)
  assert.equal(out.status, 200)
})

test('fetchWithRetry retries a 429 and honours Retry-After', async () => {
  const waits = []
  let calls = 0
  await fetchWithRetry({
    url: 'https://x.test',
    timeoutMs: 0,
    sleepImpl: async ms => { waits.push(ms) },
    fetchImpl: async () => (++calls === 1 ? res(429, 'slow down', { 'retry-after': '3' }) : res(200)),
  })
  assert.deepEqual(waits, [3000])
})

test('fetchWithRetry does NOT retry a 4xx — it fails once, marked fatal', async () => {
  let calls = 0
  await assert.rejects(
    () => fetchWithRetry({
      url: 'https://x.test',
      label: 'Azure',
      timeoutMs: 0,
      sleepImpl: noSleep,
      fetchImpl: async () => { calls += 1; return res(400, 'unsupported_value') },
    }),
    err => {
      assert.equal(err.status, 400)
      assert.equal(err.fatal, true)
      assert.match(err.message, /Azure → HTTP 400: unsupported_value/)
      return true
    },
  )
  assert.equal(calls, 1)
})

test('fetchWithRetry gives up after maxRetries and does not loop forever', async () => {
  let calls = 0
  await assert.rejects(
    () => fetchWithRetry({
      url: 'https://x.test',
      maxRetries: 2,
      timeoutMs: 0,
      sleepImpl: noSleep,
      fetchImpl: async () => { calls += 1; throw new Error('fetch failed', { cause: new Error('ECONNRESET') }) },
    }),
    /fetch failed/,
  )
  assert.equal(calls, 3) // initial attempt + 2 retries
})

test('fetchWithRetry stops retrying a 5xx once the budget is spent, and marks it fatal', async () => {
  let calls = 0
  await assert.rejects(
    () => fetchWithRetry({
      url: 'https://x.test',
      maxRetries: 1,
      timeoutMs: 0,
      sleepImpl: noSleep,
      fetchImpl: async () => { calls += 1; return res(503, 'unavailable') },
    }),
    err => {
      assert.equal(err.status, 503)
      // fatal so an outer loop cannot re-retry an already-exhausted request
      assert.equal(err.fatal, true)
      return true
    },
  )
  assert.equal(calls, 2)
})

test('a mutating caller does NOT retry transport errors — a retried write can duplicate', async () => {
  // POST /pages and PATCH /blocks/{id}/children are non-idempotent: a transport
  // error may mean the write committed and the socket then died, so retrying
  // creates a second EN child page or a duplicated block chunk in Notion.
  let calls = 0
  await assert.rejects(
    () => fetchWithRetry({
      url: 'https://x.test',
      retryTransport: false,
      timeoutMs: 0,
      sleepImpl: noSleep,
      fetchImpl: async () => { calls += 1; throw new Error('fetch failed', { cause: new Error('ECONNRESET') }) },
    }),
    /fetch failed/,
  )
  assert.equal(calls, 1, 'a write must be attempted exactly once')
})

test('a mutating caller does NOT retry 5xx, but DOES retry 429', async () => {
  // A 5xx is ambiguous about whether the write landed; a 429 is not.
  let calls = 0
  await assert.rejects(
    () => fetchWithRetry({
      url: 'https://x.test',
      retryServerErrors: false,
      timeoutMs: 0,
      sleepImpl: noSleep,
      fetchImpl: async () => { calls += 1; return res(503, 'unavailable') },
    }),
    err => err.status === 503,
  )
  assert.equal(calls, 1)

  calls = 0
  await fetchWithRetry({
    url: 'https://x.test',
    retryServerErrors: false,
    timeoutMs: 0,
    sleepImpl: noSleep,
    fetchImpl: async () => (++calls === 1 ? res(429, 'slow down') : res(200, 'ok')),
  })
  assert.equal(calls, 2, '429 is unambiguous — not applied — so it still retries')
})

test('the per-attempt timeout is armed when timeoutMs > 0 and absent when 0', async () => {
  // Every other case here passes timeoutMs: 0, which skips AbortSignal.timeout
  // entirely — so without this, the branch both production call sites use is
  // never executed by the suite.
  let seen
  await fetchWithRetry({
    url: 'https://x.test',
    timeoutMs: 50_000,
    sleepImpl: noSleep,
    fetchImpl: async (_u, init) => { seen = init.signal; return res(200) },
  })
  assert.ok(seen instanceof AbortSignal, 'timeoutMs > 0 must pass an AbortSignal')

  await fetchWithRetry({
    url: 'https://x.test',
    timeoutMs: 0,
    sleepImpl: noSleep,
    fetchImpl: async (_u, init) => { seen = init.signal; return res(200) },
  })
  assert.equal(seen, undefined, 'timeoutMs 0 must not arm a timeout')
})

test('a real DOMException TimeoutError is classified as retryable', async () => {
  // The classifier test above builds the error by hand; this pins the shape a
  // genuine AbortSignal.timeout actually produces.
  const real = new DOMException('The operation was aborted due to timeout', 'TimeoutError')
  assert.equal(isRetryableNetworkError(real), true)
  // …and describeError must not print DOMException's numeric legacy code as if
  // it were an errno.
  assert.equal(describeError(real), 'The operation was aborted due to timeout')

  let calls = 0
  await fetchWithRetry({
    url: 'https://x.test',
    timeoutMs: 0,
    sleepImpl: noSleep,
    fetchImpl: async () => { if (++calls === 1) throw real; return res(200) },
  })
  assert.equal(calls, 2)
})

test('fetchWithRetry reads the body inside the retry scope', async () => {
  const out = await fetchWithRetry({
    url: 'https://x.test',
    timeoutMs: 0,
    sleepImpl: noSleep,
    fetchImpl: async () => res(200, '{"ok":true}'),
  })
  // Returning already-read text is what keeps a timeout from firing mid-read,
  // outside the loop, as an unretried and unlabelled AbortError.
  assert.equal(out.body, '{"ok":true}')
  assert.equal(out.status, 200)
})

test('fetchJsonWithRetry parses, and treats an empty body as {}', async () => {
  const parsed = await fetchJsonWithRetry({
    url: 'https://x.test',
    timeoutMs: 0,
    sleepImpl: noSleep,
    fetchImpl: async () => res(200, '{"id":"p1"}'),
  })
  assert.deepEqual(parsed, { id: 'p1' })

  const empty = await fetchJsonWithRetry({
    url: 'https://x.test',
    timeoutMs: 0,
    sleepImpl: noSleep,
    fetchImpl: async () => res(200, ''),
  })
  assert.deepEqual(empty, {})
})

test('fetchJsonWithRetry fails loud on a non-JSON 2xx rather than returning junk', async () => {
  await assert.rejects(
    () => fetchJsonWithRetry({
      url: 'https://x.test',
      label: 'Notion',
      timeoutMs: 0,
      sleepImpl: noSleep,
      fetchImpl: async () => res(200, '<html>proxy error</html>'),
    }),
    err => {
      assert.match(err.message, /Notion → response was not JSON/)
      assert.equal(err.fatal, true)
      return true
    },
  )
})

test('fetchWithRetry logs each retry so a slow run is not silent', async () => {
  const logs = []
  let calls = 0
  await fetchWithRetry({
    url: 'https://x.test',
    label: 'Azure',
    timeoutMs: 0,
    sleepImpl: noSleep,
    logger: m => logs.push(m),
    fetchImpl: async () => (++calls === 1 ? res(500) : res(200)),
  })
  assert.equal(logs.length, 1)
  assert.match(logs[0], /Azure → 500; retrying in 2000ms \(attempt 1\/3\)/)
})
