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

import "../../../scripts/lib/proxy-bootstrap.mjs";

const NOTION_VERSION = '2022-06-28'

// Notion's documented rate limit is ~3 req/sec per integration. With a
// 129-article unified DB and recursive block fetches, a single
// `fetch-notion` run easily exceeds that and starts collecting 429s
// (see deploy-article-site run 26482870909). These constants govern the
// retry/throttle behaviour applied uniformly to every Notion request.
const MAX_RETRIES = 4 // 4 retries = up to 5 attempts total per request
const BACKOFF_BASE_MS = 1000 // 1s, 2s, 4s, 8s for exponential backoff
const DEFAULT_THROTTLE_MS = 350 // ~333ms ≈ 3 req/sec ceiling; round up a touch
const THROTTLE_MS = (() => {
  const raw = process.env.NOTION_THROTTLE_MS
  if (raw === undefined) return DEFAULT_THROTTLE_MS
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_THROTTLE_MS
})()

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

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

/**
 * Wrap a single Notion HTTP call with retry/backoff.
 *
 * Retry policy:
 *   - 429: honour `Retry-After` header (Notion sends seconds) when present;
 *     otherwise fall back to exponential backoff.
 *   - 5xx: exponential backoff, same MAX_RETRIES budget.
 *   - other 4xx / non-OK: throw immediately (caller-fault; retry won't help).
 *
 * Per-request throttle (NOTION_THROTTLE_MS, default 350ms) is applied
 * *before* every attempt — both first attempts and retries — so a burst of
 * sequential calls naturally stays under the 3 req/sec ceiling.
 */
async function notionFetch(method, path, apiKey, body) {
  const url = `https://api.notion.com/v1${path}`
  const init = { method, headers: authHeaders(apiKey) }
  if (body !== undefined) init.body = JSON.stringify(body)

  let attempt = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (THROTTLE_MS > 0) await sleep(THROTTLE_MS)
    const res = await fetch(url, init)
    if (res.ok) return res.json()

    const isRateLimited = res.status === 429
    const isServerError = res.status >= 500 && res.status < 600
    const retryable = isRateLimited || isServerError

    if (!retryable || attempt >= MAX_RETRIES) {
      throw new Error(
        `Notion ${method} ${path} → ${res.status}: ${await res.text()}`,
      )
    }

    let waitMs
    if (isRateLimited) {
      const retryAfterRaw = res.headers.get('retry-after')
      const retryAfterSec = retryAfterRaw ? Number(retryAfterRaw) : NaN
      waitMs = Number.isFinite(retryAfterSec) && retryAfterSec >= 0
        ? retryAfterSec * 1000
        : BACKOFF_BASE_MS * 2 ** attempt
    } else {
      waitMs = BACKOFF_BASE_MS * 2 ** attempt
    }
    // Drain the body so the connection can be reused.
    await res.text().catch(() => {})
    console.log(
      `⏳  Notion ${method} ${path} → ${res.status}; retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
    )
    await sleep(waitMs)
    attempt += 1
  }
}

async function notionGet(path, apiKey) {
  return notionFetch('GET', path, apiKey)
}

async function notionPost(path, apiKey, body) {
  return notionFetch('POST', path, apiKey, body)
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
    case 'status':
      return prop.status?.name ?? ''
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

/**
 * Canonical 5-bucket taxonomy used when categorising L1 sources.
 * The category prompt asks for a single letter A–E meant to map onto these
 * labels — but the model has been free-form enough to also produce things
 * like bare "B", "B: TRENDS", "A: MACROHARD"
 * which all leaked downstream and exploded the sidebar into ~30 buckets.
 *
 * normalizeCategory collapses every variant of letter X (or "X: anything")
 * back to its canonical label. Free-form Japanese strings (the L3 analysis
 * "テーマ × テーマ" form) pass through untouched.
 */
const CATEGORY_CANONICAL = {
  A: 'A: AI Hyper-productivity',
  B: 'B: Role Blurring',
  C: 'C: New Roles / FDE',
  D: 'D: Big Tech Layoffs & AI Pivot',
  E: 'E: Rethinking SDLC',
}

function normalizeCategory(raw) {
  if (!raw) return ''
  const trimmed = String(raw).trim()
  // Bare letter "A" / "B" / … (case-insensitive)
  if (/^[A-E]$/i.test(trimmed)) {
    return CATEGORY_CANONICAL[trimmed.toUpperCase()]
  }
  // "X: anything" / "X：anything" — full-width or half-width colon.
  // Discard the variant descriptor and force the canonical label so
  // "B: Trends" / "B: ROLE BLURRING" / "B: Role Blurring" all merge.
  const m = trimmed.match(/^([A-E])\s*[:：]\s*.+$/i)
  if (m) {
    return CATEGORY_CANONICAL[m[1].toUpperCase()]
  }
  // Anything else (e.g. "業務基盤進化 × 労働市場変容") is a legitimate
  // free-form theme — keep as-is.
  return trimmed
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
  const category = normalizeCategory(
    propText(props.Category) || propText(props['Sub Category']),
  )
  // `Tags` is the multi-select tag column (renamed from `CategoriesMulti`).
  // Read the new name first; fall back to the old names so a fetch that runs
  // before the Notion property rename (or against an un-migrated row) still
  // populates tags.
  const tags = propMultiSelect(props.Tags).length
    ? propMultiSelect(props.Tags)
    : propMultiSelect(props.CategoriesMulti).length
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
  // Migrated rows carry the original L2/L3 page id in `LegacyNotionId`.
  // The writer needs this to resolve cover images written by the former GAS
  // L4 pipeline using the <32-char-no-dash-uuid>.jpg naming convention —
  // those filenames are derived from the legacy id, not the new unified-DB id.
  const legacyNotionId = propText(props.LegacyNotionId)
  const type = resolveType(props, legacyHint)
  // Epic-002 / Epic-005: agent-authored articles carry an Author select
  // property whose value is the persona slug ("sora", "maya", …). Pre-
  // workforce rows have no Author property and resolve to undefined,
  // which the front-end renders as a quiet placeholder (anonymous).
  const author = propText(props.Author) || undefined
  // Epic-017: the Spotify deep-link the operator records back to Notion once
  // an episode is published. Flows to the reader as a Spotify icon link via
  // this fetch-notion sync — the only sync route. Property name is the canonical
  // `spotifyUrl` (Story 4 schema, ADR-0016); PascalCase kept as a tolerant
  // fallback. `hasPodcast` is derived from `podcastStatus` so the reader can
  // know an episode exists even before the Spotify URL is captured.
  const spotifyUrl =
    propText(props.spotifyUrl) || propText(props.SpotifyUrl) || undefined
  const podcastStatus = propText(props.podcastStatus) || ''
  const hasPodcast =
    podcastStatus && podcastStatus !== 'none' ? 'true' : undefined

  const bodyMd = await blocksToMd(page.id, apiKey)
  const slug = legacySlug || slugFromId(page.id)

  return {
    slug,
    title,
    type,
    category,
    tags,
    date,
    abstract,
    bodyMd,
    sourceUrls,
    legacySlug,
    legacyNotionId,
    notionId: page.id,
    lastEditedAt: page.last_edited_time || '',
    imagePath: `/posts/images/${slug}.jpg`,
    author,
    spotifyUrl,
    hasPodcast,
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
