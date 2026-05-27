import type { Post, WorkforceMockFeed, AgentSkipSummary } from '../types/post';
import { withBasePath } from './paths';

let cache: Promise<WorkforceMockFeed> | null = null;

export function loadWorkforceFeed(): Promise<WorkforceMockFeed> {
  if (!cache) {
    cache = fetch(withBasePath('/workforce-mock-feed.json'))
      .then((res) => {
        if (!res.ok) throw new Error(`failed to load workforce-mock-feed.json (${res.status})`);
        return res.json() as Promise<WorkforceMockFeed>;
      })
      .catch((err) => {
        cache = null;
        throw err;
      });
  }
  return cache;
}

export async function loadAgentPosts(slug: string): Promise<Post[]> {
  const feed = await loadWorkforceFeed();
  return feed.posts
    .filter((p) => p.agent_slug === slug)
    .sort((a, b) => Date.parse(b.posted_at) - Date.parse(a.posted_at));
}

export async function loadAgentSkipSummary(slug: string): Promise<AgentSkipSummary | null> {
  const feed = await loadWorkforceFeed();
  return feed.agent_skip_summary[slug] ?? null;
}
