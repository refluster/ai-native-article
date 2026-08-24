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
// So this check fetches the site the way a reader does. It asserts four things,
// each of which was independently broken by the #606 incident:
//
//   1. the app's own URL serves the app shell (not some other repo's page);
//   2. every same-origin asset that shell references returns 2xx;
//   3. the service worker's precache SHELL and the manifest's icons return 2xx
//      — `cache.addAll()` is atomic, so one 404 there disables the SW entirely
//      (#619 review, Farah F4 / Owen O4);
//   4. a deep link still lands in *our* SPA fallback with *our* base, so the
//      404.html → sessionStorage → index.html restore that every sitemap and
//      search-result URL depends on is not silently bouncing readers to
//      whatever else lives at the domain root (#619 review, Rafael R3).
//
// Two things that are NOT a broken site, and must not be reported as one:
//
//   * A network failure (Farah F3 / Rafael R2). Every request is retried, and
//     one that still cannot complete exits 2 ("check could not run") rather
//     than 1 ("the site is broken"), with a headline that says which.
//
//   * A deploy that has not propagated yet. Run post-deploy, this check raced
//     GitHub Pages on the very first merge it guarded (#619 → #620): the shell
//     answered 200 with the *previous* build, whose assets 404'd, and the step
//     went red on a site that was correct four minutes later. Per-request
//     retries cannot see that — nothing failed to answer, the wrong thing
//     answered successfully — so `R17_SETTLE_ATTEMPTS` re-runs the whole check
//     while it is failing, and the deploy workflow sets a settle window. The
//     daily run leaves it at 1: there, a failure is never propagation. A gate
//     that cries wolf on every deploy is worse than no gate — it trains the
//     operator to ignore the one run that matters.
//
// It is a *schedule + post-deploy* check, never a PR gate — it asserts
// deployed state, which no pull request controls.
//
// Exit codes:
//   0  the live shell, its assets, the SW shell and a deep link all load
//   1  the site is reachable but something it serves is broken
//   2  the check could not run (DNS/network/proxy), or could not be attempted

import { ensureProxyAwareEntry } from './lib/proxy-bootstrap.mjs'
ensureProxyAwareEntry(import.meta.url)

import { readSiteBasePath } from './lib/site-base-path.mjs'
import { extractShellUrls, extractSpaBase } from './lib/base-path-literals.mjs'

const ORIGIN = process.env.SITE_ORIGIN || 'https://kohuehara.xyz'
const BASE = readSiteBasePath()
const PAGE = `${ORIGIN}${BASE}`

// Per-request retries — for a request that never completes.
const RETRIES = Number(process.env.R17_RETRIES || 1)
const RETRY_DELAY_MS = Number(process.env.R17_RETRY_DELAY_MS || 3000)
// Whole-check retries — for a deploy that has not propagated. 1 = no settle
// loop, which is what the daily run wants.
const SETTLE_ATTEMPTS = Math.max(1, Number(process.env.R17_SETTLE_ATTEMPTS || 1))
const SETTLE_DELAY_MS = Number(process.env.R17_SETTLE_DELAY_MS || 30000)

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * Fetch with retry. Distinguishes the two failure kinds the operator must
 * never see conflated:
 *   { ok, status, body }     — the server answered
 *   { networkError: string } — we never got an answer
 */
async function get (url, { attempts = RETRIES + 1, wantBody = false } = {}) {
  let lastError
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(RETRY_DELAY_MS)
    try {
      const res = await fetch(url, { redirect: 'follow' })
      return {
        ok: res.ok,
        status: res.status,
        body: wantBody ? await res.text() : undefined,
      }
    } catch (err) {
      lastError = err.message
    }
  }
  return { networkError: lastError }
}

/** Same-origin URLs only — third-party fonts/analytics are not our deploy. */
function sameOrigin (url) {
  if (url.startsWith('/') && !url.startsWith('//')) return `${ORIGIN}${url}`
  if (url.startsWith(ORIGIN)) return url
  return null
}

function referencedAssets (html) {
  const urls = new Set()
  for (const m of html.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/g)) {
    const abs = sameOrigin(m[1])
    if (abs) urls.add(abs)
  }
  return [...urls]
}

/**
 * One complete pass over the deployed site.
 * @returns {{fatal?: {code: number, message: string}, httpFailures: string[],
 *            networkErrors: string[], assetCount: number, notes: string[]}}
 */
async function runCheck () {
  const httpFailures = []   // the site served something wrong  → exit 1
  const networkErrors = []  // we could not ask                 → exit 2
  const notes = []
  const record = (url, result, label = 'asset') => {
    if (result.networkError) networkErrors.push(`${url} → ${result.networkError}`)
    else if (!result.ok) httpFailures.push(`${label} ${url} → HTTP ${result.status}`)
    return result
  }
  const done = (extra = {}) =>
    ({ httpFailures, networkErrors, notes, assetCount: 0, ...extra })

  // --- 1. the shell itself --------------------------------------------------
  const page = await get(PAGE, { wantBody: true })
  if (page.networkError) {
    return done({ fatal: { code: 2, message: `${PAGE} unreachable: ${page.networkError}` } })
  }
  if (!page.ok) {
    return done({ fatal: { code: 1, message: `${PAGE} returned HTTP ${page.status}` } })
  }

  const html = page.body
  const assets = referencedAssets(html)

  // A bundled SPA always ships at least one hashed script. If the served HTML
  // has none, we are looking at some other site's page (the #600 symptom: the
  // apex serving a different repo's build), not merely a broken asset.
  if (!assets.some(u => /\/assets\/.*\.js(\?|$)/.test(u))) {
    return done({
      fatal: {
        code: 1,
        message: `${PAGE} served no /assets/*.js bundle — wrong site at this URL?\n` +
          assets.map(u => `    referenced: ${u}`).join('\n'),
      },
    })
  }

  // --- 2 + 3. assets, the manifest's icons, and the SW precache shell -------
  const extra = new Set()

  const manifestUrl = `${ORIGIN}${BASE}manifest.webmanifest`
  const manifestRes = record(manifestUrl, await get(manifestUrl, { wantBody: true }), 'manifest')
  if (manifestRes.ok) {
    try {
      const manifest = JSON.parse(manifestRes.body)
      for (const icon of manifest.icons ?? []) {
        const abs = sameOrigin(icon.src ?? '')
        if (abs) extra.add(abs)
      }
    } catch (err) {
      httpFailures.push(`manifest ${manifestUrl} → not valid JSON (${err.message})`)
    }
  }

  const swUrl = `${ORIGIN}${BASE}sw.js`
  const swRes = record(swUrl, await get(swUrl, { wantBody: true }), 'service worker')
  if (swRes.ok) {
    const shell = extractShellUrls(swRes.body)
    if (shell === null) {
      httpFailures.push(`service worker ${swUrl} → no precache SHELL array`)
    } else {
      for (const url of shell) {
        const abs = sameOrigin(url)
        if (abs) extra.add(abs)
      }
    }
  }

  const toFetch = [...new Set([...assets, ...extra])]
  await Promise.all(toFetch.map(async url => record(url, await get(url))))

  // --- 4. the deep-link round trip -----------------------------------------
  // Every sitemap entry and every search result is a deep link, and GitHub
  // Pages answers those with 404.html, which bounces through sessionStorage
  // back to the shell. A wrong `base` there sends readers to whatever else
  // lives at the root — while the shell URL above stays perfectly green.
  const sitemapUrl = `${ORIGIN}${BASE}sitemap.xml`
  const sitemapRes = record(sitemapUrl, await get(sitemapUrl, { wantBody: true }), 'sitemap')
  if (sitemapRes.ok) {
    // Compare on the *path*, not the whole URL: the sitemap's origin is a
    // build-time constant, and this check may legitimately probe another origin
    // (a local gh-pages simulation, a staging host) via SITE_ORIGIN.
    const paths = [...sitemapRes.body.matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map(m => { try { return new URL(m[1]).pathname } catch { return null } })
      .filter(Boolean)
    const deepPath = paths.find(p => p.startsWith(BASE) && p !== BASE)
    if (!deepPath) {
      notes.push(`sitemap listed no deep link under ${BASE} — skipped the round-trip check`)
    } else {
      const deepLink = `${ORIGIN}${deepPath}`
      // Not asserted 2xx: the SPA fallback legitimately answers 404 with the
      // stub body. What matters is *whose* stub, and with which base.
      const res = await get(deepLink, { wantBody: true })
      if (res.networkError) {
        networkErrors.push(`${deepLink} → ${res.networkError}`)
      } else {
        const spaBase = extractSpaBase(res.body)
        const isOurShell = /\/assets\/.*\.js/.test(res.body)
        if (spaBase === null && !isOurShell) {
          httpFailures.push(
            `deep link ${deepLink} → HTTP ${res.status}, and the served page is ` +
            `neither our SPA fallback nor our shell (a foreign page answers this path)`
          )
        } else if (spaBase !== null && spaBase !== BASE) {
          httpFailures.push(
            `deep link ${deepLink} → SPA fallback redirects to "${spaBase}", ` +
            `not SITE_BASE_PATH "${BASE}" — deep links leave the site`
          )
        }
      }
    }
  }

  return done({ assetCount: toFetch.length })
}

// --- driver: settle loop ----------------------------------------------------
console.log(`R-17 live base-path smoke — ${PAGE}`)

let result
for (let attempt = 1; attempt <= SETTLE_ATTEMPTS; attempt++) {
  result = await runCheck()
  const clean = !result.fatal && result.httpFailures.length === 0 && result.networkErrors.length === 0
  if (clean || attempt === SETTLE_ATTEMPTS) break
  console.log(
    `  … attempt ${attempt}/${SETTLE_ATTEMPTS} not clean yet ` +
    `(${result.fatal ? 'fatal' : `${result.httpFailures.length} http, ${result.networkErrors.length} network`})` +
    ` — the deploy may still be propagating; retrying in ${Math.round(SETTLE_DELAY_MS / 1000)}s`
  )
  await sleep(SETTLE_DELAY_MS)
}

for (const note of result.notes) console.warn(`  ⚠ ${note}`)

if (result.fatal) {
  console.error(`✗ ${result.fatal.code === 2 ? 'check could not run — ' : ''}${result.fatal.message}`)
  process.exit(result.fatal.code)
}

const { httpFailures, networkErrors, assetCount } = result

if (httpFailures.length > 0) {
  console.error(`\n✗ the deployed site is broken — ${httpFailures.length} failure(s):`)
  for (const f of httpFailures.sort()) console.error(`    ${f}`)
  console.error(
    `\n  The deployed site references paths this origin does not serve.\n` +
    `  Usually SITE_BASE_PATH (newsletter/app/src/config/site.ts) no longer\n` +
    `  matches where GitHub Pages actually publishes this repo — check where\n` +
    `  ${PAGE} is really served from before changing anything else.`
  )
  if (networkErrors.length > 0) {
    console.error(`\n  (also ${networkErrors.length} request(s) could not complete:)`)
    for (const e of networkErrors.sort()) console.error(`    ${e}`)
  }
  process.exit(1)
}

if (networkErrors.length > 0) {
  console.error(
    `\n✗ check could not run — ${networkErrors.length} request(s) never completed ` +
    `after ${RETRIES + 1} attempt(s):`
  )
  for (const e of networkErrors.sort()) console.error(`    ${e}`)
  console.error(
    '\n  This is a network/proxy result, NOT evidence about the site. Re-run\n' +
    '  before treating it as an outage.'
  )
  process.exit(2)
}

console.log(
  `✓ shell, ${assetCount} asset(s) (incl. SW precache shell + manifest icons) ` +
  `and the deep-link round trip all load from ${PAGE}`
)
