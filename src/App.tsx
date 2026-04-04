import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Header from './components/Header'
import Footer from './components/Footer'
import Home from './pages/Home'
import Article from './pages/Article'
import DesignSystem from './pages/DesignSystem'
import DesignGuide from './pages/DesignGuide'
import { routerBaseName } from './lib/paths'

export default function App() {
  return (
    <BrowserRouter basename={routerBaseName()}>
      <div className="min-h-screen flex flex-col bg-surface">
        <Header />
        <main className="flex-1 pt-16">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/article/:slug" element={<Article />} />
            <Route path="/design-system" element={<DesignSystem />} />
            <Route path="/design-guide" element={<DesignGuide />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  )
}
