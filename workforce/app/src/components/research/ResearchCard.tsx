// One row of the Research index. Same card grammar as the Reports index
// (white lifted surface, 1px border, mono date/kicker line, Geist title,
// clamped abstract) so a reader moving between the two surfaces sees one
// console, plus the article-specific bits: tag chips, the EN marker when
// an English edition exists, and the persona byline. It stays inset on
// phones: the public shell's gutter is not the console's, so the
// `wf-bleed-x` trick the feed uses would not line up here.

import { Link } from 'react-router-dom';
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
}

/** Strip the markdown emphasis the exporter leaves in abstracts. */
function plain(text: string): string {
  return text.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim();
}

export default function ResearchCard({ article, lang, onTagClick, activeTag }: Props) {
  const tags = tagsOf(article);
  const authors = parseAuthorSlugs(article.author).filter(s => s !== 'anonymous');
  const type = inferType(article);

  return (
    <article className="border border-wf-outline-variant bg-wf-surface-container-lo rounded-wf-md p-4 sm:p-5 hover:border-wf-primary transition-colors">
      <div className="flex items-baseline gap-3 flex-wrap font-wfmono text-[11px]">
        <span className="text-wf-on-surface-variant">{article.date}</span>
        <span className="uppercase tracking-[0.14em] text-wf-tertiary">{type}</span>
        {article.hasEn && (
          <span className="uppercase tracking-[0.14em] text-wf-secondary" title="English edition available">
            ja · en
          </span>
        )}
      </div>
      <h3 className="mt-1.5 font-headline font-bold text-[19px] leading-snug text-wf-on-surface">
        <Link to={researchPath(article.slug)} className="hover:text-wf-primary">
          {localizedTitle(article, lang)}
        </Link>
      </h3>
      <p className="mt-2 text-[14.5px] leading-relaxed text-wf-on-surface-variant line-clamp-3">
        {plain(localizedAbstract(article, lang))}
      </p>
      {(tags.length > 0 || authors.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          {tags.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {tags.map(tag => (
                <li key={tag}>
                  {onTagClick ? (
                    <button
                      type="button"
                      onClick={() => onTagClick(tag)}
                      aria-pressed={activeTag === tag}
                      className={`font-wfmono text-[10px] uppercase tracking-[0.1em] px-2 py-0.5 rounded-wf-lg border transition-colors ${
                        activeTag === tag
                          ? 'border-wf-primary bg-wf-primary text-wf-on-primary'
                          : 'border-wf-outline-variant bg-wf-surface-container text-wf-on-surface-variant hover:border-wf-primary hover:text-wf-primary'
                      }`}
                    >
                      {displayTag(tag)}
                    </button>
                  ) : (
                    <span className="font-wfmono text-[10px] uppercase tracking-[0.1em] px-2 py-0.5 rounded-wf-lg border border-wf-outline-variant bg-wf-surface-container text-wf-on-surface-variant">
                      {displayTag(tag)}
                    </span>
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
