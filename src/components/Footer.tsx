import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="bg-surface-container-low border-t border-outline-variant/15">
      <div className="flex flex-col md:flex-row justify-between items-center py-12 px-6 md:px-12 w-full max-w-[1440px] mx-auto gap-6">
        <div>
          <span className="text-lg font-black text-on-surface uppercase tracking-tighter block">
            AI NATIVE ARTICLE
          </span>
          <p className="text-[10px] font-medium tracking-[0.05em] uppercase text-outline mt-2">
            © 2026 L3 INSIGHTS BY HARVEST. AI TRANSFORMATION IN PRECISION.
          </p>
        </div>
        <div className="flex gap-8 flex-wrap justify-center">
          <Link to="/" className="text-[10px] font-medium tracking-[0.05em] uppercase text-outline hover:text-on-surface transition-colors">
            INDEX
          </Link>
          <Link to="/l1-register" className="text-[10px] font-medium tracking-[0.05em] uppercase text-outline hover:text-on-surface transition-colors">
            L1: REGISTER
          </Link>
          <Link to="/l2-blog" className="text-[10px] font-medium tracking-[0.05em] uppercase text-outline hover:text-on-surface transition-colors">
            L2: BLOG
          </Link>
          <Link to="/l3-insight" className="text-[10px] font-medium tracking-[0.05em] uppercase text-outline hover:text-on-surface transition-colors">
            L3: INSIGHT
          </Link>
          <Link to="/l4-publish" className="text-[10px] font-medium tracking-[0.05em] uppercase text-outline hover:text-on-surface transition-colors">
            L4: PUBLISH
          </Link>
          <Link to="/design-system" className="text-[10px] font-medium tracking-[0.05em] uppercase text-outline hover:text-on-surface transition-colors">
            DESIGN SYSTEM
          </Link>
          <Link to="/design-guide" className="text-[10px] font-medium tracking-[0.05em] uppercase text-outline hover:text-on-surface transition-colors">
            DESIGN GUIDE
          </Link>
        </div>
      </div>
    </footer>
  )
}
