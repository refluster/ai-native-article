// settle.mjs — retry a whole check until it reaches a settled state.
//
// Distinct from scripts/lib/http-retry.mjs, which retries one *request*. This
// retries one *assertion pass*, which is what a post-deploy check needs: the
// thing it is waiting for (a CDN serving the build that was just published)
// does not fail a request, it answers correctly with the wrong content.
//
// It is a separate module because R-17's driver had no unit coverage while it
// lived as top-level code in a `scripts/*.mjs` entry point, which `npm run
// test:scripts` cannot reach (#620 review, Owen O4 / Dario D3). Everything the
// loop depends on — the pass itself, the clock, the log — is injected, so the
// control flow is testable with no I/O and no waiting.

/**
 * Run `runOnce` until `isSettled` accepts its result, or attempts run out.
 *
 * @param {object} opts
 * @param {() => Promise<any>} opts.runOnce      one full pass; its return value is opaque here
 * @param {(result: any) => boolean} opts.isSettled  true = stop, this is the answer
 * @param {number} [opts.attempts=1]             total passes, including the first (>= 1)
 * @param {number} [opts.delayMs=0]              wait between passes
 * @param {(ms: number) => Promise<void>} [opts.sleep]  injected clock
 * @param {(info: {attempt: number, attempts: number, result: any, delayMs: number}) => void} [opts.onRetry]
 * @returns {Promise<{result: any, attempts: number, settled: boolean}>}
 *   `result` is the LAST pass's result — settled or not. A caller that needs to
 *   know which must read `settled`; returning the last result either way is
 *   deliberate, so an exhausted loop still reports what it actually saw rather
 *   than nothing.
 */
export async function settle ({
  runOnce,
  isSettled,
  attempts = 1,
  delayMs = 0,
  sleep = ms => new Promise(r => setTimeout(r, ms)),
  onRetry,
}) {
  if (typeof runOnce !== 'function') throw new TypeError('settle: runOnce must be a function')
  if (typeof isSettled !== 'function') throw new TypeError('settle: isSettled must be a function')
  if (!Number.isInteger(attempts) || attempts < 1) {
    // A non-integer attempts count is how the first version of this loop failed
    // silently: Math.max(1, NaN) is NaN, the loop body never ran, and the
    // caller dereferenced an undefined result — reported as a site outage.
    throw new TypeError(`settle: attempts must be an integer >= 1 (got ${attempts})`)
  }

  let result
  for (let attempt = 1; attempt <= attempts; attempt++) {
    result = await runOnce()
    if (isSettled(result)) return { result, attempts: attempt, settled: true }
    if (attempt === attempts) break
    onRetry?.({ attempt, attempts, result, delayMs })
    await sleep(delayMs)
  }
  return { result, attempts, settled: false }
}
