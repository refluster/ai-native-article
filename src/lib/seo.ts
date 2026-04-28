/**
 * seo.ts — dynamic <head> manipulation for SPA routes.
 *
 * GitHub Pages serves the same index.html for every route, so per-article
 * OG tags only show up for users already inside the app. Real scraper
 * support needs prerender (tracked in GROWTH.md §7). This helper handles
 * the client-side half: title, description, canonical, OG, and JSON-LD.
 */

const SITE_NAME = 'AI NATIVE ARTICLE'
const SITE_ORIGIN = 'https://kohuehara.xyz'
const SITE_BASE = '/ai-native-article'
const MAX_DESC = 160

interface ArticleSeo {
  title: string
  description: string
  slug: string
  category?: string
  date?: string
  image?: string
}

/** Resolve a manifest-style path (e.g. /posts/images/x.jpg) to an absolute URL
 *  under the site's base. Pass-through for already-absolute URLs. */
function absoluteAsset(path: string): string {
  if (/^https?:\/\//.test(path)) return path
  const cleaned = path.startsWith('/') ? path : `/${path}`
  return `${SITE_ORIGIN}${SITE_BASE}${cleaned}`
}

/** Strip markdown noise, leading quote-artifacts from frontmatter multi-line
 *  parsing, and collapse whitespace for meta/OG descriptions. */
function summarize(raw: string): string {
  const stripped = raw
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_`~]/g, '')
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (stripped.length <= MAX_DESC) return stripped
  return stripped.slice(0, MAX_DESC - 1).trimEnd() + '…'
}

function upsertMeta(selector: string, attrName: 'name' | 'property', attrValue: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attrName, attrValue)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', rel)
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

function upsertJsonLd(id: string, data: Record<string, unknown>) {
  let el = document.head.querySelector<HTMLScriptElement>(`script[data-ld="${id}"]`)
  if (!el) {
    el = document.createElement('script')
    el.type = 'application/ld+json'
    el.setAttribute('data-ld', id)
    document.head.appendChild(el)
  }
  el.textContent = JSON.stringify(data)
}

function removeJsonLd(id: string) {
  const el = document.head.querySelector(`script[data-ld="${id}"]`)
  if (el) el.remove()
}

export function setDefaultSeo() {
  document.title = `${SITE_NAME} — AI時代の解説と分析`
  const desc =
    'AI変革、ソフトウェア開発、組織の未来。一次情報の解説記事と、それらを横断する分析記事を毎日更新。'
  upsertMeta('meta[name="description"]', 'name', 'description', desc)
  upsertLink('canonical', `${SITE_ORIGIN}${SITE_BASE}/`)
  upsertMeta('meta[property="og:title"]', 'property', 'og:title', SITE_NAME)
  upsertMeta('meta[property="og:description"]', 'property', 'og:description', desc)
  upsertMeta('meta[property="og:type"]', 'property', 'og:type', 'website')
  upsertMeta('meta[property="og:url"]', 'property', 'og:url', `${SITE_ORIGIN}${SITE_BASE}/`)
  upsertMeta('meta[name="twitter:card"]', 'name', 'twitter:card', 'summary_large_image')
  removeJsonLd('article')
}

export function setArticleSeo(article: ArticleSeo) {
  const url = `${SITE_ORIGIN}${SITE_BASE}/article/${article.slug}`
  const title = `${article.title} — ${SITE_NAME}`
  const desc = summarize(article.description)
  document.title = title
  upsertMeta('meta[name="description"]', 'name', 'description', desc)
  upsertLink('canonical', url)
  upsertMeta('meta[property="og:title"]', 'property', 'og:title', article.title)
  upsertMeta('meta[property="og:description"]', 'property', 'og:description', desc)
  upsertMeta('meta[property="og:type"]', 'property', 'og:type', 'article')
  upsertMeta('meta[property="og:url"]', 'property', 'og:url', url)
  if (article.image) {
    upsertMeta('meta[property="og:image"]', 'property', 'og:image', absoluteAsset(article.image))
  }
  upsertMeta('meta[name="twitter:card"]', 'name', 'twitter:card', 'summary_large_image')

  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: desc,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
    inLanguage: 'ja',
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: `${SITE_ORIGIN}${SITE_BASE}/` },
  }
  if (article.date) ld.datePublished = article.date
  if (article.category) ld.articleSection = article.category
  if (article.image) ld.image = absoluteAsset(article.image)

  upsertJsonLd('article', ld)
}
