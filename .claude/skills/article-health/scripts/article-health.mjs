#!/usr/bin/env node
// article-health: sweep gh-pages (and, when NOTION_API_KEY is set, compare
// against Notion directly) and flag truncated / stale articles. Single-shot;
// no destructive actions. Uses the canonical `isTruncatedMarkdown` heuristic
// from scripts/lib/truncation.mjs — the same guard enforced at generation
// time by the workforce article-level2/level3 publish-notion.mjs (W-1) and at
// deploy time by check-corpus-truncation.mjs (R-10).
//
// History: the Notion comparison used to go through the GAS `ARTICLE_LIST`
// web-app action. The GAS L1→L4 pipeline was retired (generation moved to the
// workforce cadences), so the comparison now reads the Notion Articles DB
// directly via the shared fetcher. It is optional: with no NOTION_API_KEY the
// gh-pages truncation sweep still runs (the primary C-1 guard).

import { ensureProxyAwareEntry } from '../../../../scripts/lib/proxy-bootstrap.mjs'
ensureProxyAwareEntry(import.meta.url)

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { isTruncatedMarkdown, stripFrontmatter, lastNonEmptyLine } from '../../../../scripts/lib/truncation.mjs'
import { fetchArticles } from '../../../../newsletter/pipeline/fetchers/notion.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..')
void REPO_ROOT
const REPO_OWNER_REPO = 'refluster/ai-native-article'
const PAGES_BRANCH = 'gh-pages'
const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER_REPO}/${PAGES_BRANCH}/posts`

// Notion Articles DB id (non-secret; mirrors the constant used across the
// workforce article skills and newsletter/pipeline). Override via env.
const UNIFIED_DB_ID =
  process.env.UNIFIED_DB_ID || process.env.NOTION_DB_ID || '34fd0f0b-e61e-817a-9f6b-dc65b0d5b4cc'

async function fetchText (url) {
  const r = await fetch(url, { redirect: 'follow' })
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`)
  return r.text()
}

async function fetchJson (url) {
  return JSON.parse(await fetchText(url))
}

// 5% length tolerance: the markdown produced by fetch-notion.mjs and the body
// we read back from Notion are not byte-identical (frontmatter, image inserts,
// image-link rewriting). Below 5% is noise; above is "Notion has
// substantively newer content."
const STALE_LENGTH_RATIO = 0.95

async function main () {
  const t0 = Date.now()
  const ts = new Date().toISOString()
  console.log(`=== article-health: ${ts} ===`)

  const manifest = await fetchJson(`${RAW_BASE}/manifest.json`)
  console.log(`Manifest: ${manifest.length} published articles`)

  // Compare against Notion directly via the shared fetcher (both explanations
  // and analyses live in the unified Articles DB). Optional: with no
  // NOTION_API_KEY the gh-pages truncation sweep still runs.
  let notionByNotionId = new Map()
  let notionEntries = []
  const notionApiKey = process.env.NOTION_API_KEY
  if (notionApiKey) {
    try {
      const records = await fetchArticles({ apiKey: notionApiKey, dbId: UNIFIED_DB_ID })
      notionEntries = records.map(r => ({ type: r.type, bodyLength: (r.bodyMd || '').length, slug: r.slug }))
      for (const e of notionEntries) notionByNotionId.set(e.slug, e)
    } catch (e) {
      console.error(`(warning: Notion query failed — comparison disabled. ${e.message})`)
    }
  } else {
    console.error('(note: NOTION_API_KEY unset — Notion drift comparison disabled; gh-pages truncation sweep only)')
  }
  const explanationCount = notionEntries.filter(e => e.type === 'explanation').length
  const analysisCount = notionEntries.filter(e => e.type === 'analysis').length
  if (notionEntries.length) {
    console.log(`Notion:   ${explanationCount} explanations + ${analysisCount} analyses`)
  }
  console.log()

  const findings = []
  for (const m of manifest) {
    const slug = m.slug
    const type = m.type || 'unknown'
    let body
    try {
      const md = await fetchText(`${RAW_BASE}/${slug}.md`)
      body = stripFrontmatter(md)
    } catch (e) {
      findings.push({ slug, type, status: 'MISSING_ON_PAGES', preview: '(404 on gh-pages)' })
      continue
    }

    const truncated = isTruncatedMarkdown(body)
    const notion = notionByNotionId.get(slug)
    const status = (() => {
      if (truncated) return 'TRUNCATED_PUBLISHED'
      if (notion && body.length < notion.bodyLength * STALE_LENGTH_RATIO) {
        return 'STALE_DEPLOY'
      }
      return 'OK'
    })()
    findings.push({ slug, type, status, preview: lastNonEmptyLine(body) })
  }

  // Print table — fixed-width columns for grep-ability.
  console.log('slug         | type        | status              | last line preview')
  console.log('------------ | ----------- | ------------------- | ----------------------------------------')
  for (const f of findings) {
    if (f.status === 'OK') continue // suppress OK rows in default output
    console.log(
      `${f.slug.padEnd(12)} | ${f.type.padEnd(11)} | ${f.status.padEnd(19)} | "${f.preview}"`
    )
  }

  const truncated = findings.filter(f => f.status.startsWith('TRUNCATED')).length
  const stale = findings.filter(f => f.status === 'STALE_DEPLOY').length
  const missing = findings.filter(f => f.status === 'MISSING_ON_PAGES').length
  const ok = findings.filter(f => f.status === 'OK').length

  console.log()
  console.log(`Findings: ${truncated} truncated, ${stale} stale, ${missing} missing on pages, ${ok} ok`)
  console.log(`(${((Date.now() - t0) / 1000).toFixed(1)}s)`)

  if (truncated > 0) process.exit(1)
  if (stale > 0) process.exit(2)
  process.exit(0)
}

main().catch(e => { console.error(`error: ${e.stack || e.message}`); process.exit(11) })
