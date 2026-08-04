/**
 * posts-md writer — turns ArticleRecord[] (see ../fetchers/types.mjs)
 * into Markdown files at public/posts/<slug>.md plus a manifest.json.
 *
 * Bilingual output (ADR-0005): a record that carries an English edition also
 * gets `public/posts/<slug>.en.md` — same slug, same metadata, English title /
 * abstract / body. The URL does not change; the reader picks the edition.
 *
 * The writer is intentionally fetcher-agnostic: it never imports from
 * `../fetchers/notion.mjs`. Anything that produces ArticleRecord[] can
 * feed it (DynamoDB / Postgres / a JSON dump for tests / …).
 *
 * Empty-body guard: refuses to publish records with zero non-whitespace
 * body. This is the third tier of the empty-content defence (see commit
 * 8c1fa10): even if upstream guards in `azureGenerateText` and
 * `handleAnalysisCreate` were bypassed (API shape change, manual Notion
 * draft, …), the live site stays clean.
 */

import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs'
import { join } from 'path'

/**
 * Resolve the actual image file for an article, if any exists.
 *
 * Image filenames have drifted across the codebase's history:
 *   - GAS handleL4Publish wrote `<32-char-no-dash-uuid>.jpg` keyed off
 *     the legacy L2/L3 page id
 *   - fetch-notion's slugFromId produces 12-char tails
 *   - A handful of legacy articles use kebab slugs
 *
 * We check the most likely candidates in order. If none exist, return
 * undefined so the writer omits the `image` field — the UI then falls
 * back to its placeholder set (see ArticleCard.tsx) instead of a broken
 * `<img>` tag.
 */
function resolveImagePath(record, postsDir) {
  const candidates = []
  if (record.slug) candidates.push(record.slug)
  if (record.legacySlug && !candidates.includes(record.legacySlug)) {
    candidates.push(record.legacySlug)
  }
  // Legacy notion id (set by migrate-to-unified-db.mjs on every migrated
  // row). GAS handleL4Publish wrote images keyed off the **32-char
  // no-dash form** of the original L2/L3 page id, so this is the most
  // reliable hit for analysis articles published before the unified-DB
  // rollout.
  if (record.legacyNotionId) {
    const noDash = record.legacyNotionId.replace(/-/g, '')
    if (!candidates.includes(noDash)) candidates.push(noDash)
  }
  // Fallback: the unified-DB page id itself. Only relevant for entries
  // that were created directly in the new DB (post Phase E).
  if (record.notionId) {
    const noDash = record.notionId.replace(/-/g, '')
    if (!candidates.includes(noDash)) candidates.push(noDash)
  }
  for (const cand of candidates) {
    if (existsSync(join(postsDir, 'images', `${cand}.jpg`))) {
      return `/posts/images/${cand}.jpg`
    }
  }
  return undefined
}

function esc(str) {
  return String(str ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
}

/**
 * Build the YAML frontmatter block for a single article.
 *
 * `lang` selects which edition's title/abstract go in. The English edition
 * (ADR-0005) is written to a sibling `<slug>.en.md` with identical metadata
 * apart from `title`/`abstract`/`lang`, so the reader can swap editions without
 * re-deriving anything: same slug, same tags, same date, same byline, one URL.
 */
function frontmatter(record, lang = 'ja') {
  const en = lang === 'en'
  const lines = [
    '---',
    `title: "${esc(en ? record.titleEn : record.title)}"`,
    `lang: "${en ? 'en' : 'ja'}"`,
    `type: "${record.type}"`,
    `category: "${esc(record.category)}"`,
    `date: "${esc(record.date)}"`,
    `abstract: "${esc(en ? record.abstractEn : record.abstract)}"`,
    `notionId: "${esc(record.notionId)}"`,
  ]
  if (record.imagePath) lines.push(`image: "${esc(record.imagePath)}"`)
  if (record.sourceUrls) lines.push(`sourceUrls: "${esc(record.sourceUrls)}"`)
  if (record.legacySlug) lines.push(`legacySlug: "${esc(record.legacySlug)}"`)
  if (record.author) lines.push(`author: "${esc(record.author)}"`)
  // Epic-017: Spotify deep-link → reader icon link (only emitted when set).
  if (record.spotifyUrl) lines.push(`spotifyUrl: "${esc(record.spotifyUrl)}"`)
  if (record.hasPodcast) lines.push(`hasPodcast: "${esc(record.hasPodcast)}"`)
  lines.push('---', '')
  return lines.join('\n')
}

/**
 * Write all records out to disk and return a write summary.
 *
 * @param {import('../fetchers/types.mjs').ArticleRecord[]} records
 * @param {Object} options
 * @param {string} options.postsDir            absolute path to public/posts/
 * @param {(...args: unknown[]) => void} [options.logger]
 * @returns {Promise<{ written: number; skipped: number }>}
 */
export async function writePosts(records, options) {
  const { postsDir, logger } = options
  if (!existsSync(postsDir)) {
    mkdirSync(postsDir, { recursive: true })
  }

  const manifest = []
  let skipped = 0
  let withImage = 0
  let withEn = 0

  for (const record of records) {
    if (!record.bodyMd || !record.bodyMd.trim()) {
      // See file-level docstring. We log but do NOT throw — a single bad
      // page should not abort the whole build.
      logger?.(
        `  ⚠  skipping empty page ${record.notionId} ("${record.title}") — body has no content`,
      )
      skipped += 1
      continue
    }

    // Resolve image path against what's actually on disk so missing
    // images are absent from the manifest (UI falls back to placeholder)
    // rather than producing 404s. The fetcher's `imagePath` is just the
    // canonical guess; the writer is the boundary that knows whether
    // the asset exists in the build context.
    const imagePath = resolveImagePath(record, postsDir)
    if (imagePath) withImage += 1

    const recordWithImage = { ...record, imagePath }
    const md = frontmatter(recordWithImage) + '\n' + record.bodyMd
    writeFileSync(join(postsDir, `${record.slug}.md`), md)

    // English edition (ADR-0005). Written only when the Notion row actually
    // carries one — an untranslated article stays Japanese-only and the reader
    // falls back rather than serving an empty English page (C-1). The same
    // empty-body guard as the Japanese edition applies: a blank EN child page
    // is treated as "no translation", not as a publishable article.
    const hasEn = Boolean(record.bodyEnMd && record.bodyEnMd.trim())
    if (hasEn) {
      writeFileSync(
        join(postsDir, `${record.slug}.en.md`),
        frontmatter(recordWithImage, 'en') + '\n' + record.bodyEnMd,
      )
      withEn += 1
    } else {
      // Notion is the source of truth (C-2): an edition deleted there must not
      // keep being served from a checked-in export. `posts/` is committed, so
      // the write-only path would leave a stale translation live forever.
      const stale = join(postsDir, `${record.slug}.en.md`)
      if (existsSync(stale)) {
        rmSync(stale)
        logger?.(`  🧹  removed stale English edition ${record.slug}.en.md (no EN page in Notion)`)
      }
    }

    /** Public manifest shape. Keep field names stable — the SPA reads them
     *  directly. New fields are *optional* on the consumer side. */
    manifest.push({
      slug: record.slug,
      title: record.title,
      type: record.type,
      category: record.category,
      tags: record.tags,
      date: record.date,
      abstract: record.abstract,
      // English edition (ADR-0005). `hasEn` is what the reader gates the
      // language toggle and the `<slug>.en.md` fetch on; the two localized
      // strings let the index, cards and search read English without fetching
      // every body.
      titleEn: hasEn ? record.titleEn : undefined,
      abstractEn: hasEn ? record.abstractEn : undefined,
      hasEn: hasEn || undefined,
      image: imagePath,
      sourceUrls: record.sourceUrls,
      author: record.author,
      spotifyUrl: record.spotifyUrl,
      hasPodcast: record.hasPodcast,
    })
  }

  manifest.sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  writeFileSync(
    join(postsDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  )

  logger?.(
    `\n✅  Done. ${manifest.length} articles written, ${skipped} skipped, ` +
      `${withImage} with image, ${withEn} with an English edition.`,
  )

  return { written: manifest.length, skipped, withImage, withEn }
}
