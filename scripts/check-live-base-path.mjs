#!/usr/bin/env node
// R-17 — Live base-path smoke check.
//
// R-16 proves the app's base-path literals agree with each other. It cannot
// prove they agree with *reality*, because "where does GitHub Pages serve this
// build" is not a property of the repo — it depends on which repo currently
// holds the custom domain, a Settings-side fact no diff can see.
//
// That gap is precisely what shipped in PR #606: SITE_BASE_PATH and all five
// static copies moved to '/' together (internally consistent, R-16 green), the
// deploy went green, and the live site served an index.html whose every asset
// URL 404'd — a blank page for a week. The only observable that moved was the
// live page itself.
//
// So this check fetches the site the way a reader does and asserts the shell
// actually loads: the app's own URL must return HTML, and every same-origin
// asset that HTML references must return 2xx. It is a *schedule*, not a PR
// gate — it depends on the network and on the deployed state, neither of which
// a pull request controls.
//
// Exit codes:
//   0  the live shell and all of its referenced assets load
//   1  the site is reachable but an asset (or the page itself) is broken
//   2  the site could not be reached at all (DNS/network/proxy)

import { ensureProxyAwareEntry } from './lib/proxy-bootstrap.mjs'
ensureProxyAwareEntry(import.meta.url)

import { readSiteBasePath } from './lib/site-base-path.mjs'

const ORIGIN = process.env.SITE_ORIGIN || 'https://kohuehara.xyz'
const BASE = readSiteBasePath()
const PAGE = `${ORIGIN}${BASE}`

// Same-origin URLs only. Google Fonts / gtag are third-party and outside what
// this check is asserting (and their availability is not our deploy's fault).
function referencedAssets (html) {
  const urls = new Set()
  for (const m of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const url = m[1]
    if (url.startsWith('/') && !url.startsWith('//')) urls.add(`${ORIGIN}${url}`)
    else if (url.startsWith(ORIGIN)) urls.add(url)
  }
  return [...urls]
}

let res
try {
  res = await fetch(PAGE, { redirect: 'follow' })
} catch (err) {
  console.error(`✗ could not reach ${PAGE} — ${err.message}`)
  process.exit(2)
}

console.log(`R-17 live base-path smoke — ${PAGE}`)

if (!res.ok) {
  console.error(`✗ ${PAGE} returned HTTP ${res.status}`)
  process.exit(1)
}

const html = await res.text()
const assets = referencedAssets(html)
if (assets.length === 0) {
  console.error(`✗ ${PAGE} referenced no same-origin assets — served shell is not the app`)
  process.exit(1)
}

// A bundled SPA always ships at least one hashed script. If the served HTML has
// none, we are looking at some other site's page (the #600 symptom: the apex
// serving a different repo's build), not a broken asset.
if (!assets.some(u => /\/assets\/.*\.js(\?|$)/.test(u))) {
  console.error(`✗ ${PAGE} served no /assets/*.js bundle — wrong site at this URL?`)
  for (const url of assets) console.error(`    referenced: ${url}`)
  process.exit(1)
}

const broken = []
await Promise.all(assets.map(async url => {
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow' })
    if (!r.ok) broken.push(`${url} → HTTP ${r.status}`)
  } catch (err) {
    broken.push(`${url} → ${err.message}`)
  }
}))

if (broken.length > 0) {
  console.error(`\n✗ ${broken.length}/${assets.length} referenced asset(s) do not load:`)
  for (const b of broken.sort()) console.error(`    ${b}`)
  console.error(
    `\n  The deployed shell references paths this origin does not serve.\n` +
    `  Usually SITE_BASE_PATH (newsletter/app/src/config/site.ts) no longer\n` +
    `  matches where GitHub Pages actually publishes this repo.`
  )
  process.exit(1)
}

console.log(`✓ shell + ${assets.length} referenced asset(s) load from ${PAGE}`)
