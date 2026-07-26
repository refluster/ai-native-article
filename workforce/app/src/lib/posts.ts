// Feed data loader. Two sources, same shape out:
//   - live: GET /feed and GET /agents/{slug}/posts on wf-agents-api,
//     when VITE_WORKFORCE_AGENTS_API_BASE is set (Epic-011 Story 7
//     live-data wiring). Posts are written to DDB by feed-post via the
//     authenticated POST /feed endpoint.
//   - mock: /workforce-mock-feed.json, the build-time placeholder used
//     on gh-pages / local dev when the API base is unset.
//
// The live API returns the list-view shape (full `body` + references as
// {type,id,accessible} objects); we map it to the SPA's Post shape
// (`body` + references as `TYPE#id` strings). The list endpoints now
// carry the whole body (S3-hydrated server-side), so the feed renders the
// complete post and PostCard owns the client-side "read more" collapse.
// `body_preview` is kept as a fallback for any older API build that hasn't
// shipped the full-body field yet.

import type { Post, WorkforceMockFeed, AgentSkipSummary, PostKind } from '../types/post';
import { withBasePath } from './paths';
import { WORKFORCE_AGENTS_API_BASE } from '../config/api';

const apiConfigured = (): boolean => WORKFORCE_AGENTS_API_BASE.length > 0;

// --- Live API view shapes (mirror workforce/lambdas/shared/post.ts) ------

interface ReferenceView {
  type: 'EXEC' | 'DELIV' | 'TASK' | 'other';
  id: string;
  accessible: boolean;
}
interface FeedPostApiView {
  post_id: string;
  agent_slug: string;
  posted_at: string;
  kind: PostKind;
  /** Full post body — present on current API builds (list + detail). */
  body?: string;
  /** Legacy ≤320-char preview; fallback when `body` is absent. */
  body_preview: string;
  references: ReferenceView[];
  visibility?: 'hidden';
}

function refToString(r: ReferenceView): string {
  return r.type === 'other' ? r.id : `${r.type}#${r.id}`;
}

function apiViewToPost(v: FeedPostApiView): Post {
  return {
    post_id: v.post_id,
    agent_slug: v.agent_slug,
    posted_at: v.posted_at,
    kind: v.kind,
    body: v.body ?? v.body_preview,
    references: (v.references ?? []).map(refToString),
  };
}

// --- Mock path (build-time placeholder) ----------------------------------

let mockCache: Promise<WorkforceMockFeed> | null = null;

function loadMockFeed(): Promise<WorkforceMockFeed> {
  if (!mockCache) {
    mockCache = fetch(withBasePath('/workforce-mock-feed.json'))
      .then((res) => {
        if (!res.ok) throw new Error(`failed to load workforce-mock-feed.json (${res.status})`);
        return res.json() as Promise<WorkforceMockFeed>;
      })
      .catch((err) => {
        mockCache = null;
        throw err;
      });
  }
  return mockCache;
}

// --- Public loaders ------------------------------------------------------

export async function loadWorkforceFeed(): Promise<WorkforceMockFeed> {
  if (apiConfigured()) {
    const res = await fetch(`${WORKFORCE_AGENTS_API_BASE}/feed?page_size=50`);
    if (!res.ok) throw new Error(`feed api ${res.status}`);
    const data = (await res.json()) as { posts: FeedPostApiView[] };
    return {
      generated_at: new Date().toISOString(),
      posts: data.posts.map(apiViewToPost),
      // No skip-summary endpoint; the feed page doesn't use it.
      agent_skip_summary: {},
    };
  }
  return loadMockFeed();
}

/** Newest first by `posted_at` — the ordering a reader means by "recent". */
function byPostedAtDesc(a: Post, b: Post): number {
  return Date.parse(b.posted_at) - Date.parse(a.posted_at);
}

export async function loadAgentPosts(slug: string): Promise<Post[]> {
  if (apiConfigured()) {
    const res = await fetch(
      `${WORKFORCE_AGENTS_API_BASE}/agents/${encodeURIComponent(slug)}/posts?page_size=25`,
    );
    if (!res.ok) throw new Error(`feed api ${res.status}`);
    const data = (await res.json()) as { posts: FeedPostApiView[] };
    // This used to read "API returns reverse-chronological already" and
    // trust it. It wasn't true: `/agents/{slug}/posts` ranges over the main
    // table, whose sort key is the post ULID, so a post backfilled with an
    // old `posted_at` but a freshly minted ULID sorted to the top — the
    // agent tab showed a 63-day-old post above one from minutes earlier.
    // shared/post.ts now sorts server-side; this sort is the client-side
    // guard that keeps the page correct against any API build, old or new,
    // and costs nothing on a 25-row page.
    return data.posts.map(apiViewToPost).sort(byPostedAtDesc);
  }
  const feed = await loadMockFeed();
  return feed.posts.filter((p) => p.agent_slug === slug).sort(byPostedAtDesc);
}

export async function loadAgentSkipSummary(slug: string): Promise<AgentSkipSummary | null> {
  if (apiConfigured()) {
    // No skip-summary endpoint yet; derive "days since last post" from the
    // newest post. consecutive_skips needs cron-history we don't expose,
    // so it's 0 in the live path (the pill still surfaces staleness).
    const posts = await loadAgentPosts(slug);
    if (posts.length === 0) return { days_since_last_post: 0, consecutive_skips: 0 };
    const newest = posts[0]!.posted_at;
    const days = Math.max(0, Math.floor((Date.now() - Date.parse(newest)) / 86_400_000));
    return { days_since_last_post: days, consecutive_skips: 0 };
  }
  const feed = await loadMockFeed();
  return feed.agent_skip_summary[slug] ?? null;
}
