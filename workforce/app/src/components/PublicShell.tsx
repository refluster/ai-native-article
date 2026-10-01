// Chrome for the console's PUBLIC surfaces — the landing page at the apex,
// Docs under /docs and the Research reader under /research. These render
// outside AuthBoundary, so they get neither GlobalNav (whose destinations
// are all gated) nor the operator card; instead a thin header carries the
// brand, the two public destinations (Docs, Research) and the sign-in /
// open-console action. One shell, one design, for every page a visitor
// can reach without signing in.
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
import { PILL_PRIMARY_SM } from './public/styles';

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

/** Public header destinations, in order. Both are router routes now that
 *  Docs is rendered by the SPA (pages/Docs.tsx, pages/Doc.tsx). */
export const PUBLIC_NAV: { to: string; label: string }[] = [
  { to: '/docs', label: 'Docs' },
  { to: '/research', label: 'Research' },
];

const NAV_LINK = 'font-wfmono text-[11px] uppercase tracking-[0.16em] transition-colors';

interface Props {
  children: ReactNode;
  /** Max width of the header/main/footer column. Prose pages read best
   *  narrow; the Research index wants the console's wider grid. */
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
          {/* The wordmark yields to the mark alone on phones: three
              wrapped lines of brand next to the nav is not a header. */}
          <span className="hidden sm:inline font-headline font-bold text-[15px] whitespace-nowrap group-hover:text-wf-primary">
            {SITE_DISPLAY_NAME}
          </span>
        </NavLink>
        <nav className="flex items-center gap-3 sm:gap-5" aria-label="Public">
          {PUBLIC_NAV.map(item => (
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
          ))}
          <button type="button" onClick={enterConsole} className={PILL_PRIMARY_SM}>
            {signedIn ? 'Open console' : 'Sign in'}
          </button>
        </nav>
      </header>

      <main className={`flex-1 w-full ${column} mx-auto px-6`}>{children}</main>

      {/* No rule above the footer: it sits under generous space and reads
          as the page's last line, the way the rest of the site separates
          things — by whitespace, not by lines. */}
      <footer
        className={`w-full ${column} mx-auto px-6 pt-16 pb-10 font-wfmono text-[11px] uppercase tracking-[0.14em] text-wf-on-surface-variant flex flex-wrap gap-x-6 gap-y-2`}
      >
        <span>{SITE_DISPLAY_NAME}</span>
        {PUBLIC_NAV.map(item => (
          <NavLink key={item.to} to={item.to} className="hover:text-wf-on-surface">
            {item.label}
          </NavLink>
        ))}
      </footer>
    </div>
  );
}
