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
   * Multi-select tag list (from the unified DB's `Tags` property). This is the
   * many-to-many taxonomy shown on cards, the article page, and the sidebar.
   */
  tags?: string[]
  /**
   * @deprecated Former name of `tags` (Notion `CategoriesMulti`). Kept as a
   * read fallback for any manifest generated before the rename; new exports
   * write `tags`.
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
   * values. See workforce/docs/epics/epic-002-agent-profile.md.
   */
  author?: string
  /**
   * Spotify episode/show deep-link for the article's podcast cast
   * (Epic-017). Present only once the episode is published to Spotify and
   * the operator records the URL back to Notion. When set, the article
   * page renders a Spotify icon link in the header meta row — there is no
   * in-page player (D3) and the site never references the raw MP3.
   */
  spotifyUrl?: string
  /**
   * `'true'` when a podcast cast exists for this article (Epic-017). Stored
   * as a string because frontmatter values are untyped strings; the reader
   * gates the Spotify link on `spotifyUrl` directly, so this is currently
   * informational/diagnostic.
   */
  hasPodcast?: string
}
