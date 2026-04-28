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
 *  @property {string[]} categoriesMulti     // Multi-select tags. May be empty.
 *  @property {string} date                  // ISO date "YYYY-MM-DD"
 *  @property {string} abstract
 *  @property {string} bodyMd                // Body Markdown (no frontmatter)
 *  @property {string} sourceUrls            // Comma-separated URLs (display)
 *  @property {string} legacySlug            // '' if unset
 *  @property {string} legacyNotionId        // '' if unset; original L2/L3 page id (set by migrate script)
 *  @property {string} notionId              // Original page id, for traceability
 *  @property {string} lastEditedAt          // ISO timestamp; for incremental fetch
 *  @property {string} [imagePath]           // e.g. "/posts/images/<slug>.jpg" or undefined
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
