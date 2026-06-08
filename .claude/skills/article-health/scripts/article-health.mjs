#!/usr/bin/env node
// article-health: sweep gh-pages + Notion (via GAS) and flag truncated /
// stale articles. Single-shot; no destructive actions. Mirrors the
// `isTruncatedMarkdown` heuristic in newsletter/gas/src/Code.gs so what fails here
// would also be flagged by the GAS-side L2_BACKFILL sweep.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { isTruncatedMarkdown, stripFrontmatter, lastNonEmptyLine } from '../../../../scripts/lib/truncation.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..')
// PR #60 moved the React app from src/ to newsletter/app/src/.
const GAS_CONFIG_PATH = resolve(REPO_ROOT, 'newsletter', 'app', 'src', 'lib', 'gas-config.ts')
const REPO_OWNER_REPO = 'refluster/ai-native-article'
const PAGES_BRANCH = 'gh-pages'
const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER_REPO}/${PAGES_BRANCH}/posts`

// isTruncatedMarkdown / lastNonEmptyLine / stripFrontmatter now live in the
// shared scripts/lib/truncation.mjs (imported above). The GAS-side copy in
// newsletter/gas/src/Code.gs must still be kept in sync by hand — see that
// module's header and docs/memory-lint-backlog.md ML-001.

async function fetchText (url) {
  const r = await fetch(url, { redirect: 'follow' })
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`)
  return r.text()
}

async function fetchJson (url) {
  return JSON.parse(await fetchText(url))
}

function loadGasUrl () {
  const txt = readFileSync(GAS_CONFIG_PATH, 'utf8')
  const m = txt.match(/const\s+id\s*=\s*['"]([^'"]+)['"]/)
  if (!m) throw new Error(`Could not parse deployment id from ${GAS_CONFIG_PATH}`)
  return `https://script.google.com/macros/s/${m[1]}/exec`
}

async function gasPost (action) {
  const url = loadGasUrl()
  const r = await fetch(url, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  })
  const txt = await r.text()
  if (!r.ok || !txt.trim().startsWith('{')) {
    throw new Error(`GAS ${action} failed: HTTP ${r.status} ${txt.slice(0, 200)}`)
  }
  return JSON.parse(txt)
}

// 5% length tolerance: the markdown produced by fetch-notion.mjs and the
// markdown we'd reconstruct from the GAS L2_LIST summary are not
// byte-identical (frontmatter, image inserts, image-link rewriting). Below
// 5% is noise; above is "Notion has substantively newer content."
const STALE_LENGTH_RATIO = 0.95

async function main () {
  const t0 = Date.now()
  const ts = new Date().toISOString()
  console.log(`=== article-health: ${ts} ===`)

  const manifest = await fetchJson(`${RAW_BASE}/manifest.json`)
  console.log(`Manifest: ${manifest.length} published articles`)

  // ARTICLE_LIST returns both explanations and analyses (unified DB).
  // Falls back gracefully if the action isn't supported on this deploy.
  let notionByNotionId = new Map()
  let notionEntries = []
  try {
    const r = await gasPost('ARTICLE_LIST')
    notionEntries = (r && r.data) || []
    for (const e of notionEntries) {
      // Match by trailing 12 hex chars of the Notion id; that's how slugs
      // are derived in handleL4Publish when LegacySlug is absent.
      const tail = (e.id || '').replace(/-/g, '').slice(-12)
      notionByNotionId.set(tail, e)
    }
  } catch (e) {
    console.error(`(warning: ARTICLE_LIST unavailable — Notion comparison disabled. ${e.message})`)
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
