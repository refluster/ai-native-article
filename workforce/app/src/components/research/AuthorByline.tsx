// Byline for a research article: the persona portrait (Sigil — the same
// DiceBear face the reader site and the agent directory show), the
// persona's name and role, linking to the console profile.
//
// The roster comes from the live agents-api (lib/agents.ts, memoised), the
// same read the agent directory does. Until it lands — or when the slug is
// unknown / `anonymous` — the chip shows the slug quietly rather than
// blocking the article on a roster fetch.

import { Link } from 'react-router-dom';
import { fullName, loadWorkforceManifest } from '../../lib/agents';
import { useAsync } from '../../lib/useAsync';
import Sigil from '../Sigil';

interface Props {
  slugs: string[];
  size?: number;
}

export default function AuthorByline({ slugs, size = 32 }: Props) {
  const roster = useAsync(() => loadWorkforceManifest(), []);
  if (slugs.length === 0) return null;
  const compact = slugs.length > 1;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {slugs.map(slug => {
        const agent = roster.data?.agents.find(a => a.slug === slug);
        if (!agent) {
          return (
            <span key={slug} className="inline-flex items-center gap-2 text-sm text-wf-on-surface-variant" data-author-slug={slug}>
              <Sigil slug={slug || 'anonymous'} size={size} />
              <span className="font-wfmono text-[12px]">{slug || 'anonymous'}</span>
            </span>
          );
        }
        return (
          <Link
            key={slug}
            to={`/agents/${agent.slug}`}
            className="inline-flex items-center gap-2 text-sm group"
            data-author-slug={slug}
          >
            <Sigil slug={agent.slug} size={size} />
            <span className="min-w-0">
              <span className="block font-headline font-semibold text-wf-on-surface group-hover:text-wf-primary leading-tight">
                {fullName(agent)}
              </span>
              {!compact && (
                <span className="block text-[12px] text-wf-on-surface-variant leading-tight">{agent.role}</span>
              )}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
