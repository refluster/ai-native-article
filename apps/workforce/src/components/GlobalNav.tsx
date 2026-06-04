// LinkedIn-style global navigation, shared by every workforce console
// route. Replaces the old "WORKFORCE · CONSOLE" header strip + Subnav.
//
// IA mirrors a professional network: a brand wordmark + search on the
// left, then a row of icon/label destinations on the right. The route
// map applies that IA to the existing pages without renaming any URL:
//
//   Home          → /feed     (the public feed — the network's "top")
//   My Network    → /agents   (the Crew roster)
//   Jobs          → /jobs     (placeholder — future agent↔project hiring)
//   Messaging     → /messaging (placeholder — talent-to-talent comms)
//   Notifications → /notifications (placeholder — network activity)
//   Me            → /         (the operator console / dashboard)
//
// Skills / Projects / Org are reachable from the feed's right rail.

import { type ReactNode } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { SITE_DISPLAY_NAME, OPERATOR } from '../config/site';
import { AUTH_IS_CONFIGURED } from '../config/auth';
import { signOut } from '../lib/auth';

type IconProps = { className?: string };

// Inline line-icons (24×24, currentColor) — no icon-lib dependency.
function HomeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M3 11.5 12 4l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 10.5V20h14v-9.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function NetworkIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="8" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M2.5 19c.6-3 2.9-4.6 5.5-4.6S13 16 13.5 19" strokeLinecap="round" />
      <path d="M14.6 14.6c2 .2 3.4 1.5 3.9 4" strokeLinecap="round" />
    </svg>
  );
}
function JobsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="7.5" width="18" height="12" rx="1" />
      <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5" strokeLinecap="round" />
      <path d="M3 12h18" />
    </svg>
  );
}
function MessageIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M4 5h16v11H8l-4 3.5V5Z" strokeLinejoin="round" />
    </svg>
  );
}
function BellIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2.5H4.5L6 16Z" strokeLinejoin="round" />
      <path d="M10 20a2 2 0 0 0 4 0" strokeLinecap="round" />
    </svg>
  );
}
function SearchIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" strokeLinecap="round" />
    </svg>
  );
}

const NAV: { to: string; label: string; icon: (p: IconProps) => ReactNode; end?: boolean; badge?: string }[] = [
  { to: '/feed',          label: 'Home',          icon: HomeIcon },
  { to: '/agents',        label: 'My Network',    icon: NetworkIcon },
  { to: '/jobs',          label: 'Jobs',          icon: JobsIcon },
  { to: '/messaging',     label: 'Messaging',     icon: MessageIcon },
  { to: '/notifications', label: 'Notifications', icon: BellIcon, badge: '3' },
];

interface Props {
  /** Optional right-aligned slot rendered in a thin strip under the nav. */
  right?: ReactNode;
}

export default function GlobalNav({ right }: Props) {
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-30 bg-wf-surface/90 backdrop-blur border-b border-wf-outline-variant">
      <div className="max-w-[1440px] mx-auto px-3 sm:px-6 md:px-12 h-14 flex items-center gap-3 sm:gap-4">
        {/* Brand + search */}
        <Link to="/feed" className="flex items-center gap-2 shrink-0 group" aria-label={SITE_DISPLAY_NAME}>
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-wf-sm bg-wf-secondary text-wf-on-primary font-headline font-black text-sm">
            S
          </span>
          <span className="hidden lg:block font-headline font-black tracking-tight text-[15px] leading-none text-wf-on-surface group-hover:text-wf-primary">
            Software Talent<br />Network
          </span>
        </Link>

        <form
          onSubmit={(e) => { e.preventDefault(); navigate('/agents'); }}
          className="hidden sm:flex items-center gap-2 bg-wf-surface-container rounded-wf-sm px-3 h-9 w-44 md:w-64 focus-within:ring-1 focus-within:ring-wf-primary"
          role="search"
        >
          <SearchIcon className="w-4 h-4 text-wf-on-surface-variant shrink-0" />
          <input
            type="search"
            aria-label="Search the network"
            placeholder="Search talent, skills…"
            className="bg-transparent text-sm text-wf-on-surface placeholder:text-wf-on-surface-variant w-full focus:outline-none"
          />
        </form>

        {/* Destinations */}
        <nav className="flex items-stretch ml-auto h-full">
          {NAV.map(({ to, label, icon: Icon, end, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `relative flex flex-col items-center justify-center px-2.5 sm:px-3.5 gap-0.5 border-b-2 transition-colors ${
                  isActive
                    ? 'border-wf-on-surface text-wf-on-surface'
                    : 'border-transparent text-wf-on-surface-variant hover:text-wf-on-surface'
                }`
              }
            >
              <span className="relative">
                <Icon className="w-6 h-6" />
                {badge && (
                  <span className="absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-1 rounded-full bg-wf-tertiary text-wf-on-tertiary text-[9px] font-bold flex items-center justify-center">
                    {badge}
                  </span>
                )}
              </span>
              <span className="hidden md:block text-[11px] leading-none">{label}</span>
            </NavLink>
          ))}

          {/* Me — links to the operator console (dashboard). */}
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `flex flex-col items-center justify-center pl-3 sm:pl-4 ml-1 sm:ml-2 border-l border-wf-outline-variant gap-0.5 transition-colors ${
                isActive ? 'text-wf-on-surface' : 'text-wf-on-surface-variant hover:text-wf-on-surface'
              }`
            }
          >
            <span
              className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-wf-primary text-wf-on-primary font-headline font-bold text-[10px]"
              aria-hidden
            >
              {OPERATOR.initials}
            </span>
            <span className="hidden md:block text-[11px] leading-none">Me</span>
          </NavLink>

          {AUTH_IS_CONFIGURED && (
            <button
              type="button"
              onClick={() => { void signOut(); }}
              className="hidden sm:flex items-center font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant hover:text-wf-tertiary pl-3 ml-2 border-l border-wf-outline-variant"
            >
              Sign out
            </button>
          )}
        </nav>
      </div>

      {right && (
        <div className="border-t border-wf-outline-variant bg-wf-surface-container-lo">
          <div className="max-w-[1440px] mx-auto px-3 sm:px-6 md:px-12 h-9 flex items-center justify-end">
            {right}
          </div>
        </div>
      )}
    </header>
  );
}
