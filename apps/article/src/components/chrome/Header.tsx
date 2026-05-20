import { NavLink } from 'react-router-dom'

const publicNav = [
  { to: '/', label: 'INDEX', end: true },
  { to: '/sources', label: 'ORIGINAL SOURCES' },
  { to: '/design-system', label: 'DESIGN SYSTEM' },
  { to: '/design-guide', label: 'DESIGN GUIDE' },
]

// Capture is the only write-side route on this site; we surface it on
// the right edge of the bar (separate from the read-side nav on the
// left) so it reads as an action rather than another section.
const adminNav = [{ to: '/capture', label: 'CAPTURE' }]

export default function Header() {
  return (
    <header className="fixed top-0 left-0 w-full z-50 bg-surface/90 backdrop-blur-xl">
      <div className="flex items-center justify-between px-6 md:px-12 h-16 w-full max-w-[1440px] mx-auto">
        <nav className="hidden lg:flex gap-6 items-center">
          {publicNav.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `font-bold tracking-[-0.02em] uppercase text-xs transition-colors pb-1 ${
                  isActive
                    ? 'text-on-surface border-b-2 border-tertiary'
                    : 'text-outline hover:text-on-surface'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <NavLink to="/" className="text-2xl font-black tracking-tighter text-on-surface uppercase">
          AI NATIVE ARTICLE
        </NavLink>

        {/* Right cluster: Capture link (always visible) + tagline (md+) */}
        <div className="flex items-center gap-4 md:gap-6">
          {adminNav.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `text-[10px] md:text-xs font-bold tracking-widest uppercase border px-2 md:px-3 py-1 transition-colors ${
                  isActive
                    ? 'border-tertiary text-tertiary'
                    : 'border-outline-variant/40 text-outline hover:border-tertiary hover:text-tertiary'
                }`
              }
            >
              + {label}
            </NavLink>
          ))}
        </div>

        {/* Mobile nav (read-side only — Capture is in the right cluster
            above so it stays reachable on every viewport). */}
        <nav className="hidden">
          {publicNav
            .filter(n => n.to !== '/')
            .map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className="text-[10px] font-bold tracking-widest text-outline uppercase hover:text-on-surface"
              >
                {label.split(' ').map(w => w[0]).join('')}
              </NavLink>
            ))}
        </nav>
      </div>
    </header>
  )
}
