import { isValidElement, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { useParams, Link } from 'react-router-dom'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import MermaidBlock from '../components/article/MermaidBlock'
import type { ArticleMeta, ArticleType } from '../types/article'
import { withBasePath } from '../lib/paths'
import { setArticleSeo, setDefaultSeo } from '../lib/seo'
import { trackEvent, isOutbound, hrefHost } from '@kohuehara/shared/analytics'
import { ARTICLE_TYPE_LABELS, displayTag, inferType, isArticleType } from '../lib/article-types'
import { buildSourceIndex } from '../lib/source-links'
import SourcesUsedSection from '../components/article/SourcesUsedSection'
import AnalysesUsingSection from '../components/article/AnalysesUsingSection'
import AuthorChip from '../components/byline/AuthorChip'
import { parseAuthorSlugs } from '../lib/byline'

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

// Scroll-depth thresholds we report as distinct events (GROWTH.md §2).
const DEPTH_STEPS = [25, 50, 75, 90] as const

/** The source of a ```mermaid fence, or null for any other <pre> content. */
function extractMermaidSource(children: ReactNode): string | null {
  const child = Array.isArray(children) ? children[0] : children
  if (!isValidElement(child)) return null
  const { className, children: source } = child.props as {
    className?: string
    children?: ReactNode
  }
  if (!/\blanguage-mermaid\b/.test(className ?? '')) return null
  return String(source ?? '')
}

// Fenced ```mermaid blocks render as inline figures (ARTICLE-FIGURES.md);
// every other code block keeps the default dark <pre> treatment.
const markdownComponents: Components = {
  pre({ node: _node, children, ...rest }: ComponentProps<'pre'> & { node?: unknown }) {
    const source = extractMermaidSource(children)
    if (source !== null) return <MermaidBlock code={source} />
    return <pre {...rest}>{children}</pre>
  },
}

export default function Article() {
  const { slug } = useParams<{ slug: string }>()
  const [meta, setMeta] = useState<Partial<Frontmatter>>({})
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
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
      .then((data: ArticleMeta[]) => {
        setManifest(data)
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

  const articleType = inferType({ type: isArticleType(meta.type) ? meta.type : undefined })

  // The article's tags (Notion `Tags`), shown in place of the old single
  // category. `categoriesMulti` is the pre-rename fallback; `category` covers
  // any row with neither. Prefix-stripped for display via displayTag.
  const tags = (meta.tags ?? meta.categoriesMulti ?? (meta.category ? [meta.category] : []))
    .map(displayTag)
    .filter(Boolean)

  return (
    <>
      {/* Header section */}
      <section className="w-full bg-surface border-b border-outline-variant/10">
        <div className="max-w-[1440px] mx-auto px-6 md:px-12 pt-16 pb-12">
          <Link
            to="/"
            className="print-hide inline-block text-[10px] font-bold tracking-widest text-outline uppercase mb-10 hover:text-tertiary transition-colors"
          >
            ← INDEX
          </Link>
          <div className="max-w-3xl">
            {tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mb-6">
                {tags.map(tag => (
                  <span
                    key={tag}
                    className="inline-block bg-tertiary text-on-tertiary px-2 py-1 text-[10px] font-bold tracking-widest uppercase"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <h1 className="text-3xl md:text-5xl font-black tracking-tight leading-tight mb-8">
              {meta.title}
            </h1>
            {meta.author && (() => {
              const slugs = parseAuthorSlugs(meta.author)
              return (
                <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2">
                  {slugs.map((slug) => (
                    <AuthorChip key={slug} slug={slug} size={32} compact={slugs.length > 1} />
                  ))}
                </div>
              )
            })()}
            {meta.abstract && (
              <p className="text-xl leading-relaxed text-on-surface-variant mb-8 border-l-4 border-tertiary pl-6">
                {meta.abstract}
              </p>
            )}
            <div className="flex items-center gap-6 text-[10px] font-bold tracking-widest text-outline uppercase">
              {meta.date && <span>{meta.date}</span>}
              <span>AI NATIVE ARTICLE</span>
              {/* Type label only for explanations — analysis is the default
                  reading surface, so it's left unmarked (per ADR-0002). The
                  label on an explanation signals the reader is in the
                  fact-check "back drawer". */}
              {articleType === 'explanation' && (
                <span className="text-tertiary">
                  {ARTICLE_TYPE_LABELS.explanation}
                  {' / '}
                  {TYPE_BADGE_EN.explanation}
                </span>
              )}
              {/* Epic-017: Spotify deep-link to the article's podcast episode.
                  Rendered only when the operator has recorded `spotifyUrl`
                  back to Notion. No in-page player (D3) — this is a link
                  out to Spotify, nothing more. Reuses the external-link
                  styling from SourcesUsedSection. */}
              {meta.spotifyUrl && (
                <a
                  href={meta.spotifyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Spotifyでポッドキャストを聴く"
                  onClick={() =>
                    trackEvent({
                      name: 'podcast_spotify_click',
                      params: { slug: slug ?? '', href: meta.spotifyUrl ?? '' },
                    })
                  }
                  className="inline-flex items-center gap-1.5 text-on-surface-variant hover:text-tertiary transition-colors normal-case tracking-normal"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.52 17.34c-.24.36-.66.48-1.02.24-2.82-1.74-6.36-2.1-10.56-1.14-.42.12-.78-.18-.9-.54-.12-.42.18-.78.54-.9 4.56-1.02 8.52-.6 11.64 1.32.42.18.48.66.3 1.02zm1.44-3.3c-.3.42-.84.6-1.26.3-3.24-1.98-8.16-2.58-11.94-1.38-.48.12-1.02-.12-1.14-.6-.12-.48.12-1.02.6-1.14 4.38-1.32 9.78-.66 13.5 1.62.36.18.6.84.24 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.1 9.3c-.6.18-1.2-.18-1.38-.72-.18-.6.18-1.2.72-1.38 4.32-1.32 11.4-1.02 15.84 1.62.54.3.72 1.02.42 1.56-.3.42-1.02.66-1.56.36z" />
                  </svg>
                  <span>Spotify ↗</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Article body */}
      <article
        ref={articleRef}
        className="max-w-3xl mx-auto px-6 md:px-12 py-16 article-content"
        onClick={onBodyClick}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {content}
        </ReactMarkdown>
      </article>

      {slug && articleType === 'analysis' && (
        <SourcesUsedSection slug={slug} sourceUrls={meta.sourceUrls} index={sourceIndex} />
      )}
      {slug && articleType === 'explanation' && (
        <AnalysesUsingSection slug={slug} sourceUrls={meta.sourceUrls} index={sourceIndex} />
      )}

      {/* Back link */}
      <div className="print-hide max-w-3xl mx-auto px-6 md:px-12 pb-24">
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
