import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import Header from './components/Header'
import Footer from './components/Footer'
import Home from './pages/Home'
import Article from './pages/Article'
import DesignSystem from './pages/DesignSystem'
import DesignGuide from './pages/DesignGuide'
import Capture from './pages/Capture'
import L2Blog from './pages/L2Blog'
import L3Insight from './pages/L3Insight'
import L4Publish from './pages/L4Publish'
import Sources from './pages/Sources'
import Dashboard from './pages/workforce/Dashboard'
import AgentDirectory from './pages/workforce/AgentDirectory'
import AgentProfile from './pages/workforce/AgentProfile'
import OrgDAG from './pages/workforce/OrgDAG'
import { routerBaseName } from './lib/paths'
import { trackPageView } from './lib/analytics'

function RouteTracker() {
  const location = useLocation()
  useEffect(() => {
    // Read from window.location so page_path includes the SITE_BASE_PATH
    // (e.g. "/ai-native-article/..."). useLocation() returns paths relative
    // to BrowserRouter's basename, which would land in GA4 as "/" for the
    // landing page and collapse every route under the base into the origin.
    trackPageView()
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
            <Route path="/sources" element={<Sources />} />
            <Route path="/article/:slug" element={<Article />} />
            <Route path="/design-system" element={<DesignSystem />} />
            <Route path="/design-guide" element={<DesignGuide />} />
            <Route path="/capture" element={<Capture />} />
            {/* Legacy alias — kept so the iOS Share Sheet target keeps
                working without re-pinning. Drop in a future cleanup. */}
            <Route path="/l1-register" element={<Capture />} />
            <Route path="/l2-blog" element={<L2Blog />} />
            <Route path="/l3-insight" element={<L3Insight />} />
            <Route path="/l4-publish" element={<L4Publish />} />
            <Route path="/workforce" element={<Dashboard />} />
            <Route path="/workforce/org" element={<OrgDAG />} />
            <Route path="/workforce/agents" element={<AgentDirectory />} />
            <Route path="/workforce/agents/:slug" element={<AgentProfile />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  )
}
