import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ArticleCard from '../components/ArticleCard'
import type { ArticleMeta, ArticleType } from '../types/article'
import { withBasePath } from '../lib/paths'
import { setDefaultSeo } from '../lib/seo'
import { trackEvent } from '../lib/analytics'
import {
  ARTICLE_TYPE_LABELS,
  DATE_RANGE_LABELS,
  DATE_RANGES,
  type DateRange,
  inferType,
  isArticleType,
  isDateRange,
  isWithinDateRange,
} from '../lib/article-types'

type TypeFilter = 'all' | ArticleType

const TYPE_TABS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'explanation', label: ARTICLE_TYPE_LABELS.explanation },
  { value: 'analysis', label: ARTICLE_TYPE_LABELS.analysis },
]

export default function Home() {
  const [articles, setArticles] = useState<ArticleMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    fetch(withBasePath('posts/manifest.json'))
      .then(r => r.json())
      .then((data: ArticleMeta[]) => {
        const sorted = [...data].sort((a, b) => {
          const dateA = new Date(a.date).getTime()
          const dateB = new Date(b.date).getTime()
          return dateB - dateA
        })
        setArticles(sorted)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  // URL query params are the single source of truth for filter state.
  // This makes filtered views shareable and survives back/forward
  // navigation without re-mounting the component.
  const activeType: TypeFilter = (() => {
    const v = searchParams.get('type')
    if (v === 'all') return 'all'
    return isArticleType(v) ? v : 'all'
  })()

  const activeRange: DateRange = (() => {
    const v = searchParams.get('range')
    return isDateRange(v) ? v : 'all'
  })()

  const activeCategory: string | null = searchParams.get('category')

  useEffect(() => {
    setDefaultSeo()
  }, [])

  const visible = useMemo(() => {
    return articles.filter(a => {
      if (activeType !== 'all' && inferType(a) !== activeType) return false
      if (!isWithinDateRange(a, activeRange)) return false
      if (activeCategory && a.category !== activeCategory) return false
      return true
    })
  }, [articles, activeType, activeRange, activeCategory])

  // Categories are derived from the *current* type+range filtered set so the
  // sidebar reflects what's actually selectable. Without this the sidebar
  // would advertise category counts that drop to 0 once the user switches
  // tabs.
  const categories = useMemo(() => {
    const pool = articles.filter(a => {
      if (activeType !== 'all' && inferType(a) !== activeType) return false
      if (!isWithinDateRange(a, activeRange)) return false
      return true
    })
    return Array.from(new Set(pool.map(a => a.category))).map(cat => ({
      name: cat,
      count: pool.filter(a => a.category === cat).length,
    }))
  }, [articles, activeType, activeRange])

  const featured = visible[0]
  const rest = visible.slice(1)

  function updateParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams)
    if (value === null || value === '' || value === 'all') {
      next.delete(key)
    } else {
      next.set(key, value)
    }
    setSearchParams(next, { replace: true })
  }

  function onTypeClick(value: TypeFilter) {
    trackEvent({ name: 'type_filter_click', params: { type: value } })
    updateParam('type', value)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function onRangeClick(value: DateRange) {
    trackEvent({ name: 'range_filter_click', params: { range: value } })
    updateParam('range', value)
  }

  function onCategoryClick(name: string) {
    trackEvent({ name: 'category_click', params: { category: name } })
    // Toggle: clicking the active category clears it.
    updateParam('category', activeCategory === name ? null : name)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function onFeaturedClick() {
    if (!featured) return
    trackEvent({
      name: 'featured_click',
      params: { slug: featured.slug, category: featured.category },
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <span className="text-[10px] font-bold tracking-widest text-outline uppercase animate-pulse">
          LOADING…
        </span>
      </div>
    )
  }

  const filterBar = (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-4 mb-12 border-b border-outline-variant/20 pb-6">
      {/* Type tabs */}
      <div className="flex items-center gap-1" role="tablist" aria-label="記事種別">
        {TYPE_TABS.map(tab => {
          const active = activeType === tab.value
          return (
            <button
              key={tab.value}
              role="tab"
              aria-selected={active}
              onClick={() => onTypeClick(tab.value)}
              className={`px-3 py-2 text-[10px] font-bold tracking-widest uppercase transition-colors border ${
                active
                  ? 'bg-tertiary text-on-tertiary border-tertiary'
                  : 'border-outline-variant/40 hover:border-tertiary hover:text-tertiary'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Date range segmented control */}
      <div
        className="flex items-center gap-1"
        role="radiogroup"
        aria-label="期間"
      >
        <span className="text-[10px] font-bold tracking-widest text-outline uppercase mr-2">
          期間
        </span>
        {DATE_RANGES.map(range => {
          const active = activeRange === range
          return (
            <button
              key={range}
              role="radio"
              aria-checked={active}
              onClick={() => onRangeClick(range)}
              className={`px-2 py-2 text-[10px] font-bold tracking-widest uppercase transition-colors ${
                active
                  ? 'text-tertiary border-b-2 border-tertiary'
                  : 'text-outline border-b-2 border-transparent hover:text-tertiary'
              }`}
            >
              {DATE_RANGE_LABELS[range]}
            </button>
          )
        })}
      </div>
    </div>
  )

  return (
    <>
      {/* Hero */}
      {featured && (
        <section className="w-full bg-surface border-b border-outline-variant/10">
          <div className="max-w-[1440px] mx-auto px-6 md:px-12 pt-16 pb-24">
            <div className="swiss-grid">
              <div className="col-span-12 lg:col-span-7 relative overflow-hidden">
                <img
                  src={withBasePath(
                    featured.image || '/assets/images/ai-native-transformation.jpg',
                  )}
                  alt={featured.title}
                  onError={(e) => {
                    // Same image-404 backstop as ArticleCard — swap in the
                    // hero placeholder so the featured slot never shows a
                    // broken icon.
                    const t = e.currentTarget
                    const fallback = withBasePath('/assets/images/ai-native-transformation.jpg')
                    if (t.src !== fallback) t.src = fallback
                  }}
                  className="w-full aspect-[16/9] object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex flex-col justify-end p-8">
                  <span className="inline-block bg-tertiary text-on-tertiary px-2 py-1 text-[10px] font-bold tracking-widest uppercase mb-4">
                    {activeCategory || activeType !== 'all' || activeRange !== 'all'
                      ? 'FILTERED'
                      : 'FEATURED'}
                  </span>
                  <Link to={`/article/${featured.slug}`} onClick={onFeaturedClick}>
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
                  <Link to={`/article/${featured.slug}`} onClick={onFeaturedClick}>
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
                    onClick={onFeaturedClick}
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
            {filterBar}
            <div className="flex items-center justify-between mb-12">
              <h3 className="text-3xl font-black tracking-tighter uppercase">
                {activeCategory ??
                  (activeType === 'explanation'
                    ? 'All Explanations'
                    : activeType === 'analysis'
                    ? 'All Analyses'
                    : 'All Articles')}
              </h3>
              <div className="h-[2px] flex-grow mx-8 bg-outline-variant/20" />
              <span className="text-[10px] font-bold text-outline tracking-widest uppercase">
                {visible.length} ARTICLES
              </span>
            </div>
            {activeCategory && (
              <button
                onClick={() => onCategoryClick(activeCategory)}
                className="mb-8 text-[10px] font-bold tracking-widest text-tertiary uppercase hover:underline"
              >
                × CLEAR CATEGORY
              </button>
            )}
            {visible.length === 0 ? (
              <div className="py-24 text-center">
                <span className="text-[10px] font-bold tracking-widest text-outline uppercase">
                  該当する記事はありません
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-y-16 gap-x-12">
                {rest.map((article, i) => (
                  <ArticleCard key={article.slug} article={article} index={i} />
                ))}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <aside className="col-span-12 lg:col-span-3 lg:pl-12">
            <div className="sticky top-24">
              <div className="mb-12">
                <h5 className="text-[10px] font-bold tracking-widest text-outline uppercase mb-6">
                  MUST READS
                </h5>
                <div className="space-y-8">
                  {articles.slice(0, 3).map((article, i) => (
                    <div key={article.slug} className="group cursor-pointer">
                      <span className="text-[9px] font-bold text-tertiary block mb-2">
                        {String(i + 1).padStart(2, '0')}.{' '}
                        {ARTICLE_TYPE_LABELS[inferType(article)]}
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
                    <li key={cat.name}>
                      <button
                        onClick={() => onCategoryClick(cat.name)}
                        className={`w-full flex justify-between group text-left ${
                          activeCategory === cat.name ? 'text-tertiary' : ''
                        }`}
                      >
                        <span className="text-sm font-bold uppercase group-hover:text-tertiary transition-colors">
                          {cat.name}
                        </span>
                        <span className="text-[10px] font-medium text-outline">{cat.count}</span>
                      </button>
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

