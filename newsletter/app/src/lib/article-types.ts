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

/**
 * Strip the legacy A–E bucket prefix from a tag label for display.
 *
 * The old single-category taxonomy stored canonical names like
 * `"C: New Roles / FDE"` where the leading letter encoded a hierarchy
 * position. The hierarchy is gone (flat tags now), and the letter only
 * confused readers, so we hide it at render time. Data-side cleanup (the
 * generation cadences + normalize-categories.mjs) removes the prefix at the
 * source; this guard keeps already-published rows clean until then.
 *
 * Non-prefixed tags (free-form `× theme` strings) pass through untouched.
 */
export function displayTag(name: string): string {
  return name.replace(/^[A-E][:：]\s*/, '')
}

/** Type guard: is the input a valid ArticleType? */
export function isArticleType(v: unknown): v is ArticleType {
  return v === 'explanation' || v === 'analysis'
}
