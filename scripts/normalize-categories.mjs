#!/usr/bin/env node
/**
 * normalize-categories.mjs — one-shot sweep that fixes `CategoriesMulti`
 * on every row of the unified Articles DB.
 *
 * After the L2/L3 → unified DB migration, `Category` (rich_text) ended up
 * carrying a sprawl of values: bare letters ("A", "B"), letter-prefixed
 * variants ("B: TRENDS", "A: MACROHARD"), and free-form Japanese themes
 * from L3 analyses ("業務基盤進化 × 労働市場変容"). The sidebar grouped on
 * that field directly, so it exploded into ~30 buckets of mostly 1.
 *
 * This script consolidates by populating `CategoriesMulti` (multi_select)
 * with a controlled-vocabulary canonical bucket plus, for analyses, the
 * original × theme as a sub-tag:
 *
 *   Type=explanation  → CategoriesMulti = [canonical A-E]
 *   Type=analysis     → CategoriesMulti = [canonical A-E, × theme]
 *
 * Canonical bucket is derived from `Category`:
 *   1. `^[A-E]$` or `^[A-E][:：]…$`  → trivial canonical mapping
 *   2. Free-form text                → keyword classifier (heuristic;
 *      logs unclassifiable strings for manual review)
 *
 * Idempotent: rows that already have the right CategoriesMulti are
 * skipped. Run with --dry-run to see the plan; without flags it writes.
 *
 * Usage:
 *   node --env-file=.env scripts/normalize-categories.mjs --dry-run
 *   node --env-file=.env scripts/normalize-categories.mjs
 */

import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

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

// ── Canonical taxonomy ─────────────────────────────────────────────────────

const CATEGORY_CANONICAL = {
  A: 'A: AI Hyper-productivity',
  B: 'B: Role Blurring',
  C: 'C: New Roles / FDE',
  D: 'D: Big Tech Layoffs & AI Pivot',
  E: 'E: Rethinking SDLC',
}

/**
 * Map a free-form Category string to a single canonical letter A–E
 * using keyword heuristics. Order matters — more specific patterns
 * are checked first so e.g. "SDLC RETHINKING" lands in E rather than
 * being captured by a generic "rethinking" rule.
 *
 * Returns null when nothing matches; callers may then default or skip.
 */
function classifyByKeywords(text) {
  if (!text) return null
  if (/^\s*test/i.test(text)) return null // junk
  const s = text.toLowerCase()

  // E: SDLC / engineering process
  if (
    /sdlc|rethinking sdlc|development process|architecture|best practice|coding|エンジニアリング|プロセス|開発手法/.test(
      s,
    )
  ) {
    return 'E'
  }
  // D: Org / market / Big Tech transformation
  if (
    /labor market|future of work|big tech|layoff|ai pivot|replacement|org transformation|organizational|strategy|労働市場|未来の働き方|レイオフ|組織変革|組織設計|組織文化|戦略/.test(
      s,
    )
  ) {
    return 'D'
  }
  // C: FDE / new roles
  if (/fde|forward.deployed|new role|新しい役割/.test(s)) return 'C'
  // B: Role / skills / education / blurring
  if (
    /role blurring|role transformation|title|professional skill|engineer|designer|education|learning|教育|学習|デザイン|エンジニア|職業|職種|肩書|スキル/.test(
      s,
    )
  ) {
    return 'B'
  }
  // A: Productivity / agentic / industrial AI
  if (
    /hyper.productivity|ai productivity|agentic|agent|macrohard|tesla|xai|data center|manufacturing|automation|industrial|robot|エージェント|データセンター|製造|自動化|産業|ロボット/.test(
      s,
    )
  ) {
    return 'A'
  }
  return null
}

/** Treat "A" / "A: anything" / "A：anything" as canonical A. */
function canonicalFromLetterForm(text) {
  if (!text) return null
  const trimmed = String(text).trim()
  if (/^[A-E]$/i.test(trimmed)) {
    return CATEGORY_CANONICAL[trimmed.toUpperCase()]
  }
  const m = trimmed.match(/^([A-E])\s*[:：]\s*.+$/i)
  if (m) return CATEGORY_CANONICAL[m[1].toUpperCase()]
  return null
}

/**
 * Compute the CategoriesMulti tag list for a row, given current props.
 * @returns {{ tags: string[], reason: string }}
 */
function computeTags(props) {
  const category = readRichText(props.Category)
  const type = props.Type?.select?.name || 'analysis'

  const tags = []
  let reason = ''

  // 1. Canonical bucket
  let canonical = canonicalFromLetterForm(category)
  if (canonical) {
    reason = `letter-form('${category}')`
  } else if (category) {
    const letter = classifyByKeywords(category)
    if (letter) {
      canonical = CATEGORY_CANONICAL[letter]
      reason = `keyword('${category}' → ${letter})`
    } else {
      reason = `unclassified('${category}')`
    }
  } else {
    reason = 'no Category property'
  }
  if (canonical) tags.push(canonical)

  // 2. Analysis sub-tag — keep the × theme as a separate tag for the
  //    sidebar's deeper-themes section. Skip when the Category was a
  //    letter form (the × theme is what we already collapsed away).
  const looksLikeTheme = category && !canonicalFromLetterForm(category)
  if (type === 'analysis' && looksLikeTheme) {
    if (!tags.includes(category)) tags.push(category)
    reason += ` + theme('${category}')`
  }

  return { tags, reason }
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
  console.log(`📚  Normalize CategoriesMulti on unified DB ${UNIFIED_DB_ID}`)
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
    const currentTags = readMultiSelect(props.CategoriesMulti)
    const { tags: desiredTags, reason } = computeTags(props)

    // Treat "no canonical found" as unclassified (separate from the
    // success path so the operator can audit).
    if (reason.startsWith('unclassified')) {
      unclassified += 1
      unclassifiedExamples.push({ title, reason })
    }

    const sameSet =
      currentTags.length === desiredTags.length &&
      currentTags.every(t => desiredTags.includes(t))

    if (sameSet) {
      unchanged += 1
      continue
    }

    console.log(`→  ${title}`)
    console.log(`     before: [${currentTags.join(', ')}]`)
    console.log(`     after:  [${desiredTags.join(', ')}]`)
    console.log(`     reason: ${reason}`)

    if (!DRY_RUN && desiredTags.length > 0) {
      await notionFetch('PATCH', `/pages/${page.id}`, {
        properties: {
          CategoriesMulti: {
            multi_select: desiredTags.map(name => ({ name })),
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
    console.log('\n  Unclassified rows (no canonical bucket assigned):')
    for (const u of unclassifiedExamples) {
      console.log(`    - ${u.title}  [${u.reason}]`)
    }
    console.log(
      '\n  These rows keep their existing CategoriesMulti (if any).',
    )
    console.log(
      '  Add a keyword to classifyByKeywords() or fix the Category in Notion, then re-run.',
    )
  }
}

main().catch(err => {
  console.error('❌ ', err.message)
  process.exit(1)
})
