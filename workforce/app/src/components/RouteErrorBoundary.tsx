// Last-resort render-error boundary for the console.
//
// Without one, any throw during render (e.g. `RangeError: Invalid time value`
// from a malformed API timestamp, 2026-11-10) unmounts the whole tree and the
// operator gets a blank white page with no hint of what failed. This keeps the
// failure loud (C-4 / W-4: the error is shown and logged, nothing is faked) but
// contained, and resets when the route changes so navigation still works.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

interface BoundaryProps {
  children: ReactNode;
}

interface BoundaryState {
  error: Error | null;
}

class ErrorBoundaryInner extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[workforce] render error', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="min-h-screen bg-wf-surface text-wf-on-surface p-6 md:p-10">
        <div className="max-w-2xl mx-auto border border-wf-outline-variant rounded-wf-md bg-wf-surface-container-lo p-6">
          <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-tertiary">render error</div>
          <h1 className="mt-2 text-lg font-semibold">This page failed to render.</h1>
          <p className="mt-2 text-sm text-wf-on-surface-variant">
            The rest of the console still works. Reload to retry, or go back to another page.
          </p>
          <pre className="mt-4 whitespace-pre-wrap break-words font-wfmono text-xs text-wf-on-surface-variant">
            {error.name}: {error.message}
          </pre>
          <div className="mt-4 flex gap-3 font-wfmono text-xs uppercase tracking-[0.14em]">
            <button type="button" className="underline" onClick={() => window.location.reload()}>
              reload
            </button>
            <Link className="underline" to="/">
              home
            </Link>
          </div>
        </div>
      </div>
    );
  }
}

/** Error boundary keyed on the pathname, so navigating away clears a caught error. */
export default function RouteErrorBoundary({ children }: BoundaryProps) {
  const { pathname } = useLocation();
  return <ErrorBoundaryInner key={pathname}>{children}</ErrorBoundaryInner>;
}
