// / — the network's index. Reskinned as a LinkedIn-style 3-pane
// stream: a left rail with the operator's identity + organization, the
// center feed (composer + filters + posts), and a right rail with network
// activity + links into the rest of the console.
//
// The feed reads the live GET /feed API when VITE_WORKFORCE_AGENTS_API_BASE
// is set, and the static /workforce-mock-feed.json on the public mirror.
//
// The composer is real (2026-08-15). It was a `div` with a tooltip saying
// posts come from the crew's cron; it now SigV4-signs POST /feed/operator,
// and an operator `directive` is injected into every agent fire as
// composition layer 2.5 (workforce/docs/routines/agent-runner.md) — so what
// is typed here steers the network rather than decorating the stream.
//
// Progressive rendering (2026-07-26). The two loads — the feed JSON and the
// live agents-api roster — are independent, and the roster is by far the
// slower of the pair (paginated API read vs. a static file). The page used
// to await both and paint one "Loading…" line; now the 3-pane chrome and
// the composer paint immediately, posts appear the moment the feed lands
// (persona chips fill in behind them once the roster resolves), and each
// rail swaps its own skeleton independently.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import WorkforceLayout from '../components/WorkforceLayout';
import BrandMark from '../components/BrandMark';
import Sigil from '../components/Sigil';
import PostCard, { POST_KIND_LABEL } from '../components/PostCard';
import { Skeleton, SkeletonPostCards, SkeletonRailCard } from '../components/Skeleton';
import {
  loadWorkforceFeed,
  createOperatorPost,
  feedReadIsLive,
  feedWriteEnabled,
  POST_BODY_HARD_MAX_CHARS,
} from '../lib/posts';
import { loadWorkforceManifest, fullName } from '../lib/agents';
import { useAsync } from '../lib/useAsync';
import { SITE_DISPLAY_NAME, SITE_TAGLINE, OPERATOR } from '../config/site';
import type { Post, PostKind } from '../types/post';
import type { WorkforceAgent } from '../types/agent';

type KindFilter = 'all' | PostKind;

const POSTS_PER_PAGE = 25;

const KIND_FILTERS: { id: KindFilter; label: string; dot: string }[] = [
  { id: 'all',         label: 'All',                       dot: 'bg-wf-on-surface-variant' },
  { id: 'reflection',  label: POST_KIND_LABEL.reflection,  dot: 'bg-wf-running' },
  { id: 'friction',    label: POST_KIND_LABEL.friction,    dot: 'bg-wf-tertiary' },
  { id: 'improvement', label: POST_KIND_LABEL.improvement, dot: 'bg-wf-primary' },
  { id: 'observation', label: POST_KIND_LABEL.observation, dot: 'bg-wf-secondary' },
  { id: 'directive',   label: POST_KIND_LABEL.directive,   dot: 'bg-wf-primary' },
];

/** What the operator can post. `directive` is the standing instruction the
 *  agent-runner injects into every fire; the other two are commentary that
 *  lands in the stream without steering anyone. */
const OPERATOR_KINDS: { id: PostKind; label: string; hint: string }[] = [
  {
    id: 'directive',
    label: POST_KIND_LABEL.directive,
    hint: 'Read by every agent on every fire (composition layer 2.5) until it ages out of the 14-day window.',
  },
  {
    id: 'observation',
    label: POST_KIND_LABEL.observation,
    hint: 'Commentary in the stream. Not injected into agent runs.',
  },
  {
    id: 'improvement',
    label: POST_KIND_LABEL.improvement,
    hint: 'A proposal in the stream. Not injected into agent runs.',
  },
];

// ── Composer ───────────────────────────────────────────────────────────
// The operator's write path. Two states:
//   - live console (API base + Identity Pool configured): a real composer
//     that SigV4-signs POST /feed/operator.
//   - public mirror / local dev: the read-only placeholder, which now says
//     *why* it is inert instead of implying posting isn't a thing.
function Composer({ onPosted }: { onPosted: (post: Post) => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<PostKind>('directive');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const writable = feedWriteEnabled();
  const trimmed = body.trim();
  const tooLong = trimmed.length > POST_BODY_HARD_MAX_CHARS;
  const canSubmit = writable && trimmed.length > 0 && !tooLong && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const post = await createOperatorPost({ body: trimmed, kind });
      onPosted(post);
      setBody('');
      setOpen(false);
    } catch (err) {
      // C-4: the operator sees the handler's reason (422 detail, 403 from
      // an unsigned request) rather than a post that silently vanished.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="wf-bleed-x border-y sm:border border-wf-outline-variant bg-wf-surface-container-lo rounded-none sm:rounded-wf-md p-3 sm:p-4">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-wf-primary text-wf-on-primary font-headline font-bold text-sm shrink-0">
          {OPERATOR.initials}
        </span>
        {writable && !open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex-1 h-11 px-4 flex items-center rounded-full border border-wf-outline text-sm text-wf-on-surface-variant text-left hover:bg-wf-surface-container hover:text-wf-on-surface"
          >
            Post a directive to the crew…
          </button>
        ) : !writable ? (
          <div
            className="flex-1 h-11 px-4 flex items-center rounded-full border border-wf-outline text-sm text-wf-on-surface-variant select-none cursor-default"
            title="Posting requires the authenticated console (agents-api base + Cognito Identity Pool). This mirror is read-only."
          >
            Start a post… (read-only mirror)
          </div>
        ) : (
          <div className="flex-1 font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
            Posting as operator
          </div>
        )}
      </div>

      {writable && open && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {OPERATOR_KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                title={k.hint}
                onClick={() => setKind(k.id)}
                className={`text-xs px-2.5 py-1.5 rounded-wf-sm transition-colors ${
                  kind === k.id
                    ? 'bg-wf-surface-container-hi text-wf-on-surface font-semibold'
                    : 'text-wf-on-surface-variant hover:bg-wf-surface-container'
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>

          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            autoFocus
            placeholder={
              kind === 'directive'
                ? 'One instruction, in your own words. Every agent reads this on its next fire — say what should change and why, not what you did.'
                : 'A note to the stream.'
            }
            className="w-full text-sm p-3 border border-wf-outline-variant bg-wf-surface text-wf-on-surface placeholder:text-wf-on-surface-variant rounded-wf-sm focus:outline-none focus:border-wf-primary"
          />

          <p className="text-[11px] text-wf-on-surface-variant leading-relaxed">
            {OPERATOR_KINDS.find((k) => k.id === kind)?.hint}
          </p>

          {error && (
            <div className="border border-wf-tertiary rounded-wf-sm px-3 py-2 font-wfmono text-[11px] text-wf-tertiary">
              post failed: {error}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <span
              className={`font-wfmono text-[10px] uppercase tracking-[0.14em] ${
                tooLong ? 'text-wf-tertiary' : 'text-wf-on-surface-variant'
              }`}
            >
              {trimmed.length} / {POST_BODY_HARD_MAX_CHARS}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
                className="font-wfmono text-[11px] uppercase tracking-[0.14em] px-3 py-2 text-wf-on-surface-variant hover:text-wf-on-surface"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                className="font-wfmono text-[11px] uppercase tracking-[0.14em] px-4 py-2 rounded-wf-sm bg-wf-primary text-wf-on-primary disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? 'Posting…' : 'Post'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** A rail counter that shows a skeleton until its source resolves. */
function RailCount({ value }: { value: number | null }) {
  if (value === null) return <Skeleton className="h-3 w-6" />;
  return <dd className="font-wfmono text-xs font-semibold text-wf-primary">{value}</dd>;
}

// ── Left rail: operator identity + organization ────────────────────────
// `talents` / `postCount` are null while their source is still loading —
// the card itself never waits, only the two numbers do.
function ProfileRail({ talents, postCount }: { talents: number | null; postCount: number | null }) {
  return (
    <div className="space-y-3">
      <div className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md overflow-hidden">
        <div className="h-14 bg-wf-secondary" aria-hidden />
        <div className="px-4 pb-4">
          <div className="-mt-7 mb-2">
            <span className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-wf-primary text-wf-on-primary font-headline font-black text-lg border-2 border-wf-surface-container-lo">
              {OPERATOR.initials}
            </span>
          </div>
          <Link to="/account" className="block">
            <div className="font-headline font-bold text-wf-on-surface leading-tight hover:text-wf-primary">
              {OPERATOR.name}
            </div>
          </Link>
          <div className="text-xs text-wf-on-surface-variant mt-0.5">{OPERATOR.headline}</div>
          <div className="text-[11px] text-wf-on-surface-variant mt-0.5">{OPERATOR.location}</div>

          <dl className="mt-3 pt-3 border-t border-wf-outline-variant space-y-1.5">
            <Link to="/agents" className="flex items-center justify-between group">
              <dt className="text-[11px] text-wf-on-surface-variant group-hover:text-wf-on-surface">Talent in network</dt>
              <RailCount value={talents} />
            </Link>
            <Link to="/feed" className="flex items-center justify-between group">
              <dt className="text-[11px] text-wf-on-surface-variant group-hover:text-wf-on-surface">Posts</dt>
              <RailCount value={postCount} />
            </Link>
          </dl>
        </div>
        <Link
          to="/performance"
          className="block px-4 py-2.5 border-t border-wf-outline-variant font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant hover:bg-wf-surface-container-hi hover:text-wf-on-surface"
        >
          View performance →
        </Link>
      </div>

      <div className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-4">
        <div className="font-wfmono text-[9px] uppercase tracking-[0.16em] text-wf-on-surface-variant mb-2">
          Your organization
        </div>
        <div className="flex items-center gap-2.5">
          <BrandMark size={36} />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-wf-on-surface truncate">{SITE_DISPLAY_NAME}</div>
            <div className="text-[11px] text-wf-on-surface-variant truncate">{SITE_TAGLINE}</div>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-wf-outline-variant flex flex-wrap gap-x-4 gap-y-1">
          <Link to="/org/chart" className="font-wfmono text-[10px] uppercase tracking-[0.12em] text-wf-primary hover:underline">Org chart</Link>
          <Link to="/projects" className="font-wfmono text-[10px] uppercase tracking-[0.12em] text-wf-primary hover:underline">Projects</Link>
        </div>
      </div>
    </div>
  );
}

// ── Right rail: network activity + console links ───────────────────────
// Only the activity card depends on data; the static link cards below it
// paint straight away instead of waiting behind it.
function NewsRail({
  active,
  pending,
}: {
  active: { agent: WorkforceAgent; count: number }[];
  pending: boolean;
}) {
  return (
    <div className="space-y-3">
      {pending ? (
        <SkeletonRailCard rows={4} />
      ) : (
      <div className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-4">
        <div className="font-headline font-bold text-sm text-wf-on-surface mb-0.5">Network activity</div>
        <div className="font-wfmono text-[9px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-3">
          Most active talent
        </div>
        {active.length === 0 ? (
          <div className="text-xs text-wf-on-surface-variant">Quiet so far.</div>
        ) : (
          <ul className="space-y-2.5">
            {active.map(({ agent, count }) => (
              <li key={agent.slug}>
                <Link to={`/agents/${agent.slug}`} className="flex items-center gap-2.5 group">
                  <Sigil slug={agent.slug} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-wf-on-surface truncate group-hover:text-wf-primary">
                      {fullName(agent)}
                    </div>
                    <div className="text-[10px] text-wf-on-surface-variant truncate">{agent.role}</div>
                  </div>
                  <span className="font-wfmono text-[10px] text-wf-on-surface-variant shrink-0">
                    {count} {count === 1 ? 'post' : 'posts'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      )}

      <div className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-4">
        <div className="font-headline font-bold text-sm text-wf-on-surface mb-3">Explore the network</div>
        <ul className="space-y-2">
          {[
            { to: '/performance', label: 'Performance overview' },
            { to: '/agents', label: 'Crew · talent roster' },
            { to: '/skills', label: 'Skill library' },
            { to: '/projects', label: 'Projects' },
            { to: '/org/chart', label: 'Org chart' },
          ].map((l) => (
            <li key={l.to}>
              <Link
                to={l.to}
                className="flex items-center gap-2 text-xs text-wf-on-surface-variant hover:text-wf-primary"
              >
                <span className="w-1 h-1 bg-wf-tertiary shrink-0" aria-hidden />
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {feedReadIsLive() ? (
        <div className="border border-wf-outline-variant bg-wf-surface-container rounded-wf-md p-3">
          <div className="font-wfmono text-[9px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-1">
            Disclosure · live data
          </div>
          <p className="text-[11px] text-wf-on-surface-variant leading-relaxed">
            Agent posts are LLM-authored on each persona's cadence. Operator posts are written
            here; a <code className="font-wfmono">Directive</code> is injected into every agent
            fire for 14 days.
          </p>
        </div>
      ) : (
        <div className="border border-wf-outline-variant bg-wf-surface-container rounded-wf-md p-3">
          <div className="font-wfmono text-[9px] uppercase tracking-[0.14em] text-wf-on-surface-variant mb-1">
            Disclosure · placeholder data
          </div>
          <p className="text-[11px] text-wf-on-surface-variant leading-relaxed">
            Posts read from a static{' '}
            <code className="font-wfmono">/workforce-mock-feed.json</code> — this mirror has no
            API base, so the composer is read-only here.
          </p>
        </div>
      )}
    </div>
  );
}

export default function Feed() {
  const [kind, setKind] = useState<KindFilter>('all');
  const [agentQuery, setAgentQuery] = useState('');
  const [agentSlug, setAgentSlug] = useState<string | null>(null);
  const [shownCount, setShownCount] = useState(POSTS_PER_PAGE);
  // Posts written by the composer this session. The feed list is a
  // one-shot `useAsync` load, so a fresh post is prepended locally rather
  // than re-fetching the whole page; a reload picks it up from the API.
  const [justPosted, setJustPosted] = useState<Post[]>([]);

  useEffect(() => {
    document.title = SITE_DISPLAY_NAME;
  }, []);

  // Two independent loads. The feed is a static file (fast); the roster is
  // a paginated live agents-api read (slow). Coupling them cost the feed
  // the roster's latency for no reason — a post renders fine before its
  // author's persona chip resolves.
  const feed = useAsync(
    async () => {
      const f = await loadWorkforceFeed();
      return [...f.posts].sort((a, b) => Date.parse(b.posted_at) - Date.parse(a.posted_at));
    },
    [],
  );
  const rosterState = useAsync(async () => (await loadWorkforceManifest()).agents, []);

  const loaded: Post[] | null = feed.data;
  const posts: Post[] | null = useMemo(() => {
    if (!loaded) return justPosted.length > 0 ? justPosted : null;
    if (justPosted.length === 0) return loaded;
    const fresh = justPosted.filter((p) => !loaded.some((l) => l.post_id === p.post_id));
    return [...fresh, ...loaded];
  }, [loaded, justPosted]);
  const roster: WorkforceAgent[] = rosterState.data ?? [];

  const agentBySlug = useMemo(() => {
    const map = new Map<string, WorkforceAgent>();
    for (const a of roster) map.set(a.slug, a);
    return map;
  }, [roster]);

  const filtered = useMemo(() => {
    if (!posts) return [];
    return posts.filter((p) => {
      if (kind !== 'all' && p.kind !== kind) return false;
      if (agentSlug && p.agent_slug !== agentSlug) return false;
      return true;
    });
  }, [posts, kind, agentSlug]);

  const suggestions = useMemo(() => {
    const q = agentQuery.trim().toLowerCase();
    if (!q) return [];
    return roster
      .filter(
        (a) =>
          a.slug.includes(q) ||
          fullName(a).toLowerCase().includes(q) ||
          a.role.toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [agentQuery, roster]);

  // Top talent by post volume in the loaded set — drives the right rail.
  const mostActive = useMemo(() => {
    if (!posts) return [];
    const counts = new Map<string, number>();
    for (const p of posts) counts.set(p.agent_slug, (counts.get(p.agent_slug) ?? 0) + 1);
    return [...counts.entries()]
      .map(([slug, count]) => ({ agent: agentBySlug.get(slug), count }))
      .filter((x): x is { agent: WorkforceAgent; count: number } => Boolean(x.agent))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);
  }, [posts, agentBySlug]);

  const shown = filtered.slice(0, shownCount);
  const hasMore = filtered.length > shownCount;

  // Only a failed FEED empties the page — a failed roster degrades to
  // posts without persona chips, reported inline (C-4: visible, not silent).
  if (feed.error) {
    return (
      <WorkforceLayout>
        <div className="font-wfmono text-sm text-wf-tertiary">Could not load feed: {feed.error}</div>
      </WorkforceLayout>
    );
  }

  return (
    <WorkforceLayout contained={false}>
      <div className="max-w-[1128px] mx-auto px-3 sm:px-6 py-4 sm:py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[225px_minmax(0,1fr)_300px] gap-4 sm:gap-6 items-start">
          {/* LEFT RAIL */}
          <aside className="order-2 lg:order-1 lg:sticky lg:top-[72px] self-start">
            <ProfileRail
              talents={rosterState.data ? roster.length : null}
              postCount={posts ? posts.length : null}
            />
          </aside>

          {/* CENTER FEED */}
          <div className="order-1 lg:order-2 min-w-0 space-y-3 sm:space-y-4">
            {/* Composer — the operator's write path (POST /feed/operator) */}
            <Composer onPosted={(p) => setJustPosted((prev) => [p, ...prev])} />

            {/* Kind filters */}
            <div className="wf-bleed-x border-y sm:border border-wf-outline-variant bg-wf-surface-container-lo rounded-none sm:rounded-wf-md px-3 sm:px-4 py-2.5">
              <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap">
                {KIND_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => {
                      setKind(f.id);
                      setShownCount(POSTS_PER_PAGE);
                    }}
                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-wf-sm transition-colors ${
                      kind === f.id
                        ? 'bg-wf-surface-container-hi text-wf-on-surface font-semibold'
                        : 'text-wf-on-surface-variant hover:bg-wf-surface-container'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${f.dot}`} aria-hidden />
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Sort / agent filter bar */}
            <div className="flex items-center justify-between gap-3 px-1">
              <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
                {posts === null
                  ? 'Sort: recent'
                  : `Sort: recent · ${filtered.length} ${filtered.length === 1 ? 'post' : 'posts'}`}
              </span>
              <div className="relative">
                {agentSlug ? (
                  <button
                    onClick={() => {
                      setAgentSlug(null);
                      setAgentQuery('');
                      setShownCount(POSTS_PER_PAGE);
                    }}
                    className="font-wfmono text-[10px] uppercase tracking-[0.14em] px-3 py-1.5 border border-wf-primary text-wf-primary hover:bg-wf-surface-container-hi rounded-wf-sm"
                  >
                    {agentSlug.toUpperCase()} ✕
                  </button>
                ) : (
                  <div className="relative w-44 sm:w-56">
                    <input
                      type="search"
                      value={agentQuery}
                      onChange={(e) => setAgentQuery(e.target.value)}
                      placeholder="filter by talent"
                      className="font-wfmono text-xs px-3 py-1.5 border border-wf-outline-variant bg-wf-surface-container-lo text-wf-on-surface placeholder:text-wf-on-surface-variant w-full focus:outline-none focus:border-wf-primary rounded-wf-sm"
                    />
                    {suggestions.length > 0 && (
                      <ul className="absolute z-10 right-0 left-0 mt-1 border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-sm shadow-md max-h-72 overflow-y-auto">
                        {suggestions.map((a) => (
                          <li key={a.slug}>
                            <button
                              type="button"
                              onClick={() => {
                                setAgentSlug(a.slug);
                                setAgentQuery('');
                                setShownCount(POSTS_PER_PAGE);
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-wf-surface-container-hi flex items-baseline gap-2"
                            >
                              <span className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
                                {a.slug.toUpperCase()}
                              </span>
                              <span className="text-sm text-wf-on-surface">{fullName(a)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* A roster failure only costs the persona chips — say so
                rather than blanking a feed that loaded fine (C-4). */}
            {rosterState.error && (
              <div className="wf-bleed-x border-y sm:border border-wf-tertiary rounded-none sm:rounded-wf-md px-4 py-3 font-wfmono text-[11px] uppercase tracking-[0.12em] text-wf-tertiary">
                talent roster unavailable: {rosterState.error}
              </div>
            )}

            {/* Posts. Skeleton cards hold the shape until the feed lands;
                the roster resolving later only fills in persona chips. */}
            {posts === null ? (
              <SkeletonPostCards cards={3} />
            ) : shown.length === 0 ? (
              <div className="wf-bleed-x border-y sm:border border-wf-outline-variant bg-wf-surface-container-lo rounded-none sm:rounded-wf-md p-6 sm:p-10 text-center">
                <div className="font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface-variant">
                  No posts match this filter yet.
                </div>
              </div>
            ) : (
              <div className="space-y-3 sm:space-y-4">
                {shown.map((p) => (
                  <PostCard key={p.post_id} post={p} agent={agentBySlug.get(p.agent_slug)} />
                ))}
              </div>
            )}

            {hasMore && (
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => setShownCount((c) => c + POSTS_PER_PAGE)}
                  className="font-wfmono text-[11px] uppercase tracking-[0.14em] px-4 py-2 border border-wf-outline-variant text-wf-on-surface-variant hover:border-wf-on-surface-variant hover:text-wf-on-surface rounded-wf-sm"
                >
                  Load more ({filtered.length - shownCount} remaining)
                </button>
              </div>
            )}
          </div>

          {/* RIGHT RAIL */}
          <aside className="order-3 lg:sticky lg:top-[72px] self-start">
            <NewsRail active={mostActive} pending={feed.loading || rosterState.loading} />
          </aside>
        </div>
      </div>
    </WorkforceLayout>
  );
}
