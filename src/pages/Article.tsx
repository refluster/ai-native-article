import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ArticleMeta, ArticleType } from '../types/article'
import { withBasePath } from '../lib/paths'
import { setArticleSeo, setDefaultSeo } from '../lib/seo'
import { trackEvent, isOutbound, hrefHost } from '../lib/analytics'
import { ARTICLE_TYPE_LABELS, inferType, isArticleType } from '../lib/article-types'
import { buildSourceIndex } from '../lib/source-links'
import SourcesUsedSection from '../components/SourcesUsedSection'
import AnalysesUsingSection from '../components/AnalysesUsingSection'

interface Frontmatter extends ArticleMeta {
  notionId?: string
}

const TYPE_BADGE_EN: Record<ArticleType, string> = {
  explanation: 'EXPLANATION',
  analysis: 'ANALYSIS',
}

function parseFrontmatter(raw: string): { meta: Partial<Frontmatter>; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { meta: {}, content: raw }

  const meta: Partial<Frontmatter> = {}
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim() as keyof Frontmatter
    const value = line.slice(idx + 1).trim().replace(/^"(.*)"$/, '$1')
    ;(meta as Record<string, string>)[key] = value
  }
  return { meta, content: match[2].trim() }
}

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

// Scroll-depth thresholds we report as distinct events (GROWTH.md §2).
const DEPTH_STEPS = [25, 50, 75, 90] as const

export default function Article() {
  const { slug } = useParams<{ slug: string }>()
  const [meta, setMeta] = useState<Partial<Frontmatter>>({})
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [articleIndex, setArticleIndex] = useState(0)
  const [manifestImage, setManifestImage] = useState<string | undefined>()
  const [manifest, setManifest] = useState<ArticleMeta[]>([])

  // Refs so the scroll listener closes over mutable state without re-binding.
  const depthsHit = useRef<Set<number>>(new Set())
  const completeFired = useRef(false)
  const mountedAt = useRef<number>(0)
  const articleRef = useRef<HTMLElement | null>(null)
  const slugRef = useRef<string | undefined>(slug)
  const categoryRef = useRef<string>('')

  useEffect(() => {
    slugRef.current = slug
    depthsHit.current = new Set()
    completeFired.current = false
    mountedAt.current = Date.now()
  }, [slug])

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    setError(false)

    fetch(withBasePath('posts/manifest.json'))
      .then(r => r.json())
      .then((data: (ArticleMeta & { image?: string })[]) => {
        setManifest(data)
        const idx = data.findIndex(a => a.slug === slug)
        setArticleIndex(idx >= 0 ? idx : 0)
        if (idx >= 0 && data[idx].image) setManifestImage(data[idx].image)
      })
      .catch(() => {})

    fetch(withBasePath(`posts/${slug}.md`))
      .then(r => {
        if (!r.ok) throw new Error('Not found')
        return r.text()
      })
      .then(raw => {
        const { meta: m, content: c } = parseFrontmatter(raw)
        setMeta(m)
        setContent(c)
        setLoading(false)
        categoryRef.current = m.category || ''
        setArticleSeo({
          title: m.title || 'Untitled',
          description: m.abstract || '',
          slug,
          category: m.category,
          date: m.date,
          image: m.image,
        })
        trackEvent({
          name: 'article_view',
          params: {
            slug,
            category: m.category || '',
            date: m.date || '',
          },
        })
      })
      .catch(() => {
        setError(true)
        setLoading(false)
      })

    return () => {
      setDefaultSeo()
    }
  }, [slug])

  // Re-emit SEO once the manifest image resolves, so og:image points at the
  // per-article asset rather than nothing.
  useEffect(() => {
    if (!slug || !meta.title || !manifestImage) return
    setArticleSeo({
      title: meta.title,
      description: meta.abstract || '',
      slug,
      category: meta.category,
      date: meta.date,
      image: manifestImage,
    })
  }, [manifestImage, meta.title, meta.abstract, meta.category, meta.date, slug])

  // Scroll-depth tracking. We measure relative to the article body, not the
  // full page, so header/footer don't distort the signal.
  useEffect(() => {
    if (!content) return

    function onScroll() {
      const el = articleRef.current
      const s = slugRef.current
      if (!el || !s) return

      const rect = el.getBoundingClientRect()
      const viewportBottom = window.innerHeight
      const totalHeight = rect.height
      const scrolledPast = Math.min(totalHeight, Math.max(0, viewportBottom - rect.top))
      const pct = totalHeight > 0 ? (scrolledPast / totalHeight) * 100 : 0

      for (const step of DEPTH_STEPS) {
        if (pct >= step && !depthsHit.current.has(step)) {
          depthsHit.current.add(step)
          const name =
            step === 25 ? 'article_read_25' :
            step === 50 ? 'article_read_50' :
            step === 75 ? 'article_read_75' :
            'article_read_90'
          trackEvent({
            name,
            params: { slug: s, category: categoryRef.current },
          } as never)
        }
      }

      if (pct >= 90 && !completeFired.current) {
        const dwell = Date.now() - mountedAt.current
        if (dwell >= 30_000) {
          completeFired.current = true
          trackEvent({
            name: 'article_read_complete',
            params: { slug: s, category: categoryRef.current, dwell_ms: dwell },
          })
        }
      }
    }

    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [content])

  // Link classification: outbound vs internal. Fires one event per click;
  // does not intercept the navigation.
  function onBodyClick(e: React.MouseEvent<HTMLElement>) {
    const target = (e.target as HTMLElement).closest('a')
    if (!target || !slug) return
    const href = target.getAttribute('href') || ''
    if (!href) return
    if (isOutbound(href)) {
      trackEvent({
        name: 'outbound_click',
        params: { slug, href, host: hrefHost(href) },
      })
    } else {
      trackEvent({
        name: 'internal_link_click',
        params: { slug, href },
      })
    }
  }

  const sourceIndex = useMemo(() => buildSourceIndex(manifest), [manifest])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <span className="text-[10px] font-bold tracking-widest text-outline uppercase animate-pulse">
          LOADING...
        </span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-32 text-center">
        <span className="text-[10px] font-bold tracking-widest text-tertiary uppercase block mb-4">
          404
        </span>
        <h1 className="text-4xl font-black tracking-tighter mb-8">Article not found</h1>
        <Link to="/" className="text-xs font-bold tracking-widest uppercase hover:text-tertiary">
          ← BACK TO INDEX
        </Link>
      </div>
    )
  }

  const heroImage = manifestImage ? withBasePath(manifestImage) : IMAGES[articleIndex % IMAGES.length]
  const articleType = inferType({ type: isArticleType(meta.type) ? meta.type : undefined })

  return (
    <>
      {/* Header section */}
      <section className="w-full bg-surface border-b border-outline-variant/10">
        <div className="max-w-[1440px] mx-auto px-6 md:px-12 pt-16 pb-12">
          <Link
            to="/"
            className="inline-block text-[10px] font-bold tracking-widest text-outline uppercase mb-10 hover:text-tertiary transition-colors"
          >
            ← INDEX
          </Link>
          <div className="max-w-3xl">
            {meta.category && (
              <span className="inline-block bg-tertiary text-on-tertiary px-2 py-1 text-[10px] font-bold tracking-widest uppercase mb-6">
                {meta.category}
              </span>
            )}
            <h1 className="text-3xl md:text-5xl font-black tracking-tight leading-tight mb-8">
              {meta.title}
            </h1>
            {meta.abstract && (
              <p className="text-xl leading-relaxed text-on-surface-variant mb-8 border-l-4 border-tertiary pl-6">
                {meta.abstract}
              </p>
            )}
            <div className="flex items-center gap-6 text-[10px] font-bold tracking-widest text-outline uppercase">
              {meta.date && <span>{meta.date}</span>}
              <span>AI NATIVE ARTICLE</span>
              {/* Type-driven label. Falls back to ANALYSIS for legacy
                  manifest entries that predate the unified-DB rollout. */}
              <span className="text-tertiary">
                {ARTICLE_TYPE_LABELS[inferType({ type: isArticleType(meta.type) ? meta.type : undefined })]}
                {' / '}
                {TYPE_BADGE_EN[inferType({ type: isArticleType(meta.type) ? meta.type : undefined })]}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Hero image */}
      <div className="w-full max-h-[480px] overflow-hidden">
        <img
          src={heroImage}
          alt={meta.title}
          onError={(e) => {
            // 404 backstop. Falls back to the rotating placeholder set
            // (same set used by ArticleCard) so the hero never shows a
            // broken image when an L4-published image is missing.
            const t = e.currentTarget
            const fallback = IMAGES[articleIndex % IMAGES.length]
            if (t.src !== fallback) t.src = fallback
          }}
          className="w-full object-cover grayscale"
          style={{ maxHeight: 480, objectPosition: 'center' }}
        />
      </div>

      {/* Article body */}
      <article
        ref={articleRef}
        className="max-w-3xl mx-auto px-6 md:px-12 py-16 article-content"
        onClick={onBodyClick}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </article>

      {slug && articleType === 'analysis' && (
        <SourcesUsedSection slug={slug} sourceUrls={meta.sourceUrls} index={sourceIndex} />
      )}
      {slug && articleType === 'explanation' && (
        <AnalysesUsingSection slug={slug} sourceUrls={meta.sourceUrls} index={sourceIndex} />
      )}

      {/* Back link */}
      <div className="max-w-3xl mx-auto px-6 md:px-12 pb-24">
        <div className="border-t border-outline-variant/20 pt-10">
          <Link
            to="/"
            className="text-xs font-bold tracking-widest uppercase hover:text-tertiary transition-colors"
          >
            ← BACK TO ALL INSIGHTS
          </Link>
        </div>
      </div>
    </>
  )
}
