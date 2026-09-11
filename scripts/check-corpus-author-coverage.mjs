#!/usr/bin/env node
// check-corpus-author-coverage.mjs — #672 item 3: "add a gate so the count
// cannot grow again."
//
// #672 found that 182 of 408 published articles (44.6%, verified 2026-09-07
// against the live manifest) carry no `author` at all, and that the absolute
// count of 182 had not moved in a month despite ~40 new articles landing —
// meaning the FORWARD path already never produces an author-less row (both
// article-level2/publish-notion.mjs and article-level3/publish-notion.mjs
// require --author and exit 1 without it) and the 182 is entirely pre-existing
// legacy debt. Deciding HOW to backfill that legacy debt is a policy call
// (#672 items 1–2: attribute via the EXEC/quality sidecar where identifiable,
// or a documented default for the pre-workforce corpus — "fabricating a
// plausible author is not an option", C-1) that this script does not make.
//
// What this script DOES do, unconditionally: stop the number from growing
// past its last-known value, the same ratchet discipline this repo already
// applies to coverage floors and R-rule tightening (loosen only with an
// explicit, cited reason). It runs in the same deploy-time position as R-10
// (scripts/check-corpus-truncation.mjs) — after `npm run fetch-notion`, on
// the freshly-derived local corpus, before build — because a NEW author-less
// row can only be introduced by whatever landed in Notion since the last
// deploy, exactly like a truncated body.
//
// BASELINE_MISSING_AUTHOR is a checked-in ceiling, not a live comparison
// against the previous deploy — main:newsletter/app/public/posts is a stale,
// non-authoritative snapshot (C-2/I-1; see docs/architecture-source-of-truth.md),
// so this gate must not read it as a source of truth. Lower this constant as
// legacy rows get backfilled (that is a tightening, autonomous per L2 policy);
// raising it is the same "loosening a check" class as ALLOW_TRUNCATED and
// needs the operator's explicit yes, recorded in the same commit.
//
// This gate is NOT yet wired into .github/workflows/deploy-article-site.yml —
// that file is Zone A (AGENTS.md §1) and a PR touching it plus this Zone B
// script would span zones (AGENTS.md §4), so wiring it in is left as a
// follow-up PR for the operator to review on its own (mirrors PR #691's split
// of the same shape). Run it by hand until then: `npm run check-author-coverage`.
//
// Exit codes:
//   0  missing-author count is at or below the baseline ceiling
//   1  missing-author count REGRESSED past the baseline — a newly-published
//      row has no author, which should be structurally impossible on the
//      cadence path (both publish-notion.mjs scripts require --author) —
//      investigate how it was added (a manual Notion edit is the likely path)
//   2  posts dir / manifest.json missing after fetch-notion (pipeline
//      ordering bug — same convention as check-corpus-truncation.mjs)
//
// Escape hatch (operator-only, a §8.1 B action, mirrors ALLOW_TRUNCATED):
// set ALLOW_AUTHOR_REGRESSION=<reason> to downgrade a regression to a warning
// and let the deploy proceed. Record the override in
// docs/risk-acceptance-ledger.md.

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { countMissingAuthor } from './lib/author-coverage.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const MANIFEST_PATH = join(REPO_ROOT, 'newsletter', 'app', 'public', 'posts', 'manifest.json')

// Verified 2026-09-07 against the live gh-pages manifest (#672). Lower this
// as legacy rows are backfilled; never raise it without operator sign-off.
const BASELINE_MISSING_AUTHOR = Number(process.env.BASELINE_MISSING_AUTHOR ?? 182)

const waiver = (process.env.ALLOW_AUTHOR_REGRESSION ?? '').trim()

function main() {
  if (!existsSync(MANIFEST_PATH)) {
    console.error(`✗ manifest not found: ${MANIFEST_PATH}`)
    console.error('  This gate must run AFTER `npm run fetch-notion`. Check workflow step order.')
    process.exit(2)
  }

  let manifest
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  } catch (err) {
    console.error(`✗ could not parse ${MANIFEST_PATH}: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(2)
  }

  const rows = Array.isArray(manifest) ? manifest : (manifest.posts ?? manifest.items ?? [])
  if (rows.length === 0) {
    console.error(`✗ manifest at ${MANIFEST_PATH} contains no articles.`)
    process.exit(2)
  }

  const { total, missing, missingSlugs } = countMissingAuthor(rows)
  const pct = total > 0 ? ((missing / total) * 100).toFixed(1) : '0.0'
  console.log(`Scanned ${total} published articles: ${missing} (${pct}%) carry no author (baseline ${BASELINE_MISSING_AUTHOR}).`)

  if (missing <= BASELINE_MISSING_AUTHOR) {
    if (missing < BASELINE_MISSING_AUTHOR) {
      console.log(`✅ ${BASELINE_MISSING_AUTHOR - missing} row(s) backfilled since the last baseline — consider lowering BASELINE_MISSING_AUTHOR in this script.`)
    } else {
      console.log('✅ No regression — count is unchanged from the recorded baseline.')
    }
    process.exit(0)
  }

  console.error(`\n❌ ${missing} articles now carry no author — REGRESSED past the baseline of ${BASELINE_MISSING_AUTHOR} (#672).`)
  console.error('   New author-less rows (baseline articles are already known and excluded from this list by count, not identity):')
  for (const slug of missingSlugs.slice(0, 20)) console.error(`     ✗ ${slug}`)
  if (missingSlugs.length > 20) console.error(`     … and ${missingSlugs.length - 20} more`)
  console.error('\nBoth article-level2 and article-level3 publish-notion.mjs already require --author (exit 1 without it),')
  console.error('so a new author-less row almost certainly came from a manual Notion edit. Fix the Notion row, then redeploy.')
  console.error('See docs/issue #672.')

  if (waiver) {
    if (/^(0|false|no|off)$/i.test(waiver) || waiver.length < 4) {
      console.error(`\n❌ ALLOW_AUTHOR_REGRESSION must be a reason, not "${waiver}".`)
      process.exit(1)
    }
    console.error(`\n⚠ ALLOW_AUTHOR_REGRESSION="${waiver}" set — downgrading to warning and proceeding.`)
    console.error('  Record this override in docs/risk-acceptance-ledger.md.')
    process.exit(0)
  }
  process.exit(1)
}

main()
