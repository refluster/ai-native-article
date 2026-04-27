/**
 * Notion fetcher — pulls articles from a Notion database and returns
 * a normalised ArticleRecord[] (see ./types.mjs).
 *
 * This module knows about Notion's wire shape and nothing else. Writers
 * never see Notion-specific structures.
 *
 * Bridge mode (Phase B in the rollout plan): when `bridgeMode=true`,
 * the fetcher reads from the unified DB AND a legacy DB and merges the
 * results. This lets us cut over to the unified DB without breaking
 * existing slug/URL coverage even if the migration script missed a row.
 * Disable bridge mode (Phase E) once parity is confirmed.
 */

const NOTION_VERSION = '2022-06-28'

/**
 * Build authorization headers. Kept as a factory so we can swap the
 * api key per-request if we ever need scoped fetches.
 */
function authHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  }
}

async function notionGet(path, apiKey) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    headers: authHeaders(apiKey),
  })
  if (!res.ok) {
    throw new Error(`Notion GET ${path} → ${res.status}: ${await res.text()}`)
  }
  return res.json()
}

async function notionPost(path, apiKey, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`Notion POST ${path} → ${res.status}: ${await res.text()}`)
  }
  return res.json()
}

/** Notion rich_text array → Markdown string (preserves bold/italic/code/links). */
function richTextToMd(richText) {
  return (richText ?? [])
    .map(t => {
      let text = t.plain_text
      if (!text) return ''
      if (t.annotations?.code) text = `\`${text}\``
      if (t.annotations?.bold) text = `**${text}**`
      if (t.annotations?.italic) text = `*${text}*`
      if (t.annotations?.strikethrough) text = `~~${text}~~`
      if (t.href) text = `[${text}](${t.href})`
      return text
    })
    .join('')
}

/** Recursively fetch all child blocks (handles pagination). */
async function fetchAllBlocks(blockId, apiKey) {
  const blocks = []
  let cursor
  do {
    const params = cursor ? `?start_cursor=${cursor}` : ''
    const data = await notionGet(`/blocks/${blockId}/children${params}`, apiKey)
    blocks.push(...data.results)
    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor)
  return blocks
}

/** Convert a Notion block tree (rooted at pageId) to Markdown. */
async function blocksToMd(pageId, apiKey, depth = 0) {
  const blocks = await fetchAllBlocks(pageId, apiKey)
  const indent = '  '.repeat(depth)
  const lines = []

  for (const block of blocks) {
    const type = block.type
    const b = block[type]
    switch (type) {
      case 'paragraph': {
        const text = richTextToMd(b.rich_text)
        lines.push(text ? `${text}\n` : '')
        break
      }
      case 'heading_1':
        lines.push(`# ${richTextToMd(b.rich_text)}\n`)
        break
      case 'heading_2':
        lines.push(`## ${richTextToMd(b.rich_text)}\n`)
        break
      case 'heading_3':
        lines.push(`### ${richTextToMd(b.rich_text)}\n`)
        break
      case 'bulleted_list_item': {
        lines.push(`${indent}- ${richTextToMd(b.rich_text)}`)
        if (block.has_children) {
          lines.push(await blocksToMd(block.id, apiKey, depth + 1))
        }
        break
      }
      case 'numbered_list_item': {
        lines.push(`${indent}1. ${richTextToMd(b.rich_text)}`)
        if (block.has_children) {
          lines.push(await blocksToMd(block.id, apiKey, depth + 1))
        }
        break
      }
      case 'quote':
      case 'callout':
        lines.push(`> ${richTextToMd(b.rich_text)}\n`)
        break
      case 'code': {
        const lang = b.language && b.language !== 'plain text' ? b.language : ''
        lines.push(`\`\`\`${lang}\n${richTextToMd(b.rich_text)}\n\`\`\`\n`)
        break
      }
      case 'divider':
        lines.push('---\n')
        break
      case 'to_do': {
        const checked = b.checked ? 'x' : ' '
        lines.push(`${indent}- [${checked}] ${richTextToMd(b.rich_text)}`)
        break
      }
      case 'toggle': {
        lines.push(`**${richTextToMd(b.rich_text)}**\n`)
        if (block.has_children) {
          lines.push(await blocksToMd(block.id, apiKey, depth))
        }
        break
      }
      case 'image': {
        const src = b.type === 'external' ? b.external?.url : b.file?.url
        const caption = richTextToMd(b.caption)
        if (src) lines.push(`![${caption || ''}](${src})\n`)
        break
      }
      case 'table': {
        if (block.has_children) {
          const rows = await fetchAllBlocks(block.id, apiKey)
          rows.forEach((row, i) => {
            const cells = row.table_row?.cells ?? []
            lines.push('| ' + cells.map(c => richTextToMd(c)).join(' | ') + ' |')
            if (i === 0) {
              lines.push('| ' + cells.map(() => '---').join(' | ') + ' |')
            }
          })
          lines.push('')
        }
        break
      }
      default:
        // Silently skip unsupported block types.
        break
    }
  }

  return lines.join('\n')
}

/** Extract plain text from any Notion property type we care about. */
function propText(prop) {
  if (!prop) return ''
  switch (prop.type) {
    case 'title':
      return (prop.title ?? []).map(t => t.plain_text).join('')
    case 'rich_text':
      return (prop.rich_text ?? []).map(t => t.plain_text).join('')
    case 'date':
      return prop.date?.start ?? ''
    case 'url':
      return prop.url ?? ''
    case 'select':
      return prop.select?.name ?? ''
    case 'multi_select':
      // For multi_select, return the FIRST tag (used for legacy `Category`
      // single-string fallback). Use propMultiSelect for the full list.
      return (prop.multi_select ?? []).map(o => o.name).join(', ')
    default:
      return ''
  }
}

function propMultiSelect(prop) {
  if (!prop || prop.type !== 'multi_select') return []
  return (prop.multi_select ?? []).map(o => o.name)
}

/** Stable 12-char slug from a Notion page id. Last 12 chars of stripped UUID. */
export function slugFromId(id) {
  return id.replace(/-/g, '').slice(-12)
}

/** Normalise the `Type` property to our internal enum. Defaults to 'analysis'
 *  for legacy rows that have no `Type` (the original L3 DB). */
function resolveType(props, legacyHint) {
  const raw = (propText(props.Type) || '').trim().toLowerCase()
  if (raw === 'explanation') return 'explanation'
  if (raw === 'analysis') return 'analysis'
  // Legacy fallback. legacyHint is set by the bridge-mode caller when it
  // knows which DB the page came from.
  if (legacyHint === 'explanation') return 'explanation'
  return 'analysis'
}

/** Page → ArticleRecord. */
async function pageToRecord(page, apiKey, legacyHint) {
  const props = page.properties || {}
  const title =
    propText(props.Title) || propText(props.Name) // L2 used `Name`
  const abstract =
    propText(props.Abstract) || propText(props['Contents Summary'])
  const category =
    propText(props.Category) || propText(props['Sub Category'])
  const categoriesMulti = propMultiSelect(props.CategoriesMulti).length
    ? propMultiSelect(props.CategoriesMulti)
    : propMultiSelect(props.Categories)
  // Date with sensible fallbacks: dedicated `Date` → legacy
  // `Publication Date` → Notion's own created_time. The created_time
  // fallback prevents undated rows from sinking to the bottom of the
  // home-page sort (see fix in commit 6b1f… for the original bug).
  const dateRaw =
    propText(props.Date) ||
    propText(props['Publication Date']) ||
    page.created_time ||
    ''
  const date = dateRaw.split('T')[0]
  const sourceUrls =
    propText(props.SourceURLs) ||
    propText(props['Source Article URLs']) ||
    propText(props['Source URLs'])
  const legacySlug = propText(props.LegacySlug)
  const type = resolveType(props, legacyHint)

  const bodyMd = await blocksToMd(page.id, apiKey)
  const slug = legacySlug || slugFromId(page.id)

  return {
    slug,
    title,
    type,
    category,
    categoriesMulti,
    date,
    abstract,
    bodyMd,
    sourceUrls,
    legacySlug,
    notionId: page.id,
    lastEditedAt: page.last_edited_time || '',
    imagePath: `/posts/images/${slug}.jpg`,
  }
}

/** Query a single Notion DB → ArticleRecord[]. */
async function queryDb(dbId, apiKey, legacyHint, logger) {
  const records = []
  let cursor
  do {
    const body = { page_size: 100 }
    if (cursor) body.start_cursor = cursor
    const data = await notionPost(`/databases/${dbId}/query`, apiKey, body)
    for (const page of data.results) {
      const title =
        propText(page.properties.Title) || propText(page.properties.Name)
      logger?.(`  ↳  [${legacyHint || 'unified'}] ${title || page.id}`)
      records.push(await pageToRecord(page, apiKey, legacyHint))
    }
    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor)
  return records
}

/**
 * Public entry point.
 *
 * @param {import('./types.mjs').FetcherOptions} options
 * @returns {Promise<import('./types.mjs').ArticleRecord[]>}
 */
export async function fetchArticles(options) {
  const { apiKey, dbId, bridgeMode, legacyDbId, logger } = options
  if (!apiKey) throw new Error('fetchArticles: apiKey is required')
  if (!dbId) throw new Error('fetchArticles: dbId is required')

  const out = await queryDb(dbId, apiKey, undefined, logger)

  if (bridgeMode && legacyDbId && legacyDbId !== dbId) {
    logger?.(`🔁  bridge mode: also reading legacy DB ${legacyDbId}`)
    // The legacy DB at `legacyDbId` is L3 by convention (analysis). If we
    // ever need to bridge L2 too, add a second legacyDbId option and call
    // queryDb with hint='explanation'.
    const legacy = await queryDb(legacyDbId, apiKey, 'analysis', logger)

    // Deduplicate: prefer unified-DB records over legacy when slugs collide
    // (i.e. the unified-DB row is the canonical source post-migration).
    const seenSlugs = new Set(out.map(r => r.slug))
    for (const rec of legacy) {
      if (!seenSlugs.has(rec.slug)) {
        out.push(rec)
        seenSlugs.add(rec.slug)
      }
    }
  }

  return out
}
