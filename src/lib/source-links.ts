import type { ArticleMeta } from '../types/article'
import { inferType } from './article-types'

export interface SourceEntry {
  url: string
  rawUrl: string
  explanation?: ArticleMeta
  analyses: ArticleMeta[]
  latestDate: string
}

export interface SourceIndex {
  byUrl: Map<string, SourceEntry>
  entries: SourceEntry[]
}

const TRACKING_PARAM_PREFIXES = ['utm_', 'syn-']
const TRACKING_PARAM_EXACT = new Set(['fbclid', 'gclid', 'ref', 'mc_cid', 'mc_eid'])

function stripTrackingParams(params: URLSearchParams) {
  const drop: string[] = []
  for (const key of params.keys()) {
    const k = key.toLowerCase()
    if (TRACKING_PARAM_EXACT.has(k)) drop.push(key)
    else if (TRACKING_PARAM_PREFIXES.some(p => k.startsWith(p))) drop.push(key)
  }
  for (const k of drop) params.delete(k)
}

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    const u = new URL(trimmed)
    u.hash = ''
    u.host = u.host.toLowerCase()
    u.protocol = u.protocol.toLowerCase()
    stripTrackingParams(u.searchParams)
    let out = u.toString()
    if (out.endsWith('/') && u.pathname !== '/') out = out.slice(0, -1)
    return out
  } catch {
    return trimmed.toLowerCase().replace(/#.*$/, '').replace(/\/+$/, '')
  }
}

export function parseSourceUrls(raw?: string): string[] {
  if (!raw) return []
  return raw
    .split(/[,\n]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

function pathTailOf(url: string): string {
  try {
    const u = new URL(url)
    const segments = u.pathname.split('/').filter(Boolean)
    return segments[segments.length - 1] ?? ''
  } catch {
    return ''
  }
}

export function deriveTitle(url: string): string {
  const host = hostnameOf(url)
  const tail = pathTailOf(url)
  if (!tail) return host
  const pretty = decodeURIComponent(tail)
    .replace(/[-_]+/g, ' ')
    .replace(/\.(html?|aspx?|php)$/i, '')
    .trim()
  return pretty ? `${host} — ${pretty}` : host
}

function maxDate(a: string | undefined, b: string | undefined): string {
  if (!a) return b ?? ''
  if (!b) return a
  return a >= b ? a : b
}

export function buildSourceIndex(articles: ArticleMeta[]): SourceIndex {
  const byUrl = new Map<string, SourceEntry>()

  const ensure = (raw: string): SourceEntry => {
    const norm = normalizeUrl(raw)
    let entry = byUrl.get(norm)
    if (!entry) {
      entry = { url: norm, rawUrl: raw, analyses: [], latestDate: '' }
      byUrl.set(norm, entry)
    }
    return entry
  }

  for (const article of articles) {
    const urls = parseSourceUrls(article.sourceUrls)
    if (urls.length === 0) continue
    const type = inferType(article)
    if (type === 'explanation') {
      const url = urls[0]
      const entry = ensure(url)
      if (!entry.explanation) entry.explanation = article
      entry.latestDate = maxDate(entry.latestDate, article.date)
    } else {
      for (const u of urls) {
        const entry = ensure(u)
        entry.analyses.push(article)
        entry.latestDate = maxDate(entry.latestDate, article.date)
      }
    }
  }

  const entries = Array.from(byUrl.values()).sort((a, b) => {
    if (a.latestDate === b.latestDate) return 0
    return a.latestDate < b.latestDate ? 1 : -1
  })

  return { byUrl, entries }
}

export function lookupByUrl(index: SourceIndex, raw: string): SourceEntry | undefined {
  return index.byUrl.get(normalizeUrl(raw))
}
