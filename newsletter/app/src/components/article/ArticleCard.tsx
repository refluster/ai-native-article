import { Link } from 'react-router-dom'
import type { ArticleMeta } from '../../types/article'
import { displayTag } from '../../lib/article-types'

interface Props {
  article: ArticleMeta
}

/**
 * Tags shown on the card. CategoriesMulti is canonical; older rows that
 * predate it fall back to the singular `category`. We cap at three so the
 * card stays text-forward and the meta row never wraps awkwardly.
 */
function cardTags(article: ArticleMeta): string[] {
  const raw =
    article.categoriesMulti && article.categoriesMulti.length > 0
      ? article.categoriesMulti
      : article.category
        ? [article.category]
        : []
  return raw.slice(0, 3).map(displayTag)
}

export default function ArticleCard({ article }: Props) {
  const tags = cardTags(article)

  return (
    <article className="group">
      <Link to={`/article/${article.slug}`}>
        <div className="flex flex-col">
          <div className="flex justify-between items-baseline mb-3 gap-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
              {tags.map(tag => (
                <span
                  key={tag}
                  className="text-[10px] font-bold tracking-widest text-tertiary uppercase truncate"
                >
                  {tag}
                </span>
              ))}
            </div>
            <span className="text-[10px] font-medium tracking-widest text-outline uppercase shrink-0">
              {article.date}
            </span>
          </div>
          <h4 className="text-xl font-extrabold tracking-tight leading-tight mb-4 group-hover:text-tertiary transition-colors">
            {article.title}
          </h4>
          <p className="text-sm leading-relaxed text-on-surface-variant line-clamp-3">
            {article.abstract}
          </p>
        </div>
      </Link>
    </article>
  )
}
