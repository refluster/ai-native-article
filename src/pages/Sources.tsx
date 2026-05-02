import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { ArticleMeta } from '../types/article'
import { withBasePath } from '../lib/paths'
import { setSourcesSeo } from '../lib/seo'
import { trackEvent } from '../lib/analytics'
import {
  buildSourceIndex,
  deriveTitle,
  hostnameOf,
  type SourceEntry,
} from '../lib/source-links'

type ScopeFilter = 'all' | 'with-explanation' | 'external-only'

const SCOPE_TABS: { value: ScopeFilter; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'with-explanation', label: '解説あり' },
  { value: 'external-only', label: '外部のみ' },
]

function categoryOf(entry: SourceEntry): string | null {
  return entry.explanation?.category ?? null
}

function tagsOf(entry: SourceEntry): string[] {
  const exp = entry.explanation
  if (!exp) return []
  if (exp.categoriesMulti && exp.categoriesMulti.length > 0) return exp.categoriesMulti
  return exp.category ? [exp.category] : []
}

export default function Sources() {
  const [articles, setArticles] = useState<ArticleMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    setSourcesSeo()
  }, [])

  useEffect(() => {
    fetch(withBasePath('posts/manifest.json'))
      .then(r => r.json())
      .then((data: ArticleMeta[]) => {
        setArticles(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const activeScope: ScopeFilter = (() => {
    const v = searchParams.get('scope')
    if (v === 'with-explanation' || v === 'external-only') return v
    return 'all'
  })()

  const activeCategory: string | null = searchParams.get('category')

  const index = useMemo(() => buildSourceIndex(articles), [articles])

  const visible = useMemo(() => {
    return index.entries.filter(entry => {
      if (activeScope === 'with-explanation' && !entry.explanation) return false
      if (activeScope === 'external-only' && entry.explanation) return false
      if (activeCategory && !tagsOf(entry).includes(activeCategory)) return false
      return true
    })
  }, [index, activeScope, activeCategory])

  const { canonical, themes } = useMemo(() => {
    const pool = index.entries.filter(entry => {
      if (activeScope === 'with-explanation' && !entry.explanation) return false
      if (activeScope === 'external-only' && entry.explanation) return false
      return true
    })
    const counts = new Map<string, number>()
    for (const entry of pool) {
      for (const t of tagsOf(entry)) {
        counts.set(t, (counts.get(t) ?? 0) + 1)
      }
    }
    const all = Array.from(counts.entries()).map(([name, count]) => ({ name, count }))
    const isCanonical = (name: string) => /^[A-E][:：]\s/.test(name)
    return {
      canonical: all
        .filter(c => isCanonical(c.name))
        .sort((a, b) => a.name.localeCompare(b.name)),
      themes: all
        .filter(c => !isCanonical(c.name))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    }
  }, [index, activeScope])

  function updateParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams)
    if (value === null || value === '' || value === 'all') {
      next.delete(key)
    } else {
      next.set(key, value)
    }
    setSearchParams(next, { replace: true })
  }

  function onScopeClick(value: ScopeFilter) {
    updateParam('scope', value)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function onCategoryClick(name: string) {
    trackEvent({ name: 'category_click', params: { category: name } })
    updateParam('category', activeCategory === name ? null : name)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function onExternalClick(entry: SourceEntry) {
    const slug = entry.explanation?.slug ?? entry.analyses[0]?.slug ?? 'sources-index'
    trackEvent({
      name: 'outbound_click',
      params: { slug, href: entry.rawUrl, host: hostnameOf(entry.url) },
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

  return (
    <>
      <section className="w-full bg-surface border-b border-outline-variant/10">
        <div className="max-w-[1440px] mx-auto px-6 md:px-12 pt-16 pb-12">
          <span className="inline-block text-[10px] font-bold tracking-widest text-outline uppercase mb-6">
            ORIGINAL SOURCES
          </span>
          <h1 className="text-3xl md:text-5xl font-black tracking-tight leading-tight mb-6">
            オリジナル記事
          </h1>
          <p className="text-base md:text-lg leading-relaxed text-on-surface-variant max-w-3xl">
            このサイトが取り上げた一次情報の一覧です。各行から、解説記事・分析記事・外部の元記事へ移動できます。
          </p>
        </div>
      </section>

      <section className="max-w-[1440px] mx-auto px-6 md:px-12 py-12">
        <div className="swiss-grid">
          <div className="col-span-12 lg:col-span-9">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-4 mb-10 border-b border-outline-variant/20 pb-6">
              <div className="flex items-center gap-1" role="tablist" aria-label="範囲">
                {SCOPE_TABS.map(tab => {
                  const active = activeScope === tab.value
                  return (
                    <button
                      key={tab.value}
                      role="tab"
                      aria-selected={active}
                      onClick={() => onScopeClick(tab.value)}
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
              <span className="text-[10px] font-bold tracking-widest text-outline uppercase ml-auto">
                {visible.length} SOURCES
              </span>
            </div>

            {activeCategory && (
              <button
                onClick={() => onCategoryClick(activeCategory)}
                className="mb-6 text-[10px] font-bold tracking-widest text-tertiary uppercase hover:underline"
              >
                × CLEAR CATEGORY ({activeCategory})
              </button>
            )}

            {visible.length === 0 ? (
              <div className="py-24 text-center">
                <span className="text-[10px] font-bold tracking-widest text-outline uppercase">
                  該当する出典はありません
                </span>
              </div>
            ) : (
              <ul className="divide-y divide-outline-variant/20 border-y border-outline-variant/20">
                {visible.map(entry => (
                  <SourceRow
                    key={entry.url}
                    entry={entry}
                    onExternalClick={onExternalClick}
                  />
                ))}
              </ul>
            )}
          </div>

          <aside className="col-span-12 lg:col-span-3 lg:pl-12">
            <div className="sticky top-24">
              {canonical.length > 0 && (
                <div className="mb-12">
                  <h5 className="text-[10px] font-bold tracking-widest text-outline uppercase mb-6">
                    CATEGORIES
                  </h5>
                  <ul className="space-y-3">
                    {canonical.map(cat => (
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
              )}

              {themes.length > 0 && (
                <div>
                  <h5 className="text-[10px] font-bold tracking-widest text-outline uppercase mb-6">
                    THEMES
                  </h5>
                  <ul className="space-y-3">
                    {themes.map(cat => (
                      <li key={cat.name}>
                        <button
                          onClick={() => onCategoryClick(cat.name)}
                          className={`w-full flex justify-between group text-left ${
                            activeCategory === cat.name ? 'text-tertiary' : ''
                          }`}
                        >
                          <span className="text-xs font-medium leading-snug group-hover:text-tertiary transition-colors">
                            {cat.name}
                          </span>
                          <span className="text-[10px] font-medium text-outline shrink-0 ml-3">
                            {cat.count}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </aside>
        </div>
      </section>
    </>
  )
}

interface RowProps {
  entry: SourceEntry
  onExternalClick: (entry: SourceEntry) => void
}

function SourceRow({ entry, onExternalClick }: RowProps) {
  const exp = entry.explanation
  const title = exp?.title ?? deriveTitle(entry.url)
  const abstract = exp?.abstract ?? ''
  const category = categoryOf(entry)
  const host = hostnameOf(entry.url)

  return (
    <li className="py-6">
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 md:col-span-8">
          <div className="flex items-center gap-2 mb-2">
            {category ? (
              <span className="text-[10px] font-bold tracking-widest text-tertiary uppercase">
                {category}
              </span>
            ) : (
              <span className="text-[10px] font-bold tracking-widest text-outline uppercase">
                外部のみ
              </span>
            )}
            <span className="text-[10px] font-bold tracking-widest text-outline uppercase">
              {host}
            </span>
            {entry.latestDate && (
              <span className="text-[10px] font-medium tracking-widest text-outline uppercase ml-auto md:hidden">
                {entry.latestDate}
              </span>
            )}
          </div>
          {exp ? (
            <Link
              to={`/article/${exp.slug}`}
              className="text-lg md:text-xl font-extrabold tracking-tight leading-snug block mb-2 hover:text-tertiary transition-colors"
            >
              {title}
            </Link>
          ) : (
            <h3 className="text-lg md:text-xl font-extrabold tracking-tight leading-snug mb-2 text-on-surface-variant">
              {title}
            </h3>
          )}
          {abstract && (
            <p className="text-sm leading-relaxed text-on-surface-variant line-clamp-2">
              {abstract}
            </p>
          )}
          {entry.analyses.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[10px] font-bold tracking-widest text-outline uppercase">
                Used in {entry.analyses.length} analysis{entry.analyses.length === 1 ? '' : 'es'}:
              </span>
              {entry.analyses.map((a, i) => (
                <span key={a.slug} className="text-[11px]">
                  <Link
                    to={`/article/${a.slug}`}
                    className="font-bold underline decoration-outline-variant/60 hover:text-tertiary hover:decoration-tertiary"
                  >
                    {a.title}
                  </Link>
                  {i < entry.analyses.length - 1 && (
                    <span className="text-outline">,</span>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="col-span-12 md:col-span-4 flex flex-col md:items-end gap-3">
          {entry.latestDate && (
            <span className="hidden md:inline text-[10px] font-medium tracking-widest text-outline uppercase">
              {entry.latestDate}
            </span>
          )}
          <div className="flex items-center gap-3">
            {exp && (
              <Link
                to={`/article/${exp.slug}`}
                className="text-[10px] font-bold tracking-widest uppercase border border-outline-variant/40 px-3 py-1.5 hover:border-tertiary hover:text-tertiary transition-colors"
              >
                解説を読む →
              </Link>
            )}
            <a
              href={entry.rawUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onExternalClick(entry)}
              className="text-[10px] font-bold tracking-widest uppercase border border-outline-variant/40 px-3 py-1.5 hover:border-tertiary hover:text-tertiary transition-colors inline-flex items-center gap-1"
            >
              元記事 ↗
            </a>
          </div>
        </div>
      </div>
    </li>
  )
}
