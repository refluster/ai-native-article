import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { initAnalytics } from '@kohuehara/shared/analytics';

// Same GA4 property as the article SPA — workforce.kohuehara.xyz is reported
// under the kohuehara.xyz account. VITE_GA_ID still wins when set (e.g. a
// staging build with a different property), but unset → analytics is on, not
// off, matching newsletter/app/src/main.tsx.
initAnalytics(import.meta.env.VITE_GA_ID || 'G-Q5VF5YLLDL');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
