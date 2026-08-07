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
import OrgChart from './pages/OrgChart';
import ProjectDirectory from './pages/ProjectDirectory';
import ProjectProfile from './pages/ProjectProfile';
import Feed from './pages/Feed';
import Reports from './pages/Reports';
import ReportView from './pages/ReportView';
import Account from './pages/Account';
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

/**
 * `/org` → `/org/chart`, carrying the one parameter the old route took.
 *
 * `?center=<slug>` was the only shape the console itself ever generated
 * (the retired AgentOrgGraph footer link), so every `/org` URL in a
 * bookmark or an old PR comment — exactly the population the redirect
 * exists for — carries it. A bare `<Navigate>` served the path and
 * dropped the state, landing the operator on 54 agents with nothing
 * highlighted (wf:freya F1).
 *
 * It maps to `q=`, not to a verbatim `center=`: the chart reads `q` and
 * `density` and nothing else, so passing `center` through would paste a
 * param no page reads into the URL bar (wf:dario). `matchesOrgQuery`
 * matches on slug, so `?center=elena` lands on the chart with elena lit.
 */
function OrgRedirect() {
  const { search } = useLocation();
  const center = new URLSearchParams(search).get('center');
  return <Navigate to={center ? `/org/chart?q=${encodeURIComponent(center)}` : '/org/chart'} replace />;
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
            {/* /org/chart is the only org view. The egocentric 1-hop
                /org (OrgDAG) was retired once the whole-org chart covered
                the same question better; /org redirects rather than 404s,
                the same treatment /feed gets below, because the old path
                is in bookmarks and in older PR comments. */}
            <Route path="/org/chart" element={<OrgChart />} />
            <Route path="/org" element={<OrgRedirect />} />
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
            <Route path="/reports" element={<Reports />} />
            <Route path="/reports/:project/:slug" element={<ReportView />} />
            <Route path="/feed" element={<Navigate to="/" replace />} />
            <Route path="/account" element={<Account />} />
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
