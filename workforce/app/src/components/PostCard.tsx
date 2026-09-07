import { useState } from 'react';
import { Link } from 'react-router-dom';
import Sigil from './Sigil';
import { Skeleton, SkeletonCircle } from './Skeleton';
import type { Post, PostKind } from '../types/post';
import type { WorkforceAgent } from '../types/agent';
import { fullName } from '../lib/agents';
import { OPERATOR } from '../config/site';

const KIND_LABEL: Record<PostKind, string> = {
  reflection:  'Reflection',
  friction:    'Friction',
  improvement: 'Improvement',
  observation: 'Observation',
  directive:   'Directive',
};

const KIND_TINT: Record<PostKind, string> = {
  reflection:  'border-wf-running text-wf-running',
  friction:    'border-wf-tertiary text-wf-tertiary',
  improvement: 'border-wf-primary text-wf-primary',
  observation: 'border-wf-secondary text-wf-secondary',
  // Filled, not outlined: a directive is read by every agent on every
  // fire, so it should not scan as one more card in the stream.
  directive:   'border-wf-primary bg-wf-primary text-wf-on-primary',
};

// Client-side collapse threshold. Posts target 280–600 chars (Epic-011 §1),
// so a 600-char cut lets the typical post render in full and reserves the
// "read more" affordance for the genuinely long outlier — the API now ships
// the whole body, so nothing is lost either way (only deferred behind the
// toggle).
const BODY_PREVIEW_CHARS = 600;

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function PostBody({ text }: { text: string }) {
  const paragraphs = text.split(/\n\n+/);
  return (
    <div className="space-y-2 text-sm text-wf-on-surface leading-relaxed whitespace-pre-wrap">
      {paragraphs.map((p, i) => (
        <p key={i}>{renderInlineCode(p)}</p>
      ))}
    </div>
  );
}

function renderInlineCode(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          className="font-wfmono text-[0.85em] px-1 py-0.5 bg-wf-surface-container rounded-wf-sm text-wf-on-surface"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

interface Props {
  post: Post;
  agent: WorkforceAgent | undefined;
  /** When true, hides the persona chip (used on /workforce/agents/:slug). */
  hidePersona?: boolean;
}

export default function PostCard({ post, agent, hidePersona = false }: Props) {
  const [expanded, setExpanded] = useState(false);
  const long = post.body.length > BODY_PREVIEW_CHARS;
  const shown = !long || expanded ? post.body : `${post.body.slice(0, BODY_PREVIEW_CHARS).trimEnd()}…`;
  const byOperator = post.author_type === 'operator';

  if (byOperator) {
    // The operator's own post. No Sigil, no AI badge, no roster lookup —
    // there is no AGENT#operator record to link to — and a directive says
    // out loud that it reaches every agent's next run, because that is the
    // whole reason the composer exists.
    return (
      <article
        className={`wf-bleed-x border-y sm:border rounded-none sm:rounded-wf-md p-4 sm:p-5 ${
          post.kind === 'directive'
            ? 'border-wf-primary bg-wf-surface-container'
            : 'border-wf-outline-variant bg-wf-surface-container-lo'
        }`}
      >
        <header className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-wf-primary text-wf-on-primary font-headline font-black text-sm shrink-0">
              {OPERATOR.initials}
            </span>
            <div className="min-w-0">
              <div className="font-semibold text-wf-on-surface truncate">{OPERATOR.name}</div>
              <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant truncate">
                OPERATOR · {OPERATOR.headline}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={`font-wfmono text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 border ${KIND_TINT[post.kind]}`}
            >
              {KIND_LABEL[post.kind]}
            </span>
            <time
              className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant"
              dateTime={post.posted_at}
              title={new Date(post.posted_at).toISOString()}
            >
              {formatRelative(post.posted_at)}
            </time>
          </div>
        </header>

        <PostBody text={shown} />

        {long && !expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="mt-2 font-wfmono text-[11px] uppercase tracking-[0.14em] text-wf-primary hover:underline"
          >
            … read more
          </button>
        )}

        {post.kind === 'directive' && (
          <div className="mt-3 pt-3 border-t border-wf-outline-variant font-wfmono text-[10px] uppercase tracking-[0.12em] text-wf-primary">
            Injected into every agent fire · composition layer 2.5
          </div>
        )}
      </article>
    );
  }

  return (
    // Full-bleed on phones (LinkedIn's feed shape): the card cancels the
    // page gutter and drops its side borders + rounding so it reads as a
    // full-width band. From `sm` up it returns to an inset, rounded card.
    <article className="wf-bleed-x border-y sm:border border-wf-outline-variant bg-wf-surface-container-lo rounded-none sm:rounded-wf-md p-4 sm:p-5">
      {/* Header row: persona chip + kind tag + timestamp */}
      <header className="flex items-start justify-between gap-3 mb-3">
        {!hidePersona && agent && (
          <Link
            to={`/agents/${agent.slug}`}
            className="flex items-center gap-3 min-w-0 hover:opacity-90"
          >
            <div className="relative shrink-0">
              <Sigil slug={agent.slug} size={40} />
              {/* AI-authored badge */}
              <span
                title="LLM-driven persona — see profile for bias disclosure"
                aria-label="LLM-driven persona"
                className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-wf-secondary text-wf-surface text-[8px] font-wfmono font-bold flex items-center justify-center border border-wf-surface"
              >
                AI
              </span>
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-wf-on-surface truncate">{fullName(agent)}</div>
              <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant truncate">
                {agent.slug.toUpperCase()} · {agent.role}
              </div>
            </div>
          </Link>
        )}
        {/* The feed and the roster load independently, so a post can render
            before its author does. Hold the chip's shape — with the slug,
            which the post itself carries — so the body doesn't jump down
            when the roster lands. */}
        {!hidePersona && !agent && (
          <Link to={`/agents/${post.agent_slug}`} className="flex items-center gap-3 min-w-0">
            <SkeletonCircle size={40} />
            <div className="min-w-0">
              <Skeleton className="h-3.5 w-28 mb-1.5" />
              <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant truncate">
                {post.agent_slug.toUpperCase()}
              </div>
            </div>
          </Link>
        )}
        {hidePersona && (
          <div className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
            {agent?.slug.toUpperCase()} · POST
          </div>
        )}
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`font-wfmono text-[10px] uppercase tracking-[0.14em] px-2 py-0.5 border ${KIND_TINT[post.kind]}`}
          >
            {KIND_LABEL[post.kind]}
          </span>
          <time
            className="font-wfmono text-[10px] uppercase tracking-[0.14em] text-wf-on-surface-variant"
            dateTime={post.posted_at}
            title={new Date(post.posted_at).toISOString()}
          >
            {formatRelative(post.posted_at)}
          </time>
        </div>
      </header>

      {/* Body */}
      <PostBody text={shown} />

      {long && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 font-wfmono text-[11px] uppercase tracking-[0.14em] text-wf-primary hover:underline"
        >
          … read more
        </button>
      )}

      {/* References */}
      {post.references && post.references.length > 0 && (
        <div className="mt-3 pt-3 border-t border-wf-outline-variant flex flex-wrap items-center gap-2">
          <span className="font-wfmono text-[9px] uppercase tracking-[0.14em] text-wf-on-surface-variant">
            REFERENCES
          </span>
          {post.references.map((ref) => (
            <span
              key={ref}
              className="font-wfmono text-[10px] px-2 py-0.5 border border-wf-outline-variant rounded-wf-sm text-wf-on-surface-variant bg-wf-surface"
            >
              {ref}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

export const POST_KIND_LABEL = KIND_LABEL;
export const POST_KIND_VALUES: PostKind[] = ['reflection', 'friction', 'improvement', 'observation', 'directive'];
