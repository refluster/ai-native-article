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
//   Reports       → /reports     (published reports)
//   Messaging     → /messaging   (placeholder — talent-to-talent comms)
//   Notifications → /notifications (placeholder — network activity)
//   Performance   → /performance (the operator overview / dashboard)
//   Me            → /account     (the operator's own account)
//
// The "Me" avatar opens the operator's own account (identity + session),
// NOT the performance dashboard — Performance is its own labelled header
// destination beside it. Sign-out moved out of the header onto the
// account page; it does not belong as a permanent top-level control.
//
// Responsive shape (2026-07-26). Nine destinations no longer fit a phone
// header — the icon row used to overflow the viewport. From `md` up the
// row renders exactly as before; below it the destinations collapse into a
// hamburger that opens a right-hand drawer. The drawer is built from the
// SAME NAV data as the desktop row (one source, one order, one set of
// icons and labels), so the two breakpoints can't drift apart; it only
// adds the grouping headers a vertical list needs to stay scannable.

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { SITE_DISPLAY_NAME, SITE_TAGLINE, OPERATOR } from '../config/site';
import BrandMark from './BrandMark';
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
function ReportsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth={1.8}>
      <path d="M6 3h9l4 4v14H6V3Z" strokeLinejoin="round" />
      <path d="M15 3v4h4" strokeLinejoin="round" />
      <path d="M9 12h6M9 16h6" strokeLinecap="round" />
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
function MenuIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth={1.9}>
      <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
    </svg>
  );
}
function CloseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth={1.9}>
      <path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" />
    </svg>
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: (p: IconProps) => ReactNode;
  end?: boolean;
  badge?: string;
}

const NAV: NavItem[] = [
  { to: '/',              label: 'Home',          icon: HomeIcon, end: true },
  { to: '/agents',        label: 'My Network',    icon: NetworkIcon },
  { to: '/projects',      label: 'Projects',      icon: ProjectsIcon },
  { to: '/skills',        label: 'Skills',        icon: SkillsIcon },
  { to: '/reports',       label: 'Reports',       icon: ReportsIcon },
  { to: '/messaging',     label: 'Messaging',     icon: MessageIcon },
  { to: '/notifications', label: 'Notifications', icon: BellIcon, badge: '3' },
];

const PERFORMANCE: NavItem = { to: '/performance', label: 'Performance', icon: PerformanceIcon, end: true };

// The drawer's vertical grouping. Same items, same order as the desktop
// row — headers only exist because a stacked list needs the scent that a
// horizontal row gets for free from adjacency.
const DRAWER_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: 'Network', items: NAV.slice(0, 4) },
  { title: 'Work',    items: [NAV[4], PERFORMANCE] },
  { title: 'Inbox',   items: NAV.slice(5) },
];

/** Number shown on the hamburger when the drawer is closed. */
const UNREAD = NAV.find((n) => n.to === '/notifications')?.badge;

/** Drawer slide/fade duration. Short on purpose — the drawer is a
 *  navigation affordance, so it should feel like the panel was already
 *  there rather than like an animation you wait through. Must stay in sync
 *  with the `duration-200` utilities on the panel and backdrop below; it is
 *  the timer that unmounts the drawer after its exit transition. */
const MENU_ANIM_MS = 200;

type MenuState = 'closed' | 'open' | 'closing';

function Badge({ value, className = '' }: { value: string; className?: string }) {
  return (
    <span
      className={`min-w-[15px] h-[15px] px-1 rounded-full bg-wf-tertiary text-wf-on-tertiary text-[9px] font-bold flex items-center justify-center ${className}`}
    >
      {value}
    </span>
  );
}

interface Props {
  /** Optional right-aligned slot rendered in a thin strip under the nav. */
  right?: ReactNode;
}

export default function GlobalNav({ right }: Props) {
  // Three states, not a boolean: the drawer has to stay mounted through its
  // exit transition, so "the operator wants it closed" and "it is gone" are
  // different moments. Every dismissal path — Escape, backdrop, ✕,
  // navigation — goes through `closeMenu` so they all animate identically.
  const [menuState, setMenuState] = useState<MenuState>('closed');
  const menuOpen = menuState === 'open';
  const closeMenu = useCallback(
    () => setMenuState((s) => (s === 'open' ? 'closing' : s)),
    [],
  );
  const location = useLocation();

  // Unmount once the exit transition has played out.
  useEffect(() => {
    if (menuState !== 'closing') return;
    const t = setTimeout(() => setMenuState('closed'), MENU_ANIM_MS);
    return () => clearTimeout(t);
  }, [menuState]);

  // Close on navigation — otherwise the drawer covers the page it just
  // routed to.
  useEffect(() => {
    closeMenu();
  }, [location.pathname, location.search, closeMenu]);

  // Escape closes; the page behind must not scroll while it's open. The
  // scroll lock spans `closing` too, so the page doesn't lurch under a
  // drawer that is still visibly on screen.
  useEffect(() => {
    if (menuState === 'closed') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [menuState, closeMenu]);

  return (
    <>
      <header className="sticky top-0 z-30 bg-wf-surface/90 backdrop-blur border-b border-wf-outline-variant">
        <div className="max-w-[1440px] mx-auto px-3 sm:px-6 md:px-12 h-14 flex items-center gap-3 sm:gap-4">
        {/* Brand + search */}
        <Link to="/" className="flex items-center gap-2 shrink-0 group" aria-label={SITE_DISPLAY_NAME}>
          <BrandMark size={32} />
          <span className="hidden lg:block font-headline font-black tracking-tight text-[15px] leading-none text-wf-on-surface group-hover:text-wf-primary">
            Software Talent<br />Network
          </span>
        </Link>

        <GlobalSearch />

        {/* Destinations — the full row from md up. */}
        <nav className="hidden md:flex items-stretch ml-auto h-full">
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
                {badge && <Badge value={badge} className="absolute -top-1.5 -right-2" />}
              </span>
              <span className="text-[11px] leading-none">{label}</span>
            </NavLink>
          ))}

          {/* Performance — the operator overview, now its own labelled
              destination instead of hiding behind the avatar. */}
          <NavLink
            to={PERFORMANCE.to}
            end
            className={({ isActive }) =>
              `flex flex-col items-center justify-center px-2.5 sm:px-3.5 ml-1 sm:ml-2 border-l border-wf-outline-variant gap-0.5 transition-colors ${
                isActive ? 'text-wf-on-surface' : 'text-wf-on-surface-variant hover:text-wf-on-surface'
              }`
            }
          >
            <PerformanceIcon className="w-6 h-6" />
            <span className="text-[11px] leading-none">Performance</span>
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
            <span className="text-[11px] leading-none">Me</span>
          </NavLink>
        </nav>

        {/* Hamburger — phones and small tablets. */}
        <button
          type="button"
          onClick={() => setMenuState('open')}
          aria-label="Open menu"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className="md:hidden ml-auto relative shrink-0 w-10 h-10 -mr-1 flex items-center justify-center text-wf-on-surface-variant hover:text-wf-on-surface rounded-wf-sm"
        >
          <MenuIcon className="w-6 h-6" />
          {UNREAD && <Badge value={UNREAD} className="absolute top-1 right-0.5" />}
        </button>
      </div>

        {right && (
          <div className="border-t border-wf-outline-variant bg-wf-surface-container-lo">
            <div className="max-w-[1440px] mx-auto px-3 sm:px-6 md:px-12 h-9 flex items-center justify-end">
              {right}
            </div>
          </div>
        )}
      </header>

      {/* The drawer lives OUTSIDE <header>: the header carries
          `backdrop-blur`, and a backdrop-filter establishes a containing
          block for fixed descendants — nesting the drawer there would pin
          `inset-0` to the 56px header box instead of the viewport. */}
      {menuState !== 'closed' && <MobileMenu open={menuOpen} onClose={closeMenu} />}
    </>
  );
}

// ── Drawer ─────────────────────────────────────────────────────────────
// Slides in from the right with the backdrop fading alongside it. The
// enter transition needs the panel to be painted OFF-screen for one frame
// before it moves, or the browser has nothing to interpolate from and the
// drawer just appears — hence `entered`, flipped on the frame after mount.
// On exit the parent keeps this mounted (state `closing`) for exactly
// MENU_ANIM_MS so the reverse transition can play.
//
// `motion-reduce:transition-none` keeps the same open/close semantics
// without the movement, matching how the skeletons opt out of their
// shimmer.
function MobileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const shown = open && entered;

  return (
    <div className="md:hidden fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Menu">
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className={`absolute inset-0 bg-wf-on-surface/40 w-full h-full cursor-default transition-opacity duration-200 ease-out motion-reduce:transition-none ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        className={`absolute inset-y-0 right-0 w-[86%] max-w-[20rem] bg-wf-surface-container-lo border-l border-wf-outline-variant shadow-lg flex flex-col overflow-y-auto transition-transform duration-200 ease-out motion-reduce:transition-none ${
          shown ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Operator card — the drawer's "Me" destination, given the space
            the header can't spare. */}
        <div className="flex items-start gap-3 p-4 border-b border-wf-outline-variant">
          <Link to="/account" className="flex items-center gap-3 min-w-0 flex-1 group">
            <span className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-wf-primary text-wf-on-primary font-headline font-black text-sm shrink-0">
              {OPERATOR.initials}
            </span>
            <span className="min-w-0">
              <span className="block font-headline font-bold text-wf-on-surface truncate group-hover:text-wf-primary">
                {OPERATOR.name}
              </span>
              <span className="block text-[11px] text-wf-on-surface-variant truncate">
                {OPERATOR.headline}
              </span>
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="shrink-0 w-9 h-9 -mt-1 -mr-1 flex items-center justify-center text-wf-on-surface-variant hover:text-wf-on-surface rounded-wf-sm"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 py-2">
          {DRAWER_GROUPS.map((group) => (
            <div key={group.title} className="py-1">
              <div className="px-4 pt-2 pb-1 font-wfmono text-[9px] uppercase tracking-[0.18em] text-wf-on-surface-variant">
                {group.title}
              </div>
              <ul>
                {group.items.map(({ to, label, icon: Icon, end, badge }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      end={end}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-4 py-3 border-l-2 transition-colors ${
                          isActive
                            ? 'border-wf-on-surface text-wf-on-surface bg-wf-surface-container font-semibold'
                            : 'border-transparent text-wf-on-surface-variant hover:bg-wf-surface-container hover:text-wf-on-surface'
                        }`
                      }
                    >
                      <Icon className="w-5 h-5 shrink-0" />
                      <span className="text-sm flex-1">{label}</span>
                      {badge && <Badge value={badge} />}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-wf-outline-variant p-4 flex items-center gap-2.5">
          <BrandMark size={28} />
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-wf-on-surface truncate">
              {SITE_DISPLAY_NAME}
            </span>
            <span className="block text-[10px] text-wf-on-surface-variant truncate">{SITE_TAGLINE}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
