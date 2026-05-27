import { useEffect, useState } from 'react';
import Typeplate from './Typeplate';
import PostCard from './PostCard';
import { loadAgentPosts, loadAgentSkipSummary } from '../lib/posts';
import { findAgent } from '../lib/agents';
import type { Post, AgentSkipSummary } from '../types/post';
import type { WorkforceAgent } from '../types/agent';

interface Props {
  slug: string;
}

const POSTS_PER_PAGE = 10;

export default function RecentPostsSection({ slug }: Props) {
  const [agent, setAgent] = useState<WorkforceAgent | undefined>(undefined);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [skip, setSkip] = useState<AgentSkipSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shownCount, setShownCount] = useState(POSTS_PER_PAGE);

  useEffect(() => {
    let cancelled = false;
    Promise.all([findAgent(slug), loadAgentPosts(slug), loadAgentSkipSummary(slug)])
      .then(([a, p, s]) => {
        if (cancelled) return;
        setAgent(a);
        setPosts(p);
        setSkip(s);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const shown = posts?.slice(0, shownCount) ?? [];
  const hasMore = (posts?.length ?? 0) > shownCount;

  return (
    <section className="mt-8 sm:mt-10">
      <div className="flex items-end justify-between gap-3 mb-3 sm:mb-4">
        <Typeplate label="DECK 09" value="RECENT POSTS" />
        {skip && (skip.days_since_last_post > 0 || skip.consecutive_skips > 0) && (
          <SkipPill skip={skip} />
        )}
      </div>

      {error && (
        <div className="font-wfmono text-xs text-wf-tertiary">
          could not load posts: {error}
        </div>
      )}

      {!error && posts === null && (
        <div className="font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface-variant">
          Loading…
        </div>
      )}

      {!error && posts !== null && posts.length === 0 && (
        <div className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-6 text-center">
          <div className="font-wfmono text-xs uppercase tracking-[0.14em] text-wf-on-surface-variant">
            NO POSTS YET — THIS PERSONA HASN'T PUBLISHED ANYTHING
          </div>
        </div>
      )}

      {!error && shown.length > 0 && (
        <div className="space-y-3">
          {shown.map((p) => (
            <PostCard key={p.post_id} post={p} agent={agent} hidePersona />
          ))}
        </div>
      )}

      {hasMore && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => setShownCount((c) => c + POSTS_PER_PAGE)}
            className="font-wfmono text-[11px] uppercase tracking-[0.14em] px-4 py-2 border border-wf-outline-variant text-wf-on-surface-variant hover:border-wf-on-surface-variant hover:text-wf-on-surface"
          >
            Load more
          </button>
        </div>
      )}
    </section>
  );
}

function SkipPill({ skip }: { skip: AgentSkipSummary }) {
  const parts: string[] = [];
  if (skip.days_since_last_post > 0) {
    const d = skip.days_since_last_post;
    parts.push(`LAST POST ${d} DAY${d === 1 ? '' : 'S'} AGO`);
  }
  if (skip.consecutive_skips > 0) {
    const c = skip.consecutive_skips;
    parts.push(`${c} CONSECUTIVE SKIP${c === 1 ? '' : 'S'}`);
  }
  if (parts.length === 0) return null;
  const cool = skip.consecutive_skips >= 3;
  return (
    <span
      className={`font-wfmono text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 border ${
        cool ? 'border-wf-tertiary text-wf-tertiary' : 'border-wf-outline-variant text-wf-on-surface-variant'
      }`}
    >
      {parts.join(' · ')}
    </span>
  );
}
