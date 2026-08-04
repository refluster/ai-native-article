/**
 * Shared fetcher contract (DB-agnostic).
 *
 * `ArticleRecord` is the *only* shape that crosses the boundary between
 * fetchers (Notion / DynamoDB / Postgres / …) and writers
 * (`posts-md.mjs`). Adding a new DB means writing a new fetcher that
 * returns this shape — writers never change.
 *
 * @typedef {Object} ArticleRecord
 *  @property {string} slug                  // Final, public-facing slug. legacySlug || slugFromId(id)
 *  @property {string} title
 *  @property {'explanation'|'analysis'} type
 *  @property {string} category              // Free-text. e.g. "テーマ1 × テーマ2"
 *  @property {string[]} tags                // Multi-select tags (Notion `Tags`). May be empty.
 *  @property {string} date                  // ISO date "YYYY-MM-DD"
 *  @property {string} abstract
 *  @property {string} bodyMd                // Body Markdown (no frontmatter)
 *  @property {string} [titleEn]             // ADR-0005: English edition title. '' when the row has no `EN` child page.
 *  @property {string} [abstractEn]          // ADR-0005: English edition lead. '' when absent.
 *  @property {string} [bodyEnMd]            // ADR-0005: English body Markdown. '' when the article is Japanese-only — the writer then emits no `<slug>.en.md`.
 *  @property {string} sourceUrls            // Comma-separated URLs (display)
 *  @property {string} legacySlug            // '' if unset
 *  @property {string} legacyNotionId        // '' if unset; original L2/L3 page id (set by migrate script)
 *  @property {string} notionId              // Original page id, for traceability
 *  @property {string} lastEditedAt          // ISO timestamp; for incremental fetch
 *  @property {string} [imagePath]           // e.g. "/posts/images/<slug>.jpg" or undefined
 *  @property {string} [author]              // Workforce persona slug (sora/maya/…). Optional; pre-workforce rows omit it.
 *  @property {string} [spotifyUrl]          // Epic-017: Spotify episode/show deep-link. Set once an episode is published. Drives the reader Spotify icon link.
 *  @property {string} [hasPodcast]          // Epic-017: 'true' when a podcast cast exists for this article. Informational.
 */

/**
 * @typedef {Object} FetcherOptions
 *  @property {string} apiKey
 *  @property {string} dbId
 *  @property {boolean} [bridgeMode]
 *  @property {string} [legacyDbId]          // when bridgeMode=true, also fetch this DB
 *  @property {(...args: unknown[]) => void} [logger]
 */

export const ARTICLE_TYPES = ['explanation', 'analysis']
