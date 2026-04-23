import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import Header from './components/Header'
import Footer from './components/Footer'
import Home from './pages/Home'
import Article from './pages/Article'
import DesignSystem from './pages/DesignSystem'
import DesignGuide from './pages/DesignGuide'
import L1Register from './pages/L1Register'
import L2Blog from './pages/L2Blog'
import L3Insight from './pages/L3Insight'
import L4Publish from './pages/L4Publish'
import { routerBaseName } from './lib/paths'
import { trackPageView } from './lib/analytics'

function RouteTracker() {
  const location = useLocation()
  useEffect(() => {
    trackPageView(location.pathname + location.search, document.title)
  }, [location.pathname, location.search])
  return null
}

export default function App() {
  return (
    <BrowserRouter basename={routerBaseName()}>
      <RouteTracker />
      <div className="min-h-screen flex flex-col bg-surface">
        <Header />
        <main className="flex-1 pt-16">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/article/:slug" element={<Article />} />
            <Route path="/design-system" element={<DesignSystem />} />
            <Route path="/design-guide" element={<DesignGuide />} />
            <Route path="/l1-register" element={<L1Register />} />
            <Route path="/l2-blog" element={<L2Blog />} />
            <Route path="/l3-insight" element={<L3Insight />} />
            <Route path="/l4-publish" element={<L4Publish />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  )
}
