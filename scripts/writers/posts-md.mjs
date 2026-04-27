/**
 * posts-md writer — turns ArticleRecord[] (see ../fetchers/types.mjs)
 * into Markdown files at public/posts/<slug>.md plus a manifest.json.
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

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

function esc(str) {
  return String(str ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
}

/** Build the YAML frontmatter block for a single article. */
function frontmatter(record) {
  const lines = [
    '---',
    `title: "${esc(record.title)}"`,
    `type: "${record.type}"`,
    `category: "${esc(record.category)}"`,
    `date: "${esc(record.date)}"`,
    `abstract: "${esc(record.abstract)}"`,
    `notionId: "${esc(record.notionId)}"`,
  ]
  if (record.imagePath) lines.push(`image: "${esc(record.imagePath)}"`)
  if (record.sourceUrls) lines.push(`sourceUrls: "${esc(record.sourceUrls)}"`)
  if (record.legacySlug) lines.push(`legacySlug: "${esc(record.legacySlug)}"`)
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

    const md = frontmatter(record) + '\n' + record.bodyMd
    writeFileSync(join(postsDir, `${record.slug}.md`), md)

    /** Public manifest shape. Keep field names stable — the SPA reads them
     *  directly. New fields are *optional* on the consumer side. */
    manifest.push({
      slug: record.slug,
      title: record.title,
      type: record.type,
      category: record.category,
      categoriesMulti: record.categoriesMulti,
      date: record.date,
      abstract: record.abstract,
      image: record.imagePath,
      sourceUrls: record.sourceUrls,
    })
  }

  manifest.sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  writeFileSync(
    join(postsDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  )

  logger?.(
    `\n✅  Done. ${manifest.length} articles written, ${skipped} skipped.`,
  )

  return { written: manifest.length, skipped }
}
