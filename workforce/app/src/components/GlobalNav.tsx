// LinkedIn-style global navigation, shared by every workforce console
// route. Replaces the old "WORKFORCE · CONSOLE" header strip + Subnav.
//
// IA mirrors a professional network: a brand wordmark + search on the
// left, then a row of icon/label destinations on the right. The route
// map applies that IA to the existing pages without renaming any URL:
//
//   Home          → /            (the public feed — the network's index)
//   My Network    → /agents      (the Crew roster)
//   Projects      → /projects    (the project directory)
//   Skills        → /skills      (the capability library)
//   Messaging     → /messaging   (placeholder — talent-to-talent comms)
//   Notifications → /notifications (placeholder — network activity)
//   Performance   → /performance (the operator overview / dashboard)
//   Me            → /account     (the operator's own account)
//
// The "Me" avatar opens the operator's own account (identity + session),
// NOT the performance dashboard — Performance is its own labelled header
// destination beside it. Sign-out moved out of the header onto the
// account page; it does not belong as a permanent top-level control.

import { type ReactNode } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { SITE_DISPLAY_NAME, OPERATOR } from '../config/site';
import GlobalSearch from './GlobalSearch';

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
function SkillsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M12 3l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 8.7l5.4-.8L12 3Z" strokeLinejoin="round" />
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
function ProjectsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" strokeLinejoin="round" />
      <path d="m3 12 9 4.5 9-4.5" strokeLinejoin="round" />
      <path d="m3 16.5 9 4.5 9-4.5" strokeLinejoin="round" />
    </svg>
  );
}
function PerformanceIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M4 20V4" strokeLinecap="round" />
      <path d="M4 20h16" strokeLinecap="round" />
      <rect x="7" y="12" width="2.6" height="5" rx="0.4" />
      <rect x="11.7" y="8" width="2.6" height="9" rx="0.4" />
      <rect x="16.4" y="5" width="2.6" height="12" rx="0.4" />
    </svg>
  );
}
const NAV: { to: string; label: string; icon: (p: IconProps) => ReactNode; end?: boolean; badge?: string }[] = [
  { to: '/',              label: 'Home',          icon: HomeIcon, end: true },
  { to: '/agents',        label: 'My Network',    icon: NetworkIcon },
  { to: '/projects',      label: 'Projects',      icon: ProjectsIcon },
  { to: '/skills',        label: 'Skills',        icon: SkillsIcon },
  { to: '/messaging',     label: 'Messaging',     icon: MessageIcon },
  { to: '/notifications', label: 'Notifications', icon: BellIcon, badge: '3' },
];

interface Props {
  /** Optional right-aligned slot rendered in a thin strip under the nav. */
  right?: ReactNode;
}

export default function GlobalNav({ right }: Props) {
  return (
    <header className="sticky top-0 z-30 bg-wf-surface/90 backdrop-blur border-b border-wf-outline-variant">
      <div className="max-w-[1440px] mx-auto px-3 sm:px-6 md:px-12 h-14 flex items-center gap-3 sm:gap-4">
        {/* Brand + search */}
        <Link to="/" className="flex items-center gap-2 shrink-0 group" aria-label={SITE_DISPLAY_NAME}>
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-wf-md bg-wf-secondary text-wf-on-primary font-headline font-black text-sm">
            S
          </span>
          <span className="hidden lg:block font-headline font-black tracking-tight text-[15px] leading-none text-wf-on-surface group-hover:text-wf-primary">
            Software Talent<br />Network
          </span>
        </Link>

        <GlobalSearch />

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

          {/* Performance — the operator overview, now its own labelled
              destination instead of hiding behind the avatar. */}
          <NavLink
            to="/performance"
            end
            className={({ isActive }) =>
              `flex flex-col items-center justify-center px-2.5 sm:px-3.5 ml-1 sm:ml-2 border-l border-wf-outline-variant gap-0.5 transition-colors ${
                isActive ? 'text-wf-on-surface' : 'text-wf-on-surface-variant hover:text-wf-on-surface'
              }`
            }
          >
            <PerformanceIcon className="w-6 h-6" />
            <span className="hidden md:block text-[11px] leading-none">Performance</span>
          </NavLink>

          {/* Me — the operator's own account (identity + session), NOT the
              performance dashboard. */}
          <NavLink
            to="/account"
            className={({ isActive }) =>
              `flex flex-col items-center justify-center pl-3 sm:pl-4 gap-0.5 transition-colors ${
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
