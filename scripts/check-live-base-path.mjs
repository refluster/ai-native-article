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
//     answered successfully.
//
//     The settle loop therefore waits for the *right build*, not for "nothing
//     failed" (#620 review, Farah F1 / Dario D1). Waiting on failure alone
//     inverts the bug into something worse: the stale build is normally
//     HEALTHY, so the first attempt passes clean, the loop exits 0 — and the
//     new deploy, broken or not, was never looked at. That is a false green on
//     the one run that exists to catch a bad deploy, and it was reproduced
//     before this was written. So the post-deploy caller passes
//     `R17_EXPECT_BUILD_DIR` (the `dist/` it just published, on disk in the
//     same job): until the served shell references that build's hashed assets,
//     the result is "not propagated yet" — retry, never pass. A gate that
//     cries wolf on every deploy is worse than no gate; a gate that says
//     "green" without looking is worse still.
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

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { readSiteBasePath } from './lib/site-base-path.mjs'
import { settle } from './lib/settle.mjs'
import {
  extractShellUrls, extractSpaBase, buildFingerprint, servesExpectedBuild,
} from './lib/base-path-literals.mjs'

const ORIGIN = process.env.SITE_ORIGIN || 'https://kohuehara.xyz'
const BASE = readSiteBasePath()
const PAGE = `${ORIGIN}${BASE}`

/**
 * Read a positive-integer knob from the environment.
 *
 * Fails loud on a malformed value (C-4). `Math.max(1, Number('abc'))` is NaN,
 * which silently skipped the settle loop entirely and then threw on undefined
 * state — surfacing as exit 1, i.e. this script's code for "the deployed site
 * is broken". A config typo must never be filed as an outage (#620 review,
 * Dario D2).
 */
function intFromEnv (name, fallback, { min = 0 } = {}) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min) {
    throw new Error(
      `${name}="${raw}" is not an integer >= ${min} — refusing to run with an ` +
      `ambiguous setting rather than reporting a config error as a site outage`
    )
  }
  return value
}

// Per-request retries — for a request that never completes.
const RETRIES = intFromEnv('R17_RETRIES', 1)
const RETRY_DELAY_MS = intFromEnv('R17_RETRY_DELAY_MS', 3000)
// Whole-check retries — for a deploy that has not propagated. 1 = no settle
// loop, which is what the daily run wants.
const SETTLE_ATTEMPTS = intFromEnv('R17_SETTLE_ATTEMPTS', 1, { min: 1 })
const SETTLE_DELAY_MS = intFromEnv('R17_SETTLE_DELAY_MS', 30000)
// The dist/ this run just published, when the caller is the deploy workflow.
// Its hashed asset names are what "the new build is live" actually means.
const EXPECT_BUILD_DIR = process.env.R17_EXPECT_BUILD_DIR || ''

/** Fingerprint of the build this run published, or [] when none was named. */
function expectedFingerprint () {
  if (!EXPECT_BUILD_DIR) return []
  const index = join(EXPECT_BUILD_DIR, 'index.html')
  if (!existsSync(index)) {
    throw new Error(
      `R17_EXPECT_BUILD_DIR="${EXPECT_BUILD_DIR}" has no index.html — cannot tell ` +
      `the new deploy from a stale one, and passing without that check would be a ` +
      `false green on the run that exists to catch a bad deploy`
    )
  }
  const fingerprint = buildFingerprint(readFileSync(index, 'utf8'))
  if (fingerprint.length === 0) {
    throw new Error(
      `${index} references no content-hashed /assets/ file — nothing to identify ` +
      `this build by`
    )
  }
  return fingerprint
}

const EXPECTED = expectedFingerprint()

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
 * @returns {{fatal?: {code: number, message: string}, stale?: string,
 *            httpFailures: string[], networkErrors: string[],
 *            assetCount: number, notes: string[]}}
 *   `stale` is set when the origin is still serving a build other than the one
 *   we published — never a pass and never a failure on its own, only a reason
 *   to wait.
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

  // Identity first: assert we are looking at the build we published before
  // asserting anything *about* it. A stale build is usually healthy, so every
  // check below would pass against the wrong bytes and report a green deploy.
  if (servesExpectedBuild(html, EXPECTED) === false) {
    const servedAssets = referencedAssets(html)
      .map(u => u.replace(ORIGIN, ''))
      .filter(u => /\/assets\//.test(u))
    return done({
      stale: `serving ${servedAssets.join(', ') || '(no hashed assets)'}; ` +
        `expected one of ${EXPECTED.join(', ')}`,
    })
  }

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

// --- driver: settle until the expected build is live, then assert -----------
console.log(`R-17 live base-path smoke — ${PAGE}`)
if (EXPECTED.length > 0) {
  console.log(`  expecting the build that references ${EXPECTED.join(', ')}`)
}

/**
 * Is this pass the answer, or is it worth waiting for a different one?
 *
 * Only two things are worth waiting for, and stating them positively is the
 * whole #620 fix. The first version waited on "did anything fail", which let a
 * healthy *stale* build end the loop green — the new deploy never looked at.
 *
 *   stale          → keep waiting. We are looking at the previous build; any
 *                    verdict from it would be about the wrong bytes.
 *   network-only   → keep waiting. Nothing answered; that is not evidence.
 *   http failures  → THE ANSWER. Identity is confirmed, so a 404 here is the
 *                    published build being broken, and re-checking it for five
 *                    more minutes only delays the alarm.
 *   fatal / clean  → THE ANSWER.
 */
const isSettled = r => {
  if (r.stale) return false
  if (r.fatal) return true
  if (r.httpFailures.length > 0) return true
  return r.networkErrors.length === 0
}

const { result } = await settle({
  runOnce: runCheck,
  isSettled,
  attempts: SETTLE_ATTEMPTS,
  delayMs: SETTLE_DELAY_MS,
  // Say what is actually wrong on each attempt, not just how many things are
  // (#620 review, Farah F3): "still the old build" and "the new build is
  // broken" are different incidents and must not look identical in the log.
  onRetry: ({ attempt, attempts, result: r, delayMs }) => {
    const why = r.stale
      ? `not the published build yet — ${r.stale}`
      : r.fatal
        ? r.fatal.message.split('\n')[0]
        : [...r.httpFailures, ...r.networkErrors].slice(0, 3).join('; ')
    console.log(
      `  … attempt ${attempt}/${attempts}: ${why}` +
      ` — retrying in ${Math.round(delayMs / 1000)}s`
    )
  },
})
for (const note of result.notes) console.warn(`  ⚠ ${note}`)

// Settle exhausted while still on the old build: we never got to look at what
// we published. That is inconclusive, not a verdict — exit 2 ("could not run"),
// because calling it either way would be a claim we have no evidence for.
if (result.stale) {
  const windowMin = Math.round((SETTLE_ATTEMPTS - 1) * SETTLE_DELAY_MS / 60000)
  console.error(
    `\n✗ check could not run — ${PAGE} never served the build this run published, ` +
    `after ${SETTLE_ATTEMPTS} attempt(s) over ~${windowMin} min.\n` +
    `    ${result.stale}\n\n` +
    '  GitHub Pages propagation overran the settle window. This says nothing\n' +
    '  about whether the new build is correct — re-run the check, or widen\n' +
    '  R17_SETTLE_ATTEMPTS, before drawing any conclusion about the site.'
  )
  process.exit(2)
}

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
    (EXPECTED.length > 0
      ? `  This IS the build this run published (identity confirmed), so the\n` +
        `  fault is in the build, not in propagation.\n`
      : `  First hypothesis to rule out: GitHub Pages may still be serving a\n` +
        `  previous build — compare the 404'd asset hashes against this run's\n` +
        `  dist/, or re-run with R17_EXPECT_BUILD_DIR set.\n`) +
    `  Otherwise SITE_BASE_PATH (newsletter/app/src/config/site.ts) no longer\n` +
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
  `✓ ${EXPECTED.length > 0 ? 'the published build is live; ' : ''}` +
  `shell, ${assetCount} asset(s) (incl. SW precache shell + manifest icons) ` +
  `and the deep-link round trip all load from ${PAGE}`
)
