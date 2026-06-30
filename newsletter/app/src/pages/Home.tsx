import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ArticleCard from '../components/article/ArticleCard'
import type { ArticleMeta } from '../types/article'
import { withBasePath } from '../lib/paths'
import { setDefaultSeo } from '../lib/seo'
import { trackEvent } from '@kohuehara/shared/analytics'
import { displayTag, inferType } from '../lib/article-types'

// How many analyses fill one page. The homepage is a daily-use surface, not
// an archive crawl, so we paginate rather than render the whole corpus.
const PAGE_SIZE = 12

// How many tags the sidebar shows before the "すべて見る" toggle. Keeps the
// rail calm; the long tail is one click away.
const TOP_TAGS = 5

/**
 * Raw tag list for an article. `tags` (Notion `Tags`) is canonical; the
 * deprecated `categoriesMulti` is a fallback for pre-rename manifests, then
 * the singular `category`. We keep the *raw* names as keys (the `?category=`
 * filter matches them verbatim) and only strip the legacy A–E prefix at
 * render time via `displayTag`.
 */
function tagsOf(a: ArticleMeta): string[] {
  const t = a.tags ?? a.categoriesMulti
  if (t && t.length > 0) return t
  return a.category ? [a.category] : []
}

/**
 * Recency bucket for the time-grouped list. Fresh items get relative
 * headers (TODAY / THIS WEEK / THIS MONTH); everything older collapses to a
 * stable YYYY.MM month header so the archive reads as a clean monthly index
 * regardless of how sparse a given week is.
 */
function sectionLabel(dateStr: string): string {
  if (!dateStr) return 'UNDATED'
  const ts = new Date(dateStr).getTime()
  if (Number.isNaN(ts)) return 'UNDATED'
  const days = (Date.now() - ts) / 86_400_000
  if (days < 1) return 'TODAY'
  if (days < 7) return 'THIS WEEK'
  if (days < 31) return 'THIS MONTH'
  const d = new Date(dateStr)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function Home() {
  const [articles, setArticles] = useState<ArticleMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [showAllTags, setShowAllTags] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    fetch(withBasePath('posts/manifest.json'))
      .then(r => r.json())
      .then((data: ArticleMeta[]) => {
        const sorted = [...data].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        )
        setArticles(sorted)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    setDefaultSeo()
  }, [])

  // Analysis is the default — and only — list on the homepage. Explanation
  // articles are the "back drawer": reachable from each analysis's SOURCES
  // USED section, not surfaced here. URL query params remain the source of
  // truth for tag + page state so views are shareable and back-safe.
  const analyses = useMemo(
    () => articles.filter(a => inferType(a) === 'analysis'),
    [articles],
  )

  const activeCategory: string | null = searchParams.get('category')
  const page = (() => {
    const n = Number(searchParams.get('page'))
    return Number.isInteger(n) && n > 0 ? n : 1
  })()

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    return analyses.filter(a => {
      if (activeCategory && !tagsOf(a).includes(activeCategory)) return false
      if (q) {
        const hay = [
          a.title,
          a.abstract,
          ...tagsOf(a).map(displayTag),
        ]
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [analyses, activeCategory, q])

  // Tag cloud, flattened (no A–E hierarchy). Counts come from the full
  // analysis pool so the rail is stable as the user filters/searches.
  const tags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of analyses) {
      for (const t of tagsOf(a)) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [analyses])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  // Group the current page's items into recency sections, preserving the
  // date-descending order they already arrive in.
  const sections = useMemo(() => {
    const out: { label: string; items: ArticleMeta[] }[] = []
    for (const a of pageItems) {
      const label = sectionLabel(a.date)
      const last = out[out.length - 1]
      if (last && last.label === label) last.items.push(a)
      else out.push({ label, items: [a] })
    }
    return out
  }, [pageItems])

  const mustReads = analyses.slice(0, 3)
  const visibleTags = showAllTags ? tags : tags.slice(0, TOP_TAGS)

  function patchParams(changes: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '' || (key === 'page' && value === '1')) {
        next.delete(key)
      } else {
        next.set(key, value)
      }
    }
    setSearchParams(next, { replace: true })
  }

  function onTagClick(name: string) {
    trackEvent({ name: 'category_click', params: { category: name } })
    // Toggle off when re-clicking the active tag. Any tag change resets to
    // page 1 so the user isn't stranded on an out-of-range page.
    patchParams({
      category: activeCategory === name ? null : name,
      page: null,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function onQueryChange(value: string) {
    setQuery(value)
    if (safePage !== 1) patchParams({ page: null })
  }

  function goToPage(next: number) {
    if (next < 1 || next > totalPages || next === safePage) return
    trackEvent({ name: 'page_change', params: { page: next } })
    patchParams({ page: String(next) })
    window.scrollTo({ top: 0, behavior: 'smooth' })
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

  return (
    <section className="max-w-[1440px] mx-auto px-6 md:px-12 py-16">
      <div className="swiss-grid">
        {/* Main column */}
        <div className="col-span-12 lg:col-span-9">
          {/* Search + heading */}
          <div className="mb-12 border-b border-outline-variant/20 pb-6">
            <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
              <div className="flex items-baseline gap-4">
                <h3 className="text-3xl font-black tracking-tighter uppercase">
                  {activeCategory ? displayTag(activeCategory) : 'Latest'}
                </h3>
                <span className="text-[10px] font-bold text-outline tracking-widest uppercase">
                  {filtered.length} ARTICLES
                </span>
              </div>
              <label className="flex items-center gap-2 border-b-2 border-outline-variant/40 focus-within:border-tertiary transition-colors">
                <span className="text-[10px] font-bold tracking-widest text-outline uppercase">
                  検索
                </span>
                <input
                  type="search"
                  value={query}
                  onChange={e => onQueryChange(e.target.value)}
                  placeholder="タイトル・タグ"
                  aria-label="記事を絞り込み"
                  className="bg-transparent py-2 text-sm outline-none placeholder:text-outline/60 w-40 md:w-56"
                />
              </label>
            </div>
            {activeCategory && (
              <button
                onClick={() => onTagClick(activeCategory)}
                className="mt-4 text-[10px] font-bold tracking-widest text-tertiary uppercase hover:underline"
              >
                × {displayTag(activeCategory)} を解除
              </button>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="py-24 text-center">
              <span className="text-[10px] font-bold tracking-widest text-outline uppercase">
                該当する記事はありません
              </span>
            </div>
          ) : (
            <div className="space-y-16">
              {sections.map(section => (
                <div key={section.label}>
                  <div className="flex items-center gap-4 mb-8">
                    <h4 className="text-[10px] font-bold tracking-widest text-tertiary uppercase">
                      {section.label}
                    </h4>
                    <div className="h-[2px] flex-grow bg-outline-variant/20" />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-y-16 gap-x-12">
                    {section.items.map(article => (
                      <ArticleCard key={article.slug} article={article} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <nav
              className="mt-20 pt-8 border-t border-outline-variant/20 flex items-center justify-center gap-2"
              aria-label="ページ送り"
            >
              <button
                onClick={() => goToPage(safePage - 1)}
                disabled={safePage === 1}
                className="px-3 py-2 text-[10px] font-bold tracking-widest uppercase text-outline hover:text-tertiary disabled:opacity-30 disabled:hover:text-outline transition-colors"
              >
                ← PREV
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                <button
                  key={n}
                  onClick={() => goToPage(n)}
                  aria-current={n === safePage ? 'page' : undefined}
                  className={`px-3 py-2 text-[10px] font-bold tracking-widest uppercase transition-colors ${
                    n === safePage
                      ? 'text-tertiary border-b-2 border-tertiary'
                      : 'text-outline border-b-2 border-transparent hover:text-tertiary'
                  }`}
                >
                  {String(n).padStart(2, '0')}
                </button>
              ))}
              <button
                onClick={() => goToPage(safePage + 1)}
                disabled={safePage === totalPages}
                className="px-3 py-2 text-[10px] font-bold tracking-widest uppercase text-outline hover:text-tertiary disabled:opacity-30 disabled:hover:text-outline transition-colors"
              >
                NEXT →
              </button>
            </nav>
          )}
        </div>

        {/* Sidebar — capped height + own scroll so a long tag list never
            spills off-screen with no affordance (the old MUST READS bug). */}
        <aside className="col-span-12 lg:col-span-3 lg:pl-12">
          <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-1">
            <div className="mb-12">
              <h5 className="text-[10px] font-bold tracking-widest text-outline uppercase mb-6">
                MUST READS
              </h5>
              <div className="space-y-8">
                {mustReads.map((article, i) => (
                  <div key={article.slug} className="group">
                    <span className="text-[9px] font-bold text-tertiary block mb-2">
                      {String(i + 1).padStart(2, '0')}
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

            {tags.length > 0 && (
              <div>
                <h5 className="text-[10px] font-bold tracking-widest text-outline uppercase mb-6">
                  TAGS
                </h5>
                <ul className="space-y-3">
                  {visibleTags.map(tag => (
                    <li key={tag.name}>
                      <button
                        onClick={() => onTagClick(tag.name)}
                        className={`w-full flex justify-between group text-left ${
                          activeCategory === tag.name ? 'text-tertiary' : ''
                        }`}
                      >
                        <span className="text-xs font-medium leading-snug group-hover:text-tertiary transition-colors">
                          {displayTag(tag.name)}
                        </span>
                        <span className="text-[10px] font-medium text-outline shrink-0 ml-3">
                          {tag.count}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {tags.length > TOP_TAGS && (
                  <button
                    onClick={() => setShowAllTags(v => !v)}
                    className="mt-6 text-[10px] font-bold tracking-widest text-outline uppercase hover:text-tertiary transition-colors"
                  >
                    {showAllTags ? '− 閉じる' : `+ すべて見る (${tags.length})`}
                  </button>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  )
}
