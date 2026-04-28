import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { ArticleMeta } from '../types/article'
import { withBasePath } from '../lib/paths'
import { ARTICLE_TYPE_LABELS, inferType } from '../lib/article-types'

const FALLBACK_IMAGES = [
  withBasePath('assets/images/article-1.jpg'),
  withBasePath('assets/images/article-2.jpg'),
  withBasePath('assets/images/article-3.jpg'),
  withBasePath('assets/images/article-4.jpg'),
  withBasePath('assets/images/article-5.jpg'),
  withBasePath('assets/images/article-6.jpg'),
  withBasePath('assets/images/article-7.jpg'),
  withBasePath('assets/images/article-8.jpg'),
  withBasePath('assets/images/article-9.jpg'),
]

interface Props {
  article: ArticleMeta
  index: number
}

export default function ArticleCard({ article, index }: Props) {
  // Per-article images are written by the L4 publish step. When the
  // manifest entry has none, fall back to the rotating placeholder set
  // so the grid never shows a broken image.
  const fallback = FALLBACK_IMAGES[index % FALLBACK_IMAGES.length]
  const initial = article.image ? withBasePath(article.image) : fallback
  // Stale manifests written before the image-existence check (PR #9)
  // can still point at /posts/images/<slug>.jpg files that 404 in
  // production. The runtime onError swaps in the placeholder — once
  // per mount, no flicker loop.
  const [imgSrc, setImgSrc] = useState(initial)
  const type = inferType(article)
  const typeLabel = ARTICLE_TYPE_LABELS[type]

  return (
    <article className="group">
      <Link to={`/article/${article.slug}`}>
        <div className="aspect-[4/5] bg-surface-container-low mb-6 overflow-hidden">
          <img
            src={imgSrc}
            alt={article.title}
            onError={() => {
              if (imgSrc !== fallback) setImgSrc(fallback)
            }}
            className="w-full h-full object-cover grayscale transition-transform duration-700 group-hover:scale-105"
          />
        </div>
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
