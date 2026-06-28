import { NavLink } from 'react-router-dom'
import { WORKFORCE_BASE_URL } from '../../config/site'

const publicNav = [
  { to: '/', label: 'INDEX', end: true },
  { to: '/sources', label: 'ORIGINAL SOURCES' },
  { to: '/design-system', label: 'DESIGN SYSTEM' },
  { to: '/design-guide', label: 'DESIGN GUIDE' },
]

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
          {/* External cross-link to the workforce console. Cognito gates
              the destination so non-operator clicks land on the Hosted
              UI sign-in page. New tab so readers don't lose their
              place. */}
          <a
            href={WORKFORCE_BASE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold tracking-[-0.02em] uppercase text-xs transition-colors pb-1 text-outline hover:text-on-surface"
          >
            WORKFORCE ↗
          </a>
        </nav>

        <NavLink to="/" className="text-2xl font-black tracking-tighter text-on-surface uppercase">
          AI NATIVE ARTICLE
        </NavLink>

        {/* Right-edge spacer keeps the logo visually centred between the
            left nav and the right edge (the former Capture action lived
            here before the GAS pipeline UI was retired). */}
        <div aria-hidden className="hidden lg:block w-px" />

        {/* Mobile nav (read-side only). */}
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
