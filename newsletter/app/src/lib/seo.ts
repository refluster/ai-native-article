/**
 * seo.ts — dynamic <head> manipulation for SPA routes.
 *
 * GitHub Pages serves the same index.html for every route, so per-article
 * OG tags only show up for users already inside the app. Real scraper
 * support needs prerender (tracked in GROWTH.md §7). This helper handles
 * the client-side half: title, description, canonical, OG, and JSON-LD.
 */

import { displayTag } from './article-types'
import { LANGUAGES, type Language } from '../i18n/language'
import { SITE_BASENAME } from '../config/site'

const SITE_NAME = 'AI NATIVE ARTICLE'
const SITE_ORIGIN = 'https://kohuehara.xyz'
// The domain-root-relative empty-string variant of site.ts's SITE_BASE_PATH —
// the same value routerBaseName() (lib/paths.ts) uses for BrowserRouter's
// `basename`, so every "where does this site live" answer traces to one
// constant (issue 600, remediation A2 on PR 606).
const SITE_BASE = SITE_BASENAME
const MAX_DESC = 160

/**
 * Site-level copy per edition. Japanese is the canonical voice; the English
 * strings are the same promise, not a machine translation of the Japanese
 * sentence structure.
 */
const SITE_COPY: Record<Language, { tagline: string; description: string }> = {
  ja: {
    tagline: 'AI時代の解説と分析',
    description:
      'AI変革、ソフトウェア開発、組織の未来。一次情報の解説記事と、それらを横断する分析記事を毎日更新。',
  },
  en: {
    tagline: 'Explanations and analysis for the AI era',
    description:
      'AI transformation, software development, and the future of work — daily explanations of primary sources, and analyses that read across them.',
  },
}

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

/**
 * Declare the two editions of a page to crawlers (ADR-0005).
 *
 * Both editions live at the same URL — the reader's language decides which one
 * renders — so the alternates are that URL plus an explicit `?lang=`, which
 * `resolveLanguage` honours ahead of everything else. `x-default` points at the
 * bare URL, whose language then follows the visitor's own browser.
 */
function upsertAlternates(url: string) {
  for (const el of Array.from(
    document.head.querySelectorAll('link[rel="alternate"][hreflang]'),
  )) {
    el.remove()
  }
  const add = (hreflang: string, href: string) => {
    const el = document.createElement('link')
    el.setAttribute('rel', 'alternate')
    el.setAttribute('hreflang', hreflang)
    el.setAttribute('href', href)
    document.head.appendChild(el)
  }
  for (const lang of LANGUAGES) add(lang, `${url}?lang=${lang}`)
  add('x-default', url)
}

export function setDefaultSeo(language: Language = 'ja') {
  const url = `${SITE_ORIGIN}${SITE_BASE}/`
  const { tagline, description: desc } = SITE_COPY[language]
  document.title = `${SITE_NAME} — ${tagline}`
  upsertMeta('meta[name="description"]', 'name', 'description', desc)
  upsertLink('canonical', url)
  upsertAlternates(url)
  upsertMeta('meta[property="og:title"]', 'property', 'og:title', SITE_NAME)
  upsertMeta('meta[property="og:description"]', 'property', 'og:description', desc)
  upsertMeta('meta[property="og:type"]', 'property', 'og:type', 'website')
  upsertMeta('meta[property="og:url"]', 'property', 'og:url', url)
  upsertMeta('meta[property="og:locale"]', 'property', 'og:locale', language === 'ja' ? 'ja_JP' : 'en_US')
  upsertMeta('meta[name="twitter:card"]', 'name', 'twitter:card', 'summary_large_image')
  removeJsonLd('article')
}

export function setSourcesSeo() {
  const url = `${SITE_ORIGIN}${SITE_BASE}/sources`
  const title = `オリジナル記事 — ${SITE_NAME}`
  const desc = 'このサイトが取り上げた一次情報の一覧。各出典から、解説記事・分析記事・元の外部記事へ移動できます。'
  document.title = title
  upsertMeta('meta[name="description"]', 'name', 'description', desc)
  upsertLink('canonical', url)
  upsertMeta('meta[property="og:title"]', 'property', 'og:title', 'オリジナル記事')
  upsertMeta('meta[property="og:description"]', 'property', 'og:description', desc)
  upsertMeta('meta[property="og:type"]', 'property', 'og:type', 'website')
  upsertMeta('meta[property="og:url"]', 'property', 'og:url', url)
  upsertMeta('meta[name="twitter:card"]', 'name', 'twitter:card', 'summary_large_image')
  removeJsonLd('article')
}

export function setOperatorSeo() {
  const url = `${SITE_ORIGIN}${SITE_BASE}/operator`
  const title = `Operator — ${SITE_NAME}`
  const desc = '運営者向けのツールとリファレンスの集約ページ。'
  document.title = title
  upsertMeta('meta[name="description"]', 'name', 'description', desc)
  upsertLink('canonical', url)
  upsertMeta('meta[property="og:title"]', 'property', 'og:title', 'Operator')
  upsertMeta('meta[property="og:description"]', 'property', 'og:description', desc)
  upsertMeta('meta[property="og:type"]', 'property', 'og:type', 'website')
  upsertMeta('meta[property="og:url"]', 'property', 'og:url', url)
  upsertMeta('meta[name="twitter:card"]', 'name', 'twitter:card', 'summary')
  removeJsonLd('article')
}

export function setArticleSeo(article: ArticleSeo, language: Language = 'ja') {
  const url = `${SITE_ORIGIN}${SITE_BASE}/article/${article.slug}`
  const title = `${article.title} — ${SITE_NAME}`
  const desc = summarize(article.description)
  document.title = title
  upsertMeta('meta[name="description"]', 'name', 'description', desc)
  upsertLink('canonical', url)
  upsertAlternates(url)
  upsertMeta('meta[property="og:locale"]', 'property', 'og:locale', language === 'ja' ? 'ja_JP' : 'en_US')
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
    // The edition actually rendered, not the reader's preference — an English
    // reader served the Japanese fallback is reading Japanese.
    inLanguage: language,
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: `${SITE_ORIGIN}${SITE_BASE}/` },
  }
  if (article.date) ld.datePublished = article.date
  if (article.category) ld.articleSection = displayTag(article.category)
  if (article.image) ld.image = absoluteAsset(article.image)

  upsertJsonLd('article', ld)
}
