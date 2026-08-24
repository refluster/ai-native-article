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
// But four artefacts cannot import it — index.html, public/404.html,
// public/manifest.webmanifest and public/sw.js are static files that ship
// as-is — so their prefixes are hand-written copies. PR #606 changed
// SITE_BASE_PATH and those copies together, to a base GitHub Pages does not
// serve this build from; nothing mechanical objected, and the deployed site
// 404'd every asset (C-1). This gate asserts the copies agree with the
// declared base, so the next base-path move is one constant plus a red check
// instead of a silent outage.
//
// Checked, per file:
//   index.html                  <link>/<script> URLs + the SPA-restore `base`
//   public/404.html             the SPA-redirect `base`
//   public/manifest.webmanifest start_url, scope, icon srcs, share_target
//   public/sw.js                the precached app-shell URLs
//   public/robots.txt           the absolute Sitemap: URL
//
// Exit codes:
//   0  every literal agrees with SITE_BASE_PATH
//   1  at least one literal disagrees
//   2  a checked file is missing / unparseable

import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSiteBasePath } from './lib/site-base-path.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const APP = resolve(ROOT, 'newsletter', 'app')
const ORIGIN = 'https://kohuehara.xyz'

const BASE = readSiteBasePath()
const rel = f => relative(ROOT, f)

let problems = 0
const fail = (file, msg) => { console.error(`  ✗ ${rel(file)}: ${msg}`); problems++ }

/**
 * Root-absolute URLs that must live under BASE. Cross-origin URLs, protocol-
 * relative URLs, fragments, query-only and relative URLs are not our business.
 */
function isLocalAbsolute (url) {
  return url.startsWith('/') && !url.startsWith('//')
}

// `/src/...` is the Vite *source* graph, not a shipped URL: vite build bundles
// the entry and rewrites the emitted <script src> against `base`. It must stay
// project-root-relative for `vite dev` to resolve it, so it is exempt.
const VITE_SOURCE = /^\/src\//

function expectUnderBase (file, url, where) {
  if (!isLocalAbsolute(url)) return
  if (VITE_SOURCE.test(url)) return
  if (url === BASE || url.startsWith(BASE)) return
  fail(file, `${where} "${url}" is not under SITE_BASE_PATH "${BASE}"`)
}

function read (file) {
  if (!existsSync(file)) {
    console.error(`  ✗ ${rel(file)}: missing`)
    process.exit(2)
  }
  return readFileSync(file, 'utf8')
}

// --- index.html -------------------------------------------------------------
// Vite rewrites asset URLs in index.html against `base` at build time, but only
// for the attributes it recognises; a <link rel="manifest"> or apple-touch-icon
// written root-absolute ships verbatim. Check them all — a URL already under
// BASE is correct either way.
function checkHtml (file, { requireSpaBase }) {
  const src = read(file)
  for (const m of src.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    expectUnderBase(file, m[1], 'asset URL')
  }
  // The GitHub Pages SPA redirect pair: 404.html stashes the requested URL and
  // bounces to `base`; index.html restores it. A wrong `base` here sends every
  // deep link to whatever else lives at that path.
  const spa = /var base = '([^']*)'/.exec(src)
  if (requireSpaBase && !spa) {
    fail(file, "SPA redirect `var base = '...'` not found")
  } else if (spa && spa[1] !== BASE) {
    fail(file, `SPA redirect base "${spa[1]}" !== SITE_BASE_PATH "${BASE}"`)
  }
}

// --- manifest.webmanifest ---------------------------------------------------
function checkManifest (file) {
  let manifest
  try {
    manifest = JSON.parse(read(file))
  } catch (err) {
    console.error(`  ✗ ${rel(file)}: not valid JSON — ${err.message}`)
    process.exit(2)
  }
  // start_url/scope decide what an installed PWA opens and what it may
  // navigate to; a root scope on a subpath deploy makes the install silently
  // wrong rather than loudly broken.
  for (const key of ['start_url', 'scope']) {
    if (manifest[key] === undefined) fail(file, `missing "${key}"`)
    else if (manifest[key] !== BASE) {
      fail(file, `"${key}": "${manifest[key]}" !== SITE_BASE_PATH "${BASE}"`)
    }
  }
  for (const icon of manifest.icons ?? []) {
    expectUnderBase(file, icon.src ?? '', 'icon src')
  }
  const action = manifest.share_target?.action
  if (action !== undefined) expectUnderBase(file, action, 'share_target action')
}

// --- sw.js ------------------------------------------------------------------
function checkServiceWorker (file) {
  const src = read(file)
  const shell = /const SHELL = \[([\s\S]*?)\]/.exec(src)
  if (!shell) {
    fail(file, 'precache SHELL array not found')
    return
  }
  const urls = [...shell[1].matchAll(/'([^']+)'/g)].map(m => m[1])
  if (urls.length === 0) fail(file, 'precache SHELL is empty')
  // install fails atomically: one 404 in addAll() rejects the whole install,
  // so a single stale shell URL disables the service worker entirely.
  for (const url of urls) expectUnderBase(file, url, 'precached shell URL')
  for (const m of src.matchAll(/caches\.match\('([^']+)'\)/g)) {
    expectUnderBase(file, m[1], 'offline fallback URL')
  }
}

// --- robots.txt -------------------------------------------------------------
function checkRobots (file) {
  const src = read(file)
  const sitemap = /^Sitemap:\s*(\S+)/m.exec(src)
  if (!sitemap) {
    fail(file, 'no Sitemap: line')
    return
  }
  const expected = `${ORIGIN}${BASE}sitemap.xml`
  if (sitemap[1] !== expected) {
    fail(file, `Sitemap: "${sitemap[1]}" !== "${expected}"`)
  }
}

console.log(`R-16 base-path gate — SITE_BASE_PATH = "${BASE}"`)
checkHtml(resolve(APP, 'index.html'), { requireSpaBase: true })
checkHtml(resolve(APP, 'public', '404.html'), { requireSpaBase: true })
checkManifest(resolve(APP, 'public', 'manifest.webmanifest'))
checkServiceWorker(resolve(APP, 'public', 'sw.js'))
checkRobots(resolve(APP, 'public', 'robots.txt'))

if (problems > 0) {
  console.error(
    `\n✗ ${problems} base-path literal(s) disagree with SITE_BASE_PATH.\n` +
    '  Fix the literal, or — if the site really moved — change SITE_BASE_PATH\n' +
    '  in newsletter/app/src/config/site.ts and re-run `npm run sitemap`.'
  )
  process.exit(1)
}
console.log('✓ every base-path literal agrees with SITE_BASE_PATH')
