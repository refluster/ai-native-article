import { NavLink } from 'react-router-dom'

// Daily-use first: the public header carries the reader's home and nothing
// else. Operator surfaces (design system/guide, capture, workforce console,
// original sources) live behind the /operator page, linked discreetly from
// the footer — they're tools, not reading destinations.
const publicNav = [{ to: '/', label: 'INDEX', end: true }]

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

        {/* Right cluster intentionally empty — kept as a flex spacer so the
            wordmark stays centred between it and the left nav. */}
        <div className="flex items-center gap-4 md:gap-6" aria-hidden="true" />
      </div>
    </header>
  )
}
