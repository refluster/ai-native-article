import { test } from 'node:test'
import assert from 'node:assert/strict'
import { settle } from './settle.mjs'

/** A clock that records what it was asked to wait for, and never actually waits. */
function fakeSleep () {
  const waits = []
  return { waits, sleep: async ms => { waits.push(ms) } }
}

/** runOnce that returns each scripted value in turn. */
function scripted (values) {
  let i = 0
  const calls = () => i
  return { runOnce: async () => values[i++], calls }
}

const clean = r => r === 'clean'

test('settles on the first pass without sleeping', async () => {
  const { waits, sleep } = fakeSleep()
  const { runOnce, calls } = scripted(['clean'])
  const out = await settle({ runOnce, isSettled: clean, attempts: 5, delayMs: 100, sleep })
  assert.deepEqual(out, { result: 'clean', attempts: 1, settled: true })
  assert.equal(calls(), 1)
  assert.deepEqual(waits, [])
})

test('retries until settled, sleeping between passes', async () => {
  const { waits, sleep } = fakeSleep()
  const { runOnce } = scripted(['stale', 'stale', 'clean'])
  const out = await settle({ runOnce, isSettled: clean, attempts: 5, delayMs: 100, sleep })
  assert.equal(out.settled, true)
  assert.equal(out.attempts, 3)
  assert.deepEqual(waits, [100, 100])
})

test('exhausts attempts and reports the LAST result it saw, not settled', async () => {
  const { waits, sleep } = fakeSleep()
  const { runOnce, calls } = scripted(['stale', 'stale', 'broken'])
  const out = await settle({ runOnce, isSettled: clean, attempts: 3, delayMs: 10, sleep })
  assert.deepEqual(out, { result: 'broken', attempts: 3, settled: false })
  assert.equal(calls(), 3)
  // No sleep after the final attempt — an exhausted loop must not pay a delay
  // it will never use.
  assert.deepEqual(waits, [10, 10])
})

test('attempts=1 runs exactly once and never sleeps (the daily-run default)', async () => {
  const { waits, sleep } = fakeSleep()
  const { runOnce, calls } = scripted(['broken'])
  const out = await settle({ runOnce, isSettled: clean, attempts: 1, delayMs: 999, sleep })
  assert.deepEqual(out, { result: 'broken', attempts: 1, settled: false })
  assert.equal(calls(), 1)
  assert.deepEqual(waits, [])
})

test('defaults to a single attempt when none is given', async () => {
  const { runOnce, calls } = scripted(['broken'])
  const out = await settle({ runOnce, isSettled: clean })
  assert.equal(out.settled, false)
  assert.equal(calls(), 1)
})

test('onRetry sees each non-settled pass, and not the settled one', async () => {
  const { sleep } = fakeSleep()
  const { runOnce } = scripted(['stale', 'broken', 'clean'])
  const seen = []
  await settle({
    runOnce, isSettled: clean, attempts: 5, delayMs: 7, sleep,
    onRetry: info => seen.push(info),
  })
  assert.deepEqual(seen.map(i => i.result), ['stale', 'broken'])
  assert.deepEqual(seen.map(i => i.attempt), [1, 2])
  assert.equal(seen[0].attempts, 5)
  assert.equal(seen[0].delayMs, 7)
})

test('onRetry is optional', async () => {
  const { sleep } = fakeSleep()
  const { runOnce } = scripted(['stale', 'clean'])
  const out = await settle({ runOnce, isSettled: clean, attempts: 3, delayMs: 1, sleep })
  assert.equal(out.settled, true)
})

test('a settled-looking falsy result still counts as settled', async () => {
  // isSettled owns the decision — settle() must not second-guess it by
  // truthiness, or a legitimate 0/''/null answer would loop forever.
  const { runOnce, calls } = scripted([0])
  const out = await settle({ runOnce, isSettled: r => r === 0, attempts: 3 })
  assert.deepEqual(out, { result: 0, attempts: 1, settled: true })
  assert.equal(calls(), 1)
})

test('rejects a non-integer attempts count rather than silently not looping', async () => {
  // The regression this guard exists for: Math.max(1, NaN) is NaN, the loop
  // body never ran, and the caller dereferenced an undefined result — which
  // R-17 reported as "the deployed site is broken".
  for (const bad of [NaN, 0, -1, 1.5, '3', undefined === null ? 1 : Number('abc')]) {
    await assert.rejects(
      () => settle({ runOnce: async () => 'clean', isSettled: clean, attempts: bad }),
      /attempts must be an integer >= 1/
    )
  }
})

test('rejects a missing runOnce or isSettled', async () => {
  await assert.rejects(
    () => settle({ isSettled: clean }), /runOnce must be a function/
  )
  await assert.rejects(
    () => settle({ runOnce: async () => 'clean' }), /isSettled must be a function/
  )
})

test('propagates a throw from runOnce instead of swallowing it into a retry', async () => {
  // A bug in the pass is not a reason to wait — it is a reason to stop.
  await assert.rejects(
    () => settle({
      runOnce: async () => { throw new Error('boom') },
      isSettled: clean,
      attempts: 5,
      sleep: async () => {},
    }),
    /boom/
  )
})
