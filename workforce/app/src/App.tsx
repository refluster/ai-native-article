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
import Landing from './pages/Landing';
import Research from './pages/Research';
import ResearchArticle from './pages/ResearchArticle';
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
 * `?center=<slug>` was the only parameter `/org` ever took: the profile
 * footer generated it, while Home and the chart's stat band linked the
 * bare path. Both shapes are handled. A bare `<Navigate>` served the path
 * and dropped the state, landing an operator who followed a `?center=`
 * bookmark on 54 agents with nothing highlighted (wf:freya F1, PR 558).
 *
 * It maps to `q=`, not to a verbatim `center=`: the chart reads `q` and
 * `density` and nothing else, so passing `center` through would paste a
 * param no page reads into the URL bar (wf:dario). Note `matchesOrgQuery`
 * is a substring match over slug/name/role/residence, not a slug lookup,
 * so a short slug can light more than one row — acceptable here, because
 * the chart dims non-matches rather than filtering them out (wf:dario D6).
 *
 * The carry is a best-effort **highlight**, not a **focus**: `center` was
 * an exact slug lookup on the retired view, `q` is not, so a short slug
 * can land more than one row lit. The header states `N of 54 highlighted`
 * honestly and the field is editable on arrival (wf:freya F7, PR 558).
 *
 * (Finding-ids are per-review, so citations carry a PR anchor. Write it
 * `PR 558`, not with a leading hash: a three-digit hash-number is a valid
 * hex colour, so the R-2 design-token lint rejects it in app source. This
 * comment cannot show the rejected form without tripping the lint itself.)
 *
 * `encodeURIComponent` is load-bearing, not decorative: without it
 * `/org?center=a%26density%3Ddetail` would smuggle a `density` the chart
 * actually reads. Pinned by a test (wf:dario D7).
 */
function OrgRedirect() {
  const { search } = useLocation();
  const center = new URLSearchParams(search).get('center');
  return <Navigate to={center ? `/org/chart?q=${encodeURIComponent(center)}` : '/org/chart'} replace />;
}

function DocsIndexRedirect() {
  useEffect(() => {
    window.location.replace('/docs/index.html');
  }, []);
  return null;
}

function ProtectedRoutes() {
  return (
    <AuthBoundary>
      <div className="min-h-screen flex flex-col bg-wf-surface">
        <main className="flex-1">
          <Routes>
            {/* The feed is the console's index, at /feed. The apex now
                serves the public landing page, so the console's own home
                links point here; the operator overview ("Performance")
                lives at /performance. */}
            <Route path="/feed" element={<Feed />} />
            <Route path="/performance" element={<Dashboard />} />
            {/* /org/chart is the only org view. The egocentric 1-hop
                /org (OrgDAG) was retired once the whole-org chart covered
                the same question better; /org redirects rather than 404s,
                the same treatment old paths get here, because the old
                path is in bookmarks and in older PR comments. */}
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
        {/* Public surfaces. The apex is a landing page for visitors,
            /research is the article corpus, and /docs/ is a set of static
            documents served straight from S3;
            the bare /docs path only reaches the router when CloudFront's
            404 fallback runs (S3 has no directory index), so it forwards
            to the real object. Everything else stays behind AuthBoundary. */}
        <Route path="/" element={<Landing />} />
        {/* Research is the article corpus (kohuehara.xyz/ai-native-article/)
            read into the console's own chrome — public, like Docs, so the
            landing header can link it beside Docs. */}
        <Route path="/research" element={<Research />} />
        <Route path="/research/:slug" element={<ResearchArticle />} />
        <Route path="/docs" element={<DocsIndexRedirect />} />
        <Route path="*" element={<ProtectedRoutes />} />
      </Routes>
    </BrowserRouter>
  );
}
