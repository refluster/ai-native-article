import { NavLink } from 'react-router-dom'
import LanguageToggle from './LanguageToggle'

// Keep the reader index primary, with one deliberate path for visitors who
// want to understand the operating system behind the publication.
const publicNav = [
  { to: '/', label: 'INDEX', end: true },
  { to: '/system', label: 'SYSTEM', end: true },
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
        </nav>

        <NavLink to="/" className="text-xl md:text-2xl font-black tracking-tighter text-on-surface uppercase">
          AI NATIVE ARTICLE
        </NavLink>

        <div className="flex items-center gap-4 md:gap-6">
          <NavLink
            to="/system"
            className={({ isActive }) =>
              `lg:hidden text-[10px] font-bold tracking-widest uppercase ${isActive ? 'text-tertiary' : 'text-outline'}`
            }
          >
            SYSTEM
          </NavLink>
          <LanguageToggle />
        </div>
      </div>
    </header>
  )
}
