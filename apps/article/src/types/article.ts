export type ArticleType = 'explanation' | 'analysis'

export interface ArticleMeta {
  slug: string
  title: string
  /**
   * Article type. Optional during the L2/L3 unified-DB rollout — older
   * manifest entries lack this field. Consumers should fall back to
   * 'analysis' (the legacy L3 default) via `inferType` in
   * `src/lib/article-types.ts` when reading.
   */
  type?: ArticleType
  category: string
  /**
   * Optional multi-select tag list (from the unified DB's `CategoriesMulti`
   * property). Currently used only by the upcoming category-cloud UI.
   */
  categoriesMulti?: string[]
  date: string
  abstract: string
  /** Hero image path under /posts/images/. Set by the L4 publish step. */
  image?: string
  /**
   * Comma-separated list of source article URLs. Single URL for explanation
   * articles (L2 origin), multiple for analysis articles (L3 origin).
   */
  sourceUrls?: string
  /**
   * Workforce persona slug that authored the article (`sora`, `maya`, …)
   * or `anonymous` for the legacy unnamed-narrator articles. Optional
   * during the agent rollout — older entries lack this field; the
   * AuthorChip falls back to a quiet placeholder for missing/unknown
   * values. See workforce/docs/rfcs/rfc-002-agent-profile.md.
   */
  author?: string
}
