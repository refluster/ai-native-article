// Workforce console SPA router. All routes mount under the root of the
// CloudFront-hosted workforce.kohuehara.xyz origin in production.

import { useEffect } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import AgentDirectory from './pages/AgentDirectory';
import AgentProfile from './pages/AgentProfile';
import OrgDAG from './pages/OrgDAG';
import { routerBaseName } from './lib/paths';
import { trackPageView } from '@kohuehara/shared/analytics';

function RouteTracker() {
  const location = useLocation();
  useEffect(() => {
    trackPageView();
  }, [location.pathname, location.search]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter basename={routerBaseName()}>
      <RouteTracker />
      <div className="min-h-screen flex flex-col bg-wf-surface">
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/org" element={<OrgDAG />} />
            <Route path="/agents" element={<AgentDirectory />} />
            <Route path="/agents/:slug" element={<AgentProfile />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
