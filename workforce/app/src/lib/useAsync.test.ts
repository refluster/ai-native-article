// The progressive-rendering contract, at the hook level: two loads must be
// independent (one resolving doesn't wait on the other), and a superseded
// run must not paint over a newer one.

import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAsync } from './useAsync'

/** A promise with externally callable resolve/reject. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useAsync', () => {
  it('starts in the loading state', () => {
    const { result } = renderHook(() => useAsync(() => new Promise<string>(() => {}), []))
    expect(result.current).toEqual({ data: null, error: null, loading: true })
  })

  it('resolves independently of another in-flight load', async () => {
    const fast = deferred<string>()
    const slow = deferred<string>()
    const { result } = renderHook(() => ({
      a: useAsync(() => fast.promise, []),
      b: useAsync(() => slow.promise, []),
    }))

    await act(async () => {
      fast.resolve('feed')
    })

    // The whole point: the fast region is renderable while the slow one
    // is still pending.
    expect(result.current.a).toEqual({ data: 'feed', error: null, loading: false })
    expect(result.current.b.loading).toBe(true)

    await act(async () => {
      slow.resolve('roster')
    })
    expect(result.current.b).toEqual({ data: 'roster', error: null, loading: false })
  })

  it('reports a rejection as an error message, not a thrown render', async () => {
    const d = deferred<string>()
    const { result } = renderHook(() => useAsync(() => d.promise, []))
    await act(async () => {
      d.reject(new Error('agents-api 503'))
    })
    expect(result.current).toEqual({ data: null, error: 'agents-api 503', loading: false })
  })

  it('stringifies a non-Error rejection', async () => {
    const d = deferred<string>()
    const { result } = renderHook(() => useAsync(() => d.promise, []))
    await act(async () => {
      d.reject('boom')
    })
    expect(result.current.error).toBe('boom')
  })

  it('re-runs when deps change and ignores the superseded result', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    const { result, rerender } = renderHook(({ slug }) => useAsync(() => load(slug), [slug]), {
      initialProps: { slug: 'ren' },
    })

    rerender({ slug: 'sora' })
    expect(result.current.loading).toBe(true)

    // The first agent's response lands AFTER we navigated away — it must
    // not paint over the page now showing the second agent.
    await act(async () => {
      first.resolve('ren-data')
    })
    expect(result.current.data).toBeNull()

    await act(async () => {
      second.resolve('sora-data')
    })
    await waitFor(() => expect(result.current.data).toBe('sora-data'))
    expect(load).toHaveBeenCalledTimes(2)
  })
})
