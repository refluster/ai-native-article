#!/usr/bin/env node
// R-10 — Pre-deploy corpus truncation gate.
//
// Runs in deploy-article-site.yml AFTER `npm run fetch-notion` (which writes
// the freshly-derived markdown into newsletter/app/public/posts/) and BEFORE
// `npm run build:article`. A truncated body that reaches gh-pages is exactly
// the d17e1d58ec42 incident (2026-05-03) that seeded this whole governance
// layer — C-1 (editorial integrity) + C-4 (fail loud). The runtime
// finish_reason throw (R-3) stops bad content at *generation* time; this gate
// stops it at *deploy* time, before the public site is overwritten.
//
// Provenance: asp-cloud's "health gate before promote" + mononaware's
// pre-publish parity gates. Recorded in docs/governance-mechanisms.md.
//
// Exit codes:
//   0  every published body is well-formed
//   1  at least one truncated body found — deploy must NOT proceed
//   2  posts dir missing or empty after fetch-notion (pipeline ordering bug)
//
// Escape hatch (operator-only, a §8.1 B action): set ALLOW_TRUNCATED=1 to
// downgrade a truncation finding to a warning and let the deploy proceed.
// Use only to ship an unrelated fix while a known-bad article is being
// regenerated; record it in docs/risk-acceptance-ledger.md.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isTruncatedMarkdown, stripFrontmatter, lastNonEmptyLine } from './lib/truncation.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const POSTS_DIR = join(REPO_ROOT, 'newsletter', 'app', 'public', 'posts')

const allowTruncated = process.env.ALLOW_TRUNCATED === '1'

function main () {
  if (!existsSync(POSTS_DIR)) {
    console.error(`✗ posts dir not found: ${POSTS_DIR}`)
    console.error('  This gate must run AFTER `npm run fetch-notion`. Check workflow step order.')
    process.exit(2)
  }

  const files = readdirSync(POSTS_DIR).filter(f => f.endsWith('.md') && f !== 'manifest.json')
  if (files.length === 0) {
    console.error(`✗ no markdown posts in ${POSTS_DIR} — fetch-notion produced nothing.`)
    process.exit(2)
  }

  const truncated = []
  for (const f of files) {
    const md = readFileSync(join(POSTS_DIR, f), 'utf8')
    const body = stripFrontmatter(md)
    if (isTruncatedMarkdown(body)) {
      truncated.push({ slug: f.replace(/\.md$/, ''), preview: lastNonEmptyLine(body) })
    }
  }

  console.log(`Scanned ${files.length} published bodies for truncation.`)

  if (truncated.length === 0) {
    console.log('✅ No truncated articles. Safe to deploy.')
    process.exit(0)
  }

  console.error(`\n❌ ${truncated.length} truncated article(s) — C-1/C-4 violation:`)
  for (const t of truncated) {
    console.error(`  ✗ ${t.slug} — ends: "${t.preview}"`)
  }
  console.error('\nFix: re-run L2_BACKFILL for the slug (or open the Notion row), then redeploy.')
  console.error('See newsletter/docs/L1-L4-PIPELINE.md §Operator runbooks.')

  if (allowTruncated) {
    console.error('\n⚠ ALLOW_TRUNCATED=1 set — downgrading to warning and proceeding.')
    console.error('  Record this override in docs/risk-acceptance-ledger.md.')
    process.exit(0)
  }
  process.exit(1)
}

main()
