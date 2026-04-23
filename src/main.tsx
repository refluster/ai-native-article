import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SITE_BASE_PATH } from './config/site'
import { initAnalytics } from './lib/analytics'

initAnalytics(import.meta.env.VITE_GA_ID)

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
