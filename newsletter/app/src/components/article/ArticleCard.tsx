import { Link } from 'react-router-dom'
import type { ArticleMeta } from '../../types/article'
import { ARTICLE_TYPE_LABELS, inferType } from '../../lib/article-types'

interface Props {
  article: ArticleMeta
}

export default function ArticleCard({ article }: Props) {
  const type = inferType(article)
  const typeLabel = ARTICLE_TYPE_LABELS[type]

  return (
    <article className="group">
      <Link to={`/article/${article.slug}`}>
        <div className="flex flex-col">
          <div className="flex justify-between items-baseline mb-3">
            <div className="flex items-center gap-2">
              <span
                className={`text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 border ${
                  type === 'explanation'
                    ? 'border-outline text-outline'
                    : 'border-tertiary text-tertiary'
                }`}
              >
                {typeLabel}
              </span>
              <span className="text-[10px] font-bold tracking-widest text-tertiary uppercase">
                {article.category}
              </span>
            </div>
            <span className="text-[10px] font-medium tracking-widest text-outline uppercase">
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
