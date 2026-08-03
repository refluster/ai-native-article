#!/usr/bin/env node
/**
 * normalize-categories.mjs — corpus backfill: re-tag every row of the unified
 * Articles DB onto the flat tag vocabulary (ADR-0003), replacing the retired
 * A–E lettered buckets + free-form `× theme`.
 *
 * The generation cadences now emit flat vocabulary tags (#412/#413); this is
 * the one-shot re-tag of the *existing* corpus so old rows match. For each row
 * it derives tags with the deterministic keyword classifier in the single
 * source of truth (`scripts/lib/tags.mjs#classifyTags`) over the row's
 * title + abstract + existing Category text, and writes:
 *
 *   Tags     (multi_select) = up to 5 vocabulary tags (many-to-many)
 *   Category (rich_text)    = the primary tag (tags[0])
 *
 * Keyword classification is best-effort (operator chose the immediate keyword
 * path over an LLM pass). Rows that match no keyword are left UNTOUCHED and
 * logged for manual review — we never overwrite an existing tag set with an
 * empty one.
 *
 * Idempotent: a row whose Tags already equals the desired set AND whose
 * Category already equals tags[0] is skipped. Run --dry-run to preview.
 *
 * Usage:
 *   node --env-file=.env newsletter/pipeline/normalize-categories.mjs --dry-run
 *   node --env-file=.env newsletter/pipeline/normalize-categories.mjs
 */

import { ensureProxyAwareEntry } from "../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { classifyTags } from '../../scripts/lib/tags.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')

// .env loader (mirrors fetch-notion.mjs convention)
const envPath = join(ROOT, '.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

const NOTION_API_KEY = process.env.NOTION_API_KEY
const UNIFIED_DB_ID =
  process.env.UNIFIED_DB_ID || '34fd0f0b-e61e-817a-9f6b-dc65b0d5b4cc'
const NOTION_VERSION = '2022-06-28'
const DRY_RUN = process.argv.includes('--dry-run')

if (!NOTION_API_KEY) {
  console.error('❌ NOTION_API_KEY missing (set in .env or environment).')
  process.exit(1)
}

// ── Tagging ────────────────────────────────────────────────────────────────

/**
 * Compute the desired vocabulary tag list for a row from its text.
 * @returns {{ tags: string[], reason: string }}
 */
function computeTags(props) {
  const title = readRichText(props.Title)
  const abstract = readRichText(props.Abstract)
  const category = readRichText(props.Category)
  const text = [title, abstract, category].filter(Boolean).join(' ')

  const tags = classifyTags(text)
  if (tags.length === 0) {
    return { tags, reason: `unclassified('${category || title}')` }
  }
  return { tags, reason: `keyword(${tags.length}: ${tags.join(', ')})` }
}

function readRichText(prop) {
  if (!prop) return ''
  if (prop.type === 'rich_text') {
    return (prop.rich_text ?? []).map(t => t.plain_text).join('').trim()
  }
  if (prop.type === 'title') {
    return (prop.title ?? []).map(t => t.plain_text).join('').trim()
  }
  return ''
}

function readMultiSelect(prop) {
  if (!prop || prop.type !== 'multi_select') return []
  return (prop.multi_select ?? []).map(o => o.name)
}

// ── Notion API ─────────────────────────────────────────────────────────────

const headers = {
  Authorization: `Bearer ${NOTION_API_KEY}`,
  'Notion-Version': NOTION_VERSION,
  'Content-Type': 'application/json',
}

async function notionFetch(method, path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    throw new Error(`Notion ${method} ${path} → ${res.status}: ${await res.text()}`)
  }
  return res.json()
}

async function queryAll(dbId) {
  const out = []
  let cursor
  do {
    const body = { page_size: 100 }
    if (cursor) body.start_cursor = cursor
    const data = await notionFetch('POST', `/databases/${dbId}/query`, body)
    out.push(...data.results)
    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor)
  return out
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`🏷️   Backfill flat vocabulary tags on unified DB ${UNIFIED_DB_ID}`)
  console.log(`    dry-run: ${DRY_RUN}`)
  const pages = await queryAll(UNIFIED_DB_ID)
  console.log(`    rows:    ${pages.length}\n`)

  let unchanged = 0
  let updated = 0
  let unclassified = 0
  const unclassifiedExamples = []

  for (const page of pages) {
    const props = page.properties || {}
    const title = readRichText(props.Title) || page.id
    const currentTags = readMultiSelect(props.Tags).length
      ? readMultiSelect(props.Tags)
      : readMultiSelect(props.CategoriesMulti)
    const currentCategory = readRichText(props.Category)
    const { tags: desiredTags, reason } = computeTags(props)

    // No keyword match → leave the row untouched (never clobber existing tags
    // with an empty set); log for manual review.
    if (desiredTags.length === 0) {
      unclassified += 1
      unclassifiedExamples.push({ title, reason })
      continue
    }

    const sameSet =
      currentTags.length === desiredTags.length &&
      currentTags.every(t => desiredTags.includes(t))
    const sameCategory = currentCategory === desiredTags[0]

    if (sameSet && sameCategory) {
      unchanged += 1
      continue
    }

    console.log(`→  ${title}`)
    console.log(`     before: [${currentTags.join(', ')}]  Category="${currentCategory}"`)
    console.log(`     after:  [${desiredTags.join(', ')}]  Category="${desiredTags[0]}"`)
    console.log(`     reason: ${reason}`)

    if (!DRY_RUN) {
      await notionFetch('PATCH', `/pages/${page.id}`, {
        properties: {
          Tags: {
            multi_select: desiredTags.map(name => ({ name })),
          },
          Category: {
            rich_text: [{ text: { content: desiredTags[0] } }],
          },
        },
      })
      updated += 1
    }
  }

  console.log('\n────────────────────────────────────────')
  console.log(`  unchanged:    ${unchanged}`)
  console.log(`  updated:      ${updated}${DRY_RUN ? ' (dry-run, nothing written)' : ''}`)
  console.log(`  unclassified: ${unclassified}`)
  if (unclassified > 0) {
    console.log('\n  Unclassified rows (no keyword matched — left untouched):')
    for (const u of unclassifiedExamples) {
      console.log(`    - ${u.title}  [${u.reason}]`)
    }
    console.log(
      '\n  Add a keyword pattern to scripts/lib/tags.mjs TAG_PATTERNS, or set the' +
        ' tags by hand in Notion, then re-run.',
    )
  }
}

main().catch(err => {
  console.error('❌ ', err.message)
  process.exit(1)
})
