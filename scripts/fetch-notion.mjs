#!/usr/bin/env node
/**
 * fetch-notion.mjs — CLI entry that pulls articles from a Notion database
 * and writes Markdown files + manifest.json into public/posts/.
 *
 * This file is intentionally thin. The two responsibilities live in
 * sibling modules so they can be swapped independently:
 *
 *   - scripts/fetchers/notion.mjs  → DB-specific reader (Notion today)
 *   - scripts/writers/posts-md.mjs → DB-agnostic writer (Markdown + JSON)
 *
 * Future DB migrations (DynamoDB / Postgres / …) only require a new
 * fetcher module that returns the same ArticleRecord[] shape — the
 * writer is unchanged.
 *
 * Environment:
 *   NOTION_API_KEY          (required)
 *   UNIFIED_DB_ID           (preferred) — the new unified Articles DB
 *   NOTION_DB_ID            (alias) — same as UNIFIED_DB_ID
 *   FETCH_BRIDGE            ("true" to enable bridge mode)
 *   LEGACY_L3_DB_ID         (used only when FETCH_BRIDGE=true)
 *   ARTICLE_FETCHER         ("notion" default; reserved for future backends)
 *
 * Usage:
 *   node --env-file=.env scripts/fetch-notion.mjs
 */

import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

import { fetchArticles } from './fetchers/notion.mjs'
import { writePosts } from './writers/posts-md.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// Load .env in local dev. CI passes env through workflow `env:`.
const envPath = join(ROOT, '.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim()
  }
}

// The legacy L3 database ID. Hard-coded as a fallback so that a vanilla
// `npm run fetch-notion` keeps working even before UNIFIED_DB_ID is set,
// matching pre-refactor behaviour. Phase E will remove this fallback.
const LEGACY_L3_DB_ID =
  process.env.LEGACY_L3_DB_ID || '331d0f0be61e812e92bfc1ba92bcd1d9'

const NOTION_API_KEY = process.env.NOTION_API_KEY
const UNIFIED_DB_ID =
  process.env.UNIFIED_DB_ID || process.env.NOTION_DB_ID || LEGACY_L3_DB_ID
const BRIDGE = (process.env.FETCH_BRIDGE || '').toLowerCase() === 'true'
const FETCHER = (process.env.ARTICLE_FETCHER || 'notion').toLowerCase()

if (!NOTION_API_KEY) {
  console.error('❌  NOTION_API_KEY is not set. Add it to your .env file.')
  process.exit(1)
}
if (FETCHER !== 'notion') {
  console.error(`❌  Unsupported ARTICLE_FETCHER='${FETCHER}'. Only 'notion' is implemented today.`)
  process.exit(1)
}

const POSTS_DIR = join(ROOT, 'public', 'posts')

console.log('🔍  Querying Notion database …')
console.log(`    primary: ${UNIFIED_DB_ID}`)
if (BRIDGE) console.log(`    bridge:  ${LEGACY_L3_DB_ID} (legacy L3)`)

const records = await fetchArticles({
  apiKey: NOTION_API_KEY,
  dbId: UNIFIED_DB_ID,
  bridgeMode: BRIDGE,
  legacyDbId: LEGACY_L3_DB_ID,
  logger: msg => console.log(msg),
})

await writePosts(records, {
  postsDir: POSTS_DIR,
  logger: msg => console.log(msg),
})
