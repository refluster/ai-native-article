// One story on the Research index. Editorial-list grammar, not a card:
// no box around each article — whitespace and a single faint hairline
// between rows do the separating (newsroom front pages, not dashboard
// tiles). The mono meta line, Geist title and clamped abstract carry over
// from components/public/styles.ts.
//
// The whole story is one tap target. The title's <Link> is "stretched"
// (an ::after covering the <article>), so a click anywhere in the block
// opens the analysis while the markup keeps a single, real anchor — no
// nested interactive elements. Tag chips sit above that overlay (z-10)
// and keep filtering. Hover / keyboard focus tint the whole block and
// turn the title Indigo Ink, so the affordance matches the hit area.

import { Link } from 'react-router-dom';
import { CHIP, CHIP_ACTIVE } from '../public/styles';
import {
  displayTag,
  inferType,
  localizedAbstract,
  localizedTitle,
  parseAuthorSlugs,
  researchPath,
  tagsOf,
  type ResearchArticleMeta,
  type ResearchLanguage,
} from '../../lib/research';

interface Props {
  article: ResearchArticleMeta;
  lang: ResearchLanguage;
  /** Tag click → filter. Optional so the card also works without a filter rail. */
  onTagClick?: (tag: string) => void;
  activeTag?: string | null;
  /** `lead` is the top story of the first page: larger title, longer abstract. */
  variant?: 'lead' | 'row';
}

/** Strip the markdown emphasis the exporter leaves in abstracts. */
function plain(text: string): string {
  return text.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim();
}

export default function ResearchCard({ article, lang, onTagClick, activeTag, variant = 'row' }: Props) {
  const tags = tagsOf(article);
  const authors = parseAuthorSlugs(article.author).filter(s => s !== 'anonymous');
  const type = inferType(article);
  const lead = variant === 'lead';

  return (
    <article
      className={[
        'group relative -mx-3 sm:-mx-4 px-3 sm:px-4 rounded-wf-md transition-colors',
        'hover:bg-wf-surface-container-lo has-[a:focus-visible]:bg-wf-surface-container-lo',
        'has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-wf-primary',
        lead ? 'py-6 sm:py-8' : 'py-6',
      ].join(' ')}
    >
      <div className="flex items-baseline gap-3 flex-wrap font-wfmono text-[11px]">
        {lead && <span className="uppercase tracking-[0.16em] text-wf-primary">Latest</span>}
        <span className="text-wf-on-surface-variant">{article.date}</span>
        <span className="uppercase tracking-[0.14em] text-wf-tertiary">{type}</span>
        {article.hasEn && (
          <span className="uppercase tracking-[0.14em] text-wf-secondary" title="English edition available">
            ja · en
          </span>
        )}
      </div>
      <h3
        className={
          lead
            ? 'mt-3 font-headline font-bold text-[clamp(24px,3.2vw,34px)] leading-[1.18] tracking-[-0.02em] text-wf-on-surface'
            : 'mt-2 font-headline font-bold text-[19px] sm:text-[20px] leading-snug tracking-[-0.01em] text-wf-on-surface'
        }
      >
        <Link
          to={researchPath(article.slug)}
          className="outline-none transition-colors group-hover:text-wf-primary after:absolute after:inset-0 after:rounded-wf-md after:content-['']"
        >
          {localizedTitle(article, lang)}
        </Link>
      </h3>
      <p
        className={
          lead
            ? 'mt-3 text-[16px] leading-relaxed text-wf-on-surface-variant line-clamp-4 max-w-[68ch]'
            : 'mt-2 text-[14.5px] leading-relaxed text-wf-on-surface-variant line-clamp-3 max-w-[72ch]'
        }
      >
        {plain(localizedAbstract(article, lang))}
      </p>
      {(tags.length > 0 || authors.length > 0) && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          {tags.length > 0 && (
            <ul className="relative z-10 flex flex-wrap gap-1.5">
              {tags.map(tag => (
                <li key={tag}>
                  {onTagClick ? (
                    <button
                      type="button"
                      onClick={() => onTagClick(tag)}
                      aria-pressed={activeTag === tag}
                      className={activeTag === tag ? CHIP_ACTIVE : CHIP}
                    >
                      {displayTag(tag)}
                    </button>
                  ) : (
                    <span className={CHIP}>{displayTag(tag)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {authors.length > 0 && (
            <span className="font-wfmono text-[11px] text-wf-on-surface-variant">by {authors.join(' · ')}</span>
          )}
        </div>
      )}
    </article>
  );
}
