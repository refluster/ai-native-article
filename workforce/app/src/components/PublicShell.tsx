// Chrome for the console's PUBLIC surfaces — the landing page at the apex
// and the Research reader under /research. These render outside
// AuthBoundary, so they get neither GlobalNav (whose destinations are all
// gated) nor the operator card; instead a thin header carries the brand,
// the two public destinations (Research, Docs) and the sign-in / open
// console action. Landing used to inline exactly this header + footer;
// lifting it here keeps the two public pages one design.
//
// Session state is read the same way Landing always did: a readable
// Cognito session flips the button to "Open console", anything else is
// "Sign in". Auth being unconfigured (a bare dev build) just opens the
// console home, where AuthBoundary explains itself.

import { useEffect, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { AUTH_IS_CONFIGURED } from '../config/auth';
import { getCurrentUser, signIn } from '../lib/auth';
import { SITE_DISPLAY_NAME } from '../config/site';
import BrandMark from './BrandMark';

const CONSOLE_HOME = '/feed';

export interface PublicSession {
  signedIn: boolean;
  /** Open the console — straight in when a session exists, else via the
   *  Cognito Hosted UI, returning to the console home. */
  enterConsole: () => void;
}

export function usePublicSession(): PublicSession {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (!AUTH_IS_CONFIGURED) return;
    let cancelled = false;
    getCurrentUser()
      .then(u => {
        if (!cancelled) setSignedIn(Boolean(u));
      })
      .catch(() => {
        /* an unreadable session is simply "signed out" here */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function enterConsole() {
    if (signedIn || !AUTH_IS_CONFIGURED) {
      window.location.assign(CONSOLE_HOME);
      return;
    }
    signIn(CONSOLE_HOME).catch(err => {
      console.error('signIn redirect failed:', err);
    });
  }

  return { signedIn, enterConsole };
}

/** Public header destinations, in order. `/docs/` is a static S3 object
 *  set, not a router route, so it stays a plain anchor. */
const PUBLIC_NAV: { to: string; label: string; external?: boolean }[] = [
  { to: '/research', label: 'Research' },
  { to: '/docs/', label: 'Docs', external: true },
];

const NAV_LINK = 'font-wfmono text-[11px] uppercase tracking-[0.16em] transition-colors';

interface Props {
  children: ReactNode;
  /** Max width of the header/main/footer column. Landing reads best narrow;
   *  the Research index wants the console's wider grid. */
  width?: 'narrow' | 'wide';
}

export default function PublicShell({ children, width = 'narrow' }: Props) {
  const { signedIn, enterConsole } = usePublicSession();
  const column = width === 'wide' ? 'max-w-[1200px]' : 'max-w-5xl';

  return (
    <div className="min-h-screen bg-wf-surface text-wf-on-surface flex flex-col">
      <header className={`w-full ${column} mx-auto px-6 py-5 flex items-center justify-between gap-4`}>
        <NavLink to="/" className="flex items-center gap-2 group" aria-label={SITE_DISPLAY_NAME}>
          <BrandMark size={26} />
          <span className="font-headline font-bold text-[15px] group-hover:text-wf-primary">
            {SITE_DISPLAY_NAME}
          </span>
        </NavLink>
        <nav className="flex items-center gap-4 sm:gap-5" aria-label="Public">
          {PUBLIC_NAV.map(item =>
            item.external ? (
              <a
                key={item.to}
                href={item.to}
                className={`${NAV_LINK} text-wf-on-surface-variant hover:text-wf-on-surface`}
              >
                {item.label}
              </a>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `${NAV_LINK} ${
                    isActive
                      ? 'text-wf-on-surface border-b border-wf-on-surface pb-0.5'
                      : 'text-wf-on-surface-variant hover:text-wf-on-surface'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ),
          )}
          <button
            type="button"
            onClick={enterConsole}
            className="font-wfmono text-[11px] uppercase tracking-[0.16em] px-4 py-2 rounded-full bg-wf-primary text-wf-on-primary hover:opacity-90"
          >
            {signedIn ? 'Open console' : 'Sign in'}
          </button>
        </nav>
      </header>

      <main className={`flex-1 w-full ${column} mx-auto px-6`}>{children}</main>

      <footer
        className={`w-full ${column} mx-auto px-6 py-8 border-t border-wf-outline-variant font-wfmono text-[11px] uppercase tracking-[0.14em] text-wf-on-surface-variant flex flex-wrap gap-x-6 gap-y-2`}
      >
        <span>{SITE_DISPLAY_NAME}</span>
        {PUBLIC_NAV.map(item =>
          item.external ? (
            <a key={item.to} href={item.to} className="hover:text-wf-on-surface">
              {item.label}
            </a>
          ) : (
            <NavLink key={item.to} to={item.to} className="hover:text-wf-on-surface">
              {item.label}
            </NavLink>
          ),
        )}
      </footer>
    </div>
  );
}
