import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ArticleMeta } from '../types/article'
import { withBasePath } from '../lib/paths'

interface Frontmatter extends ArticleMeta {
  notionId?: string
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

export default function Article() {
  const { slug } = useParams<{ slug: string }>()
  const [meta, setMeta] = useState<Partial<Frontmatter>>({})
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [articleIndex, setArticleIndex] = useState(0)

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    setError(false)

    // Get index from manifest for image selection
    fetch(withBasePath('posts/manifest.json'))
      .then(r => r.json())
      .then((manifest: ArticleMeta[]) => {
        const idx = manifest.findIndex(a => a.slug === slug)
        setArticleIndex(idx >= 0 ? idx : 0)
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
        document.title = m.title ? `${m.title} — AI NATIVE ARTICLE` : 'AI NATIVE ARTICLE'
      })
      .catch(() => {
        setError(true)
        setLoading(false)
      })
  }, [slug])

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

  const heroImage = IMAGES[articleIndex % IMAGES.length]

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
              <span>L3 INSIGHT</span>
            </div>
          </div>
        </div>
      </section>

      {/* Hero image */}
      <div className="w-full max-h-[480px] overflow-hidden">
        <img
          src={heroImage}
          alt={meta.title}
          className="w-full object-cover grayscale"
          style={{ maxHeight: 480, objectPosition: 'center' }}
        />
      </div>

      {/* Article body */}
      <article className="max-w-3xl mx-auto px-6 md:px-12 py-16 article-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </article>

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
