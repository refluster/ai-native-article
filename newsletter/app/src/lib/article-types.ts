/**
 * Article-type taxonomy and date-range filtering helpers.
 *
 * The internal `ArticleType` keys are English (`explanation` / `analysis`)
 * so JSON, URL query params, and code branches don't depend on Japanese
 * string normalisation. The UI surfaces the Japanese labels via
 * `ARTICLE_TYPE_LABELS`. See plan §1.2.
 */

import type { ArticleMeta, ArticleType } from '../types/article'

export const ARTICLE_TYPES = ['explanation', 'analysis'] as const

export const ARTICLE_TYPE_LABELS: Record<ArticleType, string> = {
  explanation: '解説',
  analysis: '分析',
}

/**
 * Resolve the article type with a safe fallback.
 *
 * Older manifest entries written before the L2/L3 unification lack the
 * `type` field. They were all L3 insights, so we default to 'analysis'.
 */
export function inferType(meta: Pick<ArticleMeta, 'type'>): ArticleType {
  return meta.type ?? 'analysis'
}

export type DateRange = '7d' | '30d' | '90d' | 'all'

export const DATE_RANGES: readonly DateRange[] = ['7d', '30d', '90d', 'all'] as const

export const DATE_RANGE_LABELS: Record<DateRange, string> = {
  '7d': '7日',
  '30d': '30日',
  '90d': '90日',
  all: '全期間',
}

/**
 * True iff the article's `date` falls within `range` relative to today.
 *
 * `all` always returns true. Invalid / missing dates pass the filter
 * (we'd rather show an undated article than silently hide it).
 */
export function isWithinDateRange(
  meta: Pick<ArticleMeta, 'date'>,
  range: DateRange,
): boolean {
  if (range === 'all') return true
  const dateStr = meta.date
  if (!dateStr) return true
  const articleTs = new Date(dateStr).getTime()
  if (Number.isNaN(articleTs)) return true
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return articleTs >= cutoff
}

/** Type guard: is the input a valid ArticleType? */
export function isArticleType(v: unknown): v is ArticleType {
  return v === 'explanation' || v === 'analysis'
}

/** Type guard: is the input a valid DateRange? */
export function isDateRange(v: unknown): v is DateRange {
  return v === '7d' || v === '30d' || v === '90d' || v === 'all'
}
