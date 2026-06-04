// Page-level chrome shared by every workforce console route. Renders a
// minimal header strip + the Subnav, then the routed content inside the
// max-width container.

import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import WorkforceSubnav from './WorkforceSubnav';
import { AUTH_IS_CONFIGURED } from '../config/auth';
import { signOut } from '../lib/auth';

interface Props {
  children: ReactNode;
  /** Optional content rendered at the right edge of the subnav strip. */
  subnavRight?: ReactNode;
}

export default function WorkforceLayout({ children, subnavRight }: Props) {
  return (
    <div className="workforce-section min-h-screen">
      <header className="border-b border-wf-outline-variant bg-wf-surface">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 md:px-12 h-12 flex items-center justify-between">
          <Link
            to="/"
            className="font-wfmono text-[11px] sm:text-xs uppercase tracking-[0.18em] font-semibold text-wf-on-surface hover:text-wf-primary"
          >
            <span className="inline-block w-1.5 h-1.5 bg-wf-tertiary mr-2 align-middle" />
            WORKFORCE · CONSOLE
          </Link>
          <div className="flex items-center gap-4">
            {AUTH_IS_CONFIGURED && (
              <button
                type="button"
                onClick={() => { void signOut(); }}
                className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant hover:text-wf-tertiary border border-transparent hover:border-wf-outline-variant px-2 py-0.5"
              >
                SIGN OUT
              </button>
            )}
          </div>
        </div>
      </header>
      <WorkforceSubnav right={subnavRight} />
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 md:px-12 py-6 sm:py-8 md:py-10">
        {children}
      </div>
    </div>
  );
}
