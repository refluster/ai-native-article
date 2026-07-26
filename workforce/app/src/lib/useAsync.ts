// Per-region async state for progressive rendering.
//
// Every console page used to gate its whole render on one
// `Promise.all([...])` and paint a single "Loading…" line until the
// slowest fetch landed — on `/`, `/agents` and `/agents/:slug` that is the
// live agents-api roster (paginated, 100 rows/page), so the operator
// stared at an empty page for the full round-trip.
//
// `useAsync` gives each *region* of a page its own load, so the chrome and
// the fast regions paint immediately and each panel swaps its skeleton for
// content the moment ITS data arrives. Kept deliberately tiny: no cache, no
// retry, no suspense — the loaders in lib/agents.ts already memoise, and
// C-4 (fail loud) wants the error surfaced, not swallowed.

import { useEffect, useState } from 'react'

export interface AsyncState<T> {
  /** Resolved value, or null while loading / after a failure. */
  data: T | null
  /** Message from the rejection, or null. */
  error: string | null
  /** True until the promise settles. */
  loading: boolean
}

const PENDING: AsyncState<never> = { data: null, error: null, loading: true }

/**
 * Runs `load()` on mount (and whenever `deps` change) and reports its
 * state. Results from a superseded run are discarded, so a fast
 * navigation can't paint the previous route's data.
 *
 * `load` is intentionally NOT part of the dependency list — callers pass
 * inline closures, and `deps` is the explicit re-run contract (same shape
 * as `useEffect`).
 */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>(PENDING)

  useEffect(() => {
    let cancelled = false
    setState(PENDING)
    load().then(
      (data) => {
        if (!cancelled) setState({ data, error: null, loading: false })
      },
      (err: unknown) => {
        if (!cancelled) {
          setState({
            data: null,
            error: err instanceof Error ? err.message : String(err),
            loading: false,
          })
        }
      },
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}
