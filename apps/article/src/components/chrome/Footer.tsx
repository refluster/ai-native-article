import { Link } from 'react-router-dom'

const publicLinks = [
  { to: '/', label: 'INDEX' },
  { to: '/design-system', label: 'DESIGN SYSTEM' },
  { to: '/design-guide', label: 'DESIGN GUIDE' },
]

export default function Footer() {
  return (
    <footer className="bg-surface-container-low">
      <div className="flex flex-col md:flex-row justify-between items-center py-12 px-6 md:px-12 w-full max-w-[1440px] mx-auto gap-6">
        <div>
          <span className="text-lg font-black text-on-surface uppercase tracking-tighter block">
            AI NATIVE ARTICLE
          </span>
          <p className="text-[10px] font-medium tracking-[0.05em] uppercase text-outline mt-2">
            © 2026 BY HARVEST. AI TRANSFORMATION IN PRECISION.
          </p>
        </div>
        <div className="flex gap-8 flex-wrap justify-center">
          {publicLinks.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className="text-[10px] font-medium tracking-[0.05em] uppercase text-outline hover:text-on-surface transition-colors"
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  )
}
