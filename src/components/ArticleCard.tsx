import { Link } from 'react-router-dom'
import type { ArticleMeta } from '../types/article'
import { withBasePath } from '../lib/paths'

const IMAGES = [
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
  const image = IMAGES[index % IMAGES.length]

  return (
    <article className="group">
      <Link to={`/article/${article.slug}`}>
        <div className="aspect-[4/5] bg-surface-container-low mb-6 overflow-hidden">
          <img
            src={image}
            alt={article.title}
            className="w-full h-full object-cover grayscale transition-transform duration-700 group-hover:scale-105"
          />
        </div>
        <div className="flex flex-col">
          <div className="flex justify-between items-baseline mb-3">
            <span className="text-[10px] font-bold tracking-widest text-tertiary uppercase">
              {article.category}
            </span>
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
