#!/usr/bin/env node
// R-16 — Base-path consistency gate.
//
// The article site is served from a GitHub Pages *project* subpath
// (https://kohuehara.xyz/ai-native-article/), so every root-absolute URL the
// app emits has to carry that prefix. `SITE_BASE_PATH` in
// newsletter/app/src/config/site.ts is the single source of truth: vite reads
// it for `base`, the router reads it for `basename`, seo.ts derives canonical
// URLs from it.
//
// But five artefacts cannot import it — index.html, public/404.html,
// public/manifest.webmanifest, public/sw.js and public/robots.txt ship as-is —
// so their prefixes are hand-written copies. PR #606 changed SITE_BASE_PATH and
// those copies together, to a base GitHub Pages does not serve this build from;
// nothing mechanical objected, and the deployed site 404'd every asset (C-1).
// This gate asserts the copies agree with the declared base.
//
// The comparison is **directional** (#619 review, Dario D1 / Owen O1): a
// literal must sit under the base *and* must not repeat a base segment after
// it. A plain prefix test is vacuous at base '/', where every root-absolute URL
// "starts with" the base — so the migration site.ts promises is safe would
// otherwise leave stale '/ai-native-article/…' literals green while
// `cache.addAll()` 404s again, which is precisely this incident class.
//
// The comparisons themselves live in scripts/lib/base-path-literals.mjs so the
// red path is unit-tested; this file is I/O, and it fails loud when a file it
// was told to inspect yields no URLs at all — a silently-zero extractor is a
// green no-op, not a passing check (Owen O2).
//
// Exit codes:
//   0  every literal agrees with SITE_BASE_PATH
//   1  at least one literal disagrees
//   2  a checked file is missing / unparseable

import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSiteBasePath } from './lib/site-base-path.mjs'
import {
  checkHtml, checkManifest, checkServiceWorker, checkRobots,
} from './lib/base-path-literals.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APP = resolve(ROOT, 'newsletter', 'app')
const ORIGIN = 'https://kohuehara.xyz'

const BASE = readSiteBasePath()
const rel = f => relative(ROOT, f)

let problems = 0

function read (file) {
  if (!existsSync(file)) {
    console.error(`  ✗ ${rel(file)}: missing`)
    process.exit(2)
  }
  return readFileSync(file, 'utf8')
}

/** Apply one check, report its problems, and insist it actually saw URLs. */
function apply (file, result, { expectUrls = true } = {}) {
  for (const p of result.problems) {
    console.error(`  ✗ ${rel(file)}: ${p}`)
    problems++
  }
  if (expectUrls && result.problems.length === 0 && result.urls.length === 0) {
    console.error(
      `  ✗ ${rel(file)}: no base-path URLs found — the extractor matched nothing, ` +
      `so this file is unchecked rather than clean`
    )
    problems++
  }
}

function parseManifest (file) {
  try {
    return JSON.parse(read(file))
  } catch (err) {
    console.error(`  ✗ ${rel(file)}: not valid JSON — ${err.message}`)
    process.exit(2)
  }
}

console.log(`R-16 base-path gate — SITE_BASE_PATH = "${BASE}"`)

const indexHtml = resolve(APP, 'index.html')
apply(indexHtml, checkHtml(read(indexHtml), BASE, { requireSpaBase: true }))

// 404.html is the SPA redirect stub: it carries the `base` literal but no
// same-origin asset of its own, so it is the one file with no URLs to find.
const notFound = resolve(APP, 'public', '404.html')
apply(notFound, checkHtml(read(notFound), BASE, { requireSpaBase: true }), { expectUrls: false })

const manifest = resolve(APP, 'public', 'manifest.webmanifest')
apply(manifest, checkManifest(parseManifest(manifest), BASE))

const sw = resolve(APP, 'public', 'sw.js')
apply(sw, checkServiceWorker(read(sw), BASE))

const robots = resolve(APP, 'public', 'robots.txt')
apply(robots, checkRobots(read(robots), BASE, ORIGIN))

if (problems > 0) {
  console.error(
    `\n✗ ${problems} base-path literal(s) disagree with SITE_BASE_PATH.\n` +
    '  Fix the literal, or — if the site really moved — change SITE_BASE_PATH\n' +
    '  in newsletter/app/src/config/site.ts and re-run `npm run sitemap`.'
  )
  process.exit(1)
}
console.log('✓ every base-path literal agrees with SITE_BASE_PATH')
