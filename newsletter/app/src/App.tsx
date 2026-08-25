import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import Header from './components/chrome/Header'
import Footer from './components/chrome/Footer'
import Home from './pages/Home'
import System from './pages/System'
import Article from './pages/Article'
import Sources from './pages/Sources'
import Operator from './pages/Operator'
import DesignSystem from './pages/design/DesignSystem'
import DesignGuide from './pages/design/DesignGuide'
import Capture from './pages/pipeline/Capture'
import { routerBaseName } from './lib/paths'
import { LanguageProvider } from './i18n/LanguageProvider'
import { trackPageView } from '@kohuehara/shared/analytics'

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
  // LanguageProvider wraps the router: the reader's edition is a property of
  // the reader, not of the route, and every route needs it.
  return (
    <LanguageProvider>
      <BrowserRouter basename={routerBaseName()}>
        <RouteTracker />
        <div className="min-h-screen flex flex-col bg-surface">
          <Header />
          <main className="flex-1 pt-16">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/system" element={<System />} />
              <Route path="/sources" element={<Sources />} />
              <Route path="/operator" element={<Operator />} />
              <Route path="/article/:slug" element={<Article />} />
              <Route path="/design-system" element={<DesignSystem />} />
              <Route path="/design-guide" element={<DesignGuide />} />
              <Route path="/capture" element={<Capture />} />
              {/* Legacy alias — the PWA share-target action points here. */}
              <Route path="/l1-register" element={<Capture />} />
            </Routes>
          </main>
          <Footer />
        </div>
      </BrowserRouter>
    </LanguageProvider>
  )
}
