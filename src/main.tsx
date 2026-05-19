import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SITE_BASE_PATH } from './config/site'
import { initAnalytics } from './lib/analytics'

// Default GA4 ID for kohuehara.xyz. VITE_GA_ID still wins when set (e.g. a
// staging build with a different property), but unset → analytics is on, not off.
initAnalytics(import.meta.env.VITE_GA_ID || 'G-Q5VF5YLLDL')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${SITE_BASE_PATH}sw.js`, { scope: SITE_BASE_PATH })
      .catch(err => console.warn('SW registration failed', err))
  })
}
