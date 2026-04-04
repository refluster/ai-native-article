import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import ArticleCard from '../components/ArticleCard'
import type { ArticleMeta } from '../types/article'
import { withBasePath } from '../lib/paths'

export default function Home() {
  const [articles, setArticles] = useState<ArticleMeta[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(withBasePath('posts/manifest.json'))
      .then(r => r.json())
      .then((data: ArticleMeta[]) => {
        setArticles(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const featured = articles[0]
  const rest = articles.slice(1)

  // Derive unique categories from articles
  const categories = Array.from(new Set(articles.map(a => a.category)))
    .map(cat => ({
      name: cat,
      count: articles.filter(a => a.category === cat).length,
    }))

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <span className="text-[10px] font-bold tracking-widest text-outline uppercase animate-pulse">
          LOADING INSIGHTS...
        </span>
      </div>
    )
  }

  return (
    <>
      {/* Hero */}
      {featured && (
        <section className="w-full bg-surface border-b border-outline-variant/10">
          <div className="max-w-[1440px] mx-auto px-6 md:px-12 pt-16 pb-24">
            <div className="swiss-grid">
              <div className="col-span-12 lg:col-span-7 relative overflow-hidden">
                <img
                  src={withBasePath('assets/images/ai-native-transformation.jpg')}
                  alt={featured.title}
                  className="w-full aspect-[16/9] object-cover grayscale"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex flex-col justify-end p-8">
                  <span className="inline-block bg-tertiary text-on-tertiary px-2 py-1 text-[10px] font-bold tracking-widest uppercase mb-4">
                    FEATURED INSIGHT
                  </span>
                  <Link to={`/article/${featured.slug}`}>
                    <h2 className="text-3xl md:text-4xl font-black tracking-tight leading-tight text-white hover:text-tertiary transition-colors">
                      {featured.title}
                    </h2>
                  </Link>
                </div>
              </div>
              <div className="col-span-12 lg:col-span-5 flex flex-col justify-between py-4">
                <div>
                  <span className="text-[10px] font-bold tracking-widest text-tertiary uppercase block mb-4">
                    {featured.category}
                  </span>
                  <Link to={`/article/${featured.slug}`}>
                    <h3 className="text-xl font-black tracking-tight leading-tight mb-6 hover:text-tertiary transition-colors">
                      {featured.title}
                    </h3>
                  </Link>
                  <p className="text-base leading-relaxed text-on-surface-variant mb-8">
                    {featured.abstract}
                  </p>
                </div>
                <div className="border-t border-outline-variant/30 pt-6 flex items-center justify-between">
                  <span className="text-[10px] font-bold tracking-widest text-outline uppercase">
                    {featured.date}
                  </span>
                  <Link
                    to={`/article/${featured.slug}`}
                    className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase hover:text-tertiary transition-colors"
                  >
                    READ →
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Main Grid */}
      <section className="max-w-[1440px] mx-auto px-6 md:px-12 py-16">
        <div className="swiss-grid">
          <div className="col-span-12 lg:col-span-9">
            <div className="flex items-center justify-between mb-12">
              <h3 className="text-3xl font-black tracking-tighter uppercase">All Insights</h3>
              <div className="h-[2px] flex-grow mx-8 bg-outline-variant/20" />
              <span className="text-[10px] font-bold text-outline tracking-widest uppercase">
                {articles.length} ARTICLES
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-y-16 gap-x-12">
              {articles.map((article, i) => (
                <ArticleCard key={article.slug} article={article} index={i} />
              ))}
            </div>
          </div>

          {/* Sidebar */}
          <aside className="col-span-12 lg:col-span-3 lg:border-l lg:border-outline-variant/20 lg:pl-12">
            <div className="sticky top-24">
              <div className="mb-12">
                <h5 className="text-[10px] font-bold tracking-widest text-outline uppercase mb-6">
                  MUST READS
                </h5>
                <div className="space-y-8">
                  {articles.slice(0, 3).map((article, i) => (
                    <div key={article.slug} className="group cursor-pointer">
                      <span className="text-[9px] font-bold text-tertiary block mb-2">
                        {String(i + 1).padStart(2, '0')}. INSIGHT
                      </span>
                      <Link
                        to={`/article/${article.slug}`}
                        className="text-sm font-black leading-tight group-hover:underline block"
                      >
                        {article.title}
                      </Link>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h5 className="text-[10px] font-bold tracking-widest text-outline uppercase mb-6">
                  CATEGORIES
                </h5>
                <ul className="space-y-3">
                  {categories.map(cat => (
                    <li key={cat.name} className="flex justify-between group cursor-pointer">
                      <span className="text-sm font-bold uppercase group-hover:text-tertiary transition-colors">
                        {cat.name}
                      </span>
                      <span className="text-[10px] font-medium text-outline">{cat.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </>
  )
}
