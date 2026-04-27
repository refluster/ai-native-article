#!/usr/bin/env node
/**
 * migrate-to-unified-db.mjs — copy L2 and/or L3 Notion pages into the
 * new unified "Articles" DB.
 *
 * Why a Node script (not GAS):
 *   - 6-min GAS timeout would clip large block trees on big rows.
 *   - Node has cleaner async/await semantics for the Notion API
 *     pagination + back-off pattern.
 *
 * Why we don't use Notion's native "duplicate" operation:
 *   - Notion has no public API to duplicate a page across DBs while
 *     preserving block ids. We therefore re-build the block tree:
 *     read children → strip read-only fields → POST to the new page.
 *
 * Slug preservation (the SEO-critical part):
 *   - For each old page we look up its currently-live slug in
 *     public/posts/<slug>.md (frontmatter `notionId` reverse index)
 *     and write that to the new page's `LegacySlug` property.
 *   - fetch-notion.mjs (post-migration) prefers `LegacySlug` over the
 *     new page id, so the public URL never changes.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-to-unified-db.mjs \
 *     --target-db=<UNIFIED_DB_ID> \
 *     --source=L3        # or L2, or both
 *     --dry-run          # log only, don't write
 *
 * Env: NOTION_API_KEY (required)
 *
 * Exit codes: 0 ok, 1 misconfig / Notion error.
 */

import { existsSync, readFileSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// ── Config ──────────────────────────────────────────────────────────────────

// Mirror the legacy DB ids hard-coded in gas/src/Code.gs so this script
// doesn't depend on env vars the GAS user hasn't set yet.
const LEGACY_L2_DB_ID = '32fd0f0be61e807a9cdee9cbb0c3729c'
const LEGACY_L3_DB_ID = '331d0f0be61e812e92bfc1ba92bcd1d9'

// Block types we cannot fully replicate via the API. We surface them in a
// summary at the end so the operator knows what content was lossy.
const UNSUPPORTED_BLOCK_TYPES = new Set([
  'equation',
  'synced_block',
  'child_database',
  'child_page',
  'breadcrumb',
  'table_of_contents',
  'link_preview',
  'embed', // sometimes copyable, but signed-URL embeds expire — be safe.
])

const NOTION_VERSION = '2022-06-28'

// Notion's published rate limit is ~3 RPS (averaged). We sleep between
// requests + apply exponential back-off on 429. The migration is a
// once-off so we err on the side of being polite.
const RATE_DELAY_MS = 350
const MAX_RETRIES = 6

// ── Args + env ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { dryRun: false, source: 'both', targetDb: '' }
  for (const arg of argv) {
    if (arg === '--dry-run') out.dryRun = true
    else if (arg.startsWith('--source=')) out.source = arg.slice('--source='.length)
    else if (arg.startsWith('--target-db=')) out.targetDb = arg.slice('--target-db='.length)
  }
  return out
}

function loadEnv() {
  const envPath = join(ROOT, '.env')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

loadEnv()

const ARGS = parseArgs(process.argv.slice(2))
const NOTION_API_KEY = process.env.NOTION_API_KEY
const TARGET_DB = ARGS.targetDb || process.env.UNIFIED_DB_ID

if (!NOTION_API_KEY) {
  console.error('❌  NOTION_API_KEY is not set.')
  process.exit(1)
}
if (!TARGET_DB && !ARGS.dryRun) {
  console.error('❌  --target-db=<id> (or UNIFIED_DB_ID env) is required for non-dry-run.')
  process.exit(1)
}
if (!['L2', 'L3', 'both'].includes(ARGS.source)) {
  console.error(`❌  --source must be one of: L2, L3, both. got '${ARGS.source}'.`)
  process.exit(1)
}

// ── HTTP helpers (rate-limited, with back-off) ─────────────────────────────

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function notionFetch(method, path, body) {
  const url = `https://api.notion.com/v1${path}`
  const init = {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
  }
  if (body) init.body = JSON.stringify(body)

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    await sleep(RATE_DELAY_MS)
    const res = await fetch(url, init)
    if (res.ok) {
      // 204 (no content) returns empty body
      if (res.status === 204) return {}
      return await res.json()
    }
    if (res.status === 429 || res.status >= 500) {
      // Exponential back-off with jitter. 1.5^attempt seconds, capped at 30s.
      const wait = Math.min(30000, 1500 * Math.pow(1.5, attempt) + Math.random() * 500)
      console.warn(`  ⚠  ${res.status} ${method} ${path} — retry in ${(wait / 1000).toFixed(1)}s`)
      await sleep(wait)
      continue
    }
    const text = await res.text()
    throw new Error(`${method} ${path} → ${res.status}: ${text}`)
  }
  throw new Error(`${method} ${path} → exhausted ${MAX_RETRIES} retries`)
}

// ── Slug reverse index from public/posts/*.md ──────────────────────────────

/**
 * Build a notionId → live-slug map by reading every public/posts/*.md.
 * frontmatter `notionId` is the join key. This is what gets written to
 * `LegacySlug` on the new page.
 */
function buildSlugIndex() {
  const dir = join(ROOT, 'public', 'posts')
  const map = new Map()
  if (!existsSync(dir)) return map
  for (const fn of readdirSync(dir)) {
    if (!fn.endsWith('.md')) continue
    const slug = fn.slice(0, -3)
    const path = join(dir, fn)
    const head = readFileSync(path, 'utf8').slice(0, 2000) // frontmatter is small
    const m = head.match(/notionId:\s*"?([^"\n]+)"?/)
    if (m) map.set(m[1].trim(), slug)
  }
  return map
}

// ── Block-tree copy ────────────────────────────────────────────────────────

const unsupportedSeen = new Map() // type → count

function recordUnsupported(type) {
  unsupportedSeen.set(type, (unsupportedSeen.get(type) || 0) + 1)
}

/**
 * Strip the read-only fields Notion rejects on POST/PATCH and return a
 * shape suitable for `children` payloads. Returns null if the block is
 * unsupported.
 */
function blockToCreateShape(block) {
  const type = block.type
  if (UNSUPPORTED_BLOCK_TYPES.has(type)) {
    recordUnsupported(type)
    return null
  }

  // Image blocks reference a Notion-signed URL that expires (1h). We
  // could re-host them but the L3 corpus is text-only, so for now we
  // pass `external` images through untouched and skip `file` images.
  if (type === 'image' && block.image?.type === 'file') {
    recordUnsupported('image:file')
    return null
  }

  const shape = { object: 'block', type, [type]: { ...block[type] } }
  // Strip read-only sub-fields if Notion echoed them back on GET.
  delete shape[type].id
  delete shape[type].created_time
  delete shape[type].last_edited_time
  delete shape[type].created_by
  delete shape[type].last_edited_by

  // Notion's GET response includes `icon: null` and `cover: null` on some
  // block types (notably paragraph). The PATCH /blocks/.../children
  // validator rejects those nulls with
  //   "body.children[N].<type>.icon should be an object or `undefined`,
  //    instead was `null`."
  // So strip any keys whose value is explicitly null. Keys with concrete
  // objects (e.g. `icon: { type: "emoji", … }`) pass through.
  for (const k of Object.keys(shape[type])) {
    if (shape[type][k] === null) delete shape[type][k]
  }

  return shape
}

async function fetchAllChildren(blockId) {
  const out = []
  let cursor
  do {
    const params = cursor ? `?start_cursor=${cursor}&page_size=100` : '?page_size=100'
    const res = await notionFetch('GET', `/blocks/${blockId}/children${params}`)
    out.push(...res.results)
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
  return out
}

/**
 * Append children to a parent in chunks of 100 (Notion's per-request cap).
 * Returns the API responses in order so the caller can recurse.
 */
async function appendChildren(parentId, blocks, dryRun) {
  if (blocks.length === 0) return []
  if (dryRun) {
    console.log(`  [dry-run] would append ${blocks.length} block(s) to ${parentId}`)
    // Fabricate stub ids so recursion can proceed in dry-run.
    return blocks.map(() => ({ id: 'dryrun-' + Math.random().toString(36).slice(2, 10) }))
  }
  const created = []
  for (let i = 0; i < blocks.length; i += 100) {
    const chunk = blocks.slice(i, i + 100)
    const res = await notionFetch('PATCH', `/blocks/${parentId}/children`, { children: chunk })
    created.push(...(res.results || []))
  }
  return created
}

/**
 * Recursively copy the block tree under `srcId` to live under `destId`.
 * Children of unsupported blocks are dropped; Notion's API doesn't let
 * us hoist them out of the discarded parent.
 */
async function copyBlockTree(srcId, destId, dryRun) {
  const children = await fetchAllChildren(srcId)
  // Build the create shapes; remember which ones had children so we can
  // recurse after the parents are minted (we need the new parent id).
  const shapes = []
  const sourceMap = [] // index → original block (or null for skipped)
  for (const child of children) {
    const shape = blockToCreateShape(child)
    if (!shape) {
      sourceMap.push(null)
      continue
    }
    shapes.push(shape)
    sourceMap.push(child)
  }
  const created = await appendChildren(destId, shapes, dryRun)

  // Now recurse for any block that originally had children. The shapes/
  // created arrays only include surviving blocks, but sourceMap tracks
  // skipped ones — walk created in lockstep with surviving shapes.
  let createdIdx = 0
  for (const original of sourceMap) {
    if (original === null) continue
    const newBlock = created[createdIdx]
    createdIdx += 1
    if (original.has_children && newBlock?.id) {
      await copyBlockTree(original.id, newBlock.id, dryRun)
    }
  }
}

// ── Property mapping (legacy → unified) ────────────────────────────────────

function plain(prop) {
  if (!prop) return ''
  switch (prop.type) {
    case 'title':     return (prop.title ?? []).map(t => t.plain_text).join('')
    case 'rich_text': return (prop.rich_text ?? []).map(t => t.plain_text).join('')
    case 'date':      return prop.date?.start ?? ''
    case 'url':       return prop.url ?? ''
    case 'select':    return prop.select?.name ?? ''
    case 'multi_select': return (prop.multi_select ?? []).map(o => o.name).join(', ')
    default: return ''
  }
}

function multi(prop) {
  if (!prop || prop.type !== 'multi_select') return []
  return (prop.multi_select ?? []).map(o => o.name)
}

/** Build the unified-DB properties object for a legacy page. */
function buildUnifiedProperties(page, kind, slugIndex) {
  const props = page.properties || {}

  const title =
    plain(props.Title) ||
    plain(props.Name)

  const abstract =
    plain(props.Abstract) ||
    plain(props['Contents Summary'])

  const category =
    plain(props.Category) ||
    plain(props['Sub Category'])

  const categoriesMulti = multi(props.CategoriesMulti).length
    ? multi(props.CategoriesMulti)
    : multi(props.Categories)

  const dateRaw =
    plain(props.Date) ||
    plain(props['Publication Date']) ||
    (page.created_time || '').split('T')[0]
  const date = dateRaw ? dateRaw.split('T')[0] : ''

  const sourceUrls =
    plain(props.SourceURLs) ||
    plain(props['Source Article URLs']) ||
    plain(props['Source URLs'])

  const legacySlug = slugIndex.get(page.id) || ''

  /** @type {Record<string, unknown>} */
  const out = {
    Title: { title: [{ text: { content: title || '(untitled)' } }] },
    Type: { select: { name: kind === 'L2' ? 'explanation' : 'analysis' } },
    Status: { select: { name: 'published' } },
    Date: date ? { date: { start: date } } : { date: null },
    Abstract: { rich_text: abstract ? [{ text: { content: abstract.slice(0, 2000) } }] : [] },
    Category: { rich_text: category ? [{ text: { content: category } }] : [] },
    SourceURLs: { rich_text: sourceUrls ? [{ text: { content: sourceUrls.slice(0, 2000) } }] : [] },
    LegacySlug: { rich_text: legacySlug ? [{ text: { content: legacySlug } }] : [] },
    LegacyDB: { select: { name: kind } },
  }
  if (categoriesMulti.length) {
    out.CategoriesMulti = { multi_select: categoriesMulti.map(name => ({ name })) }
  }
  return out
}

// ── Migration loop ─────────────────────────────────────────────────────────

async function queryAllPages(dbId) {
  const all = []
  let cursor
  do {
    const body = { page_size: 100 }
    if (cursor) body.start_cursor = cursor
    const res = await notionFetch('POST', `/databases/${dbId}/query`, body)
    all.push(...res.results)
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
  return all
}

/**
 * Has this legacy page already been migrated? We mark migrated rows in
 * the unified DB by setting LegacyDB+notionId; we look up that pair to
 * detect re-runs.
 *
 * NOTE: this requires a `LegacyNotionId` rich_text property on the
 * unified DB. If the operator hasn't created it, the script falls back
 * to "always re-migrate" mode (still safe because Notion doesn't reject
 * duplicate creates by default — but it'll create duplicates, so add
 * the property).
 */
async function alreadyMigrated(unifiedDbId, legacyPageId) {
  if (!unifiedDbId) return false
  try {
    const res = await notionFetch('POST', `/databases/${unifiedDbId}/query`, {
      page_size: 1,
      filter: {
        property: 'LegacyNotionId',
        rich_text: { equals: legacyPageId },
      },
    })
    return (res.results || []).length > 0
  } catch (e) {
    // Property missing → bail out of dedup (operator's responsibility).
    return false
  }
}

async function migratePage(page, kind, slugIndex) {
  const title = plain(page.properties.Title) || plain(page.properties.Name) || page.id
  console.log(`→  [${kind}] ${title}`)

  if (await alreadyMigrated(TARGET_DB, page.id)) {
    console.log(`   already migrated, skip`)
    return { skipped: true }
  }

  const properties = buildUnifiedProperties(page, kind, slugIndex)
  // Stash the legacy page id in a property so re-runs can dedup. The
  // property name is conventional; create it as rich_text in the unified DB.
  properties.LegacyNotionId = {
    rich_text: [{ text: { content: page.id } }],
  }

  if (ARGS.dryRun) {
    console.log(`   [dry-run] would create page in ${TARGET_DB}`)
    await copyBlockTree(page.id, 'dryrun-parent', true)
    return { created: false }
  }

  const created = await notionFetch('POST', '/pages', {
    parent: { database_id: TARGET_DB },
    properties,
  })
  await copyBlockTree(page.id, created.id, false)
  return { created: true, newId: created.id }
}

async function migrateDb(dbId, kind, slugIndex) {
  console.log(`\n📥  Reading ${kind} DB ${dbId} …`)
  const pages = await queryAllPages(dbId)
  console.log(`   ${pages.length} page(s)`)
  let created = 0
  let skipped = 0
  const errors = []
  for (const page of pages) {
    try {
      const r = await migratePage(page, kind, slugIndex)
      if (r.created) created += 1
      else skipped += 1
    } catch (e) {
      console.error(`   ✗  ${page.id}: ${e.message}`)
      errors.push({ id: page.id, error: e.message })
    }
  }
  return { kind, total: pages.length, created, skipped, errors }
}

// ── Main ────────────────────────────────────────────────────────────────────

console.log(`Migrate to unified DB`)
console.log(`  target:    ${TARGET_DB || '(dry-run, no target)'}`)
console.log(`  source:    ${ARGS.source}`)
console.log(`  dry-run:   ${ARGS.dryRun}`)
console.log()

const slugIndex = buildSlugIndex()
console.log(`📑  Slug index: ${slugIndex.size} notionId → slug mapping(s) loaded from public/posts/`)

const summaries = []
if (ARGS.source === 'L3' || ARGS.source === 'both') {
  summaries.push(await migrateDb(LEGACY_L3_DB_ID, 'L3', slugIndex))
}
if (ARGS.source === 'L2' || ARGS.source === 'both') {
  summaries.push(await migrateDb(LEGACY_L2_DB_ID, 'L2', slugIndex))
}

console.log('\n────────────────────────────────────────')
for (const s of summaries) {
  console.log(`  ${s.kind}: total=${s.total} created=${s.created} skipped=${s.skipped} errors=${s.errors.length}`)
  for (const e of s.errors) console.log(`    ✗  ${e.id}: ${e.error}`)
}
if (unsupportedSeen.size) {
  console.log('\n  Unsupported blocks (skipped, content lossy):')
  for (const [type, count] of unsupportedSeen) {
    console.log(`    ${type}: ${count}`)
  }
}
console.log('Done.')
