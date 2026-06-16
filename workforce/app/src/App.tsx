// Workforce console SPA router. All routes mount under the root of the
// CloudFront-hosted workforce.kohuehara.xyz origin in production.
//
// /auth/callback bypasses AuthBoundary — that route IS the sign-in
// completion handler; gating it behind authentication would deadlock.

import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import AgentDirectory from './pages/AgentDirectory';
import AgentProfile from './pages/AgentProfile';
import SkillDirectory from './pages/SkillDirectory';
import SkillProfile from './pages/SkillProfile';
import SearchResults from './pages/SearchResults';
import OrgDAG from './pages/OrgDAG';
import ProjectDirectory from './pages/ProjectDirectory';
import ProjectProfile from './pages/ProjectProfile';
import Feed from './pages/Feed';
import Jobs from './pages/Jobs';
import Messaging from './pages/Messaging';
import Notifications from './pages/Notifications';
import AuthCallback from './pages/AuthCallback';
import AuthBoundary from './components/AuthBoundary';
import { routerBaseName } from './lib/paths';
import { trackPageView } from '@kohuehara/shared/analytics';

function RouteTracker() {
  const location = useLocation();
  useEffect(() => {
    trackPageView();
  }, [location.pathname, location.search]);
  return null;
}

function ProtectedRoutes() {
  return (
    <AuthBoundary>
      <div className="min-h-screen flex flex-col bg-wf-surface">
        <main className="flex-1">
          <Routes>
            {/* The feed is the network's index. The operator overview
                ("Performance") moved to /performance; /feed redirects to
                the index so existing links keep working. */}
            <Route path="/" element={<Feed />} />
            <Route path="/performance" element={<Dashboard />} />
            <Route path="/org" element={<OrgDAG />} />
            <Route path="/agents" element={<AgentDirectory />} />
            <Route path="/agents/:slug" element={<AgentProfile />} />
            <Route path="/skills" element={<SkillDirectory />} />
            <Route path="/skills/:name" element={<SkillProfile />} />
            <Route path="/search" element={<SearchResults />} />
            <Route path="/projects" element={<ProjectDirectory />} />
            {/* Project ids may contain `/` (e.g. `self/ren`). Use a
                wildcard `*` so the whole remainder is captured as one
                parameter, accessible inside the page via
                `useParams()['*']`. */}
            <Route path="/projects/*" element={<ProjectProfile />} />
            <Route path="/feed" element={<Navigate to="/" replace />} />
            <Route path="/jobs" element={<Jobs />} />
            <Route path="/messaging" element={<Messaging />} />
            <Route path="/notifications" element={<Notifications />} />
          </Routes>
        </main>
      </div>
    </AuthBoundary>
  );
}

export default function App() {
  return (
    <BrowserRouter basename={routerBaseName()}>
      <RouteTracker />
      <Routes>
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="*" element={<ProtectedRoutes />} />
      </Routes>
    </BrowserRouter>
  );
}
