// Pure base-path literal checks, over source strings.
//
// Extracted from scripts/check-base-path.mjs (R-16) so the red path is
// testable: on #619 review, `check-base-path.mjs` had no test file and both of
// its extractors were silently quote-sensitive, so a reformat of sw.js or
// index.html would have turned those checks into green no-ops (Owen O2). Every
// extractor here therefore reports how many URLs it found, and the caller
// fails when a file it was told to inspect yields none.
//
// Each `check*` returns a `{ urls, problems }` pair; `problems` is a list of
// human-readable strings. No I/O, no process.exit — that is the script's job.

/** A URL that is ours to place: root-absolute, not protocol-relative. */
export function isLocalAbsolute (url) {
  return url.startsWith('/') && !url.startsWith('//')
}

// `/src/...` is the Vite *source* graph, not a shipped URL: vite build bundles
// the entry and rewrites the emitted <script src> against `base`. It must stay
// project-root-relative for `vite dev` to resolve it, so it is exempt.
const VITE_SOURCE = /^\/src\//

/**
 * The repo's GitHub Pages *project* path — the repo name as a path segment.
 * Only two values of SITE_BASE_PATH are legal: this, or '/' (the domain root,
 * if the apex is ever moved to this repo). Knowing both is what makes the
 * check directional: at either base, a literal carrying the *other* base's
 * prefix is drift, and a prefix-containment test alone cannot see that.
 * At BASE='/' every root-absolute URL "starts with" BASE, so without this the
 * gate is vacuous in exactly the configuration that caused the #606 outage.
 */
export const PAGES_PROJECT_SEGMENT = 'ai-native-article'

/**
 * Verify one URL sits under `base` — and only under `base`.
 * @returns {string|null} a problem description, or null when the URL is fine.
 */
export function checkUrl (url, base, where) {
  if (!isLocalAbsolute(url)) return null
  if (VITE_SOURCE.test(url)) return null
  if (!url.startsWith(base)) {
    return `${where} "${url}" is not under SITE_BASE_PATH "${base}"`
  }
  // Directional half: whatever follows the base must not itself begin with a
  // base prefix. Catches a stale '/ai-native-article/...' left behind after a
  // flip to '/', and a doubled '/ai-native-article/ai-native-article/...'.
  const rest = url.slice(base.length)
  if (rest === PAGES_PROJECT_SEGMENT || rest.startsWith(`${PAGES_PROJECT_SEGMENT}/`)) {
    return `${where} "${url}" repeats the base segment "${PAGES_PROJECT_SEGMENT}" after SITE_BASE_PATH "${base}"`
  }
  return null
}

/** Every href/src in an HTML source, single or double quoted. */
export function extractHtmlUrls (source) {
  return [...source.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/g)].map(m => m[1])
}

/** The GitHub Pages SPA-redirect base literal, single or double quoted. */
export function extractSpaBase (source) {
  const m = /\bvar\s+base\s*=\s*["']([^"']*)["']/.exec(source)
  return m ? m[1] : null
}

/** The precache SHELL array's URLs, single or double quoted. */
export function extractShellUrls (source) {
  const block = /const SHELL = \[([\s\S]*?)\]/.exec(source)
  if (!block) return null
  return [...block[1].matchAll(/["']([^"']+)["']/g)].map(m => m[1])
}

/** Offline-fallback `caches.match('…')` URLs, single or double quoted. */
export function extractCachesMatchUrls (source) {
  return [...source.matchAll(/caches\.match\(\s*["']([^"']+)["']\s*\)/g)].map(m => m[1])
}

export function checkHtml (source, base, { requireSpaBase }) {
  const problems = []
  const urls = extractHtmlUrls(source)
  for (const url of urls) {
    const p = checkUrl(url, base, 'asset URL')
    if (p) problems.push(p)
  }
  // The GitHub Pages SPA redirect pair: 404.html stashes the requested URL and
  // bounces to `base`; index.html restores it. A wrong `base` here sends every
  // deep link to whatever else lives at that path.
  const spa = extractSpaBase(source)
  if (spa === null) {
    if (requireSpaBase) problems.push("SPA redirect `var base = '...'` not found")
  } else if (spa !== base) {
    problems.push(`SPA redirect base "${spa}" !== SITE_BASE_PATH "${base}"`)
  }
  return { urls, problems }
}

export function checkManifest (manifest, base) {
  const problems = []
  const urls = []
  // start_url/scope decide what an installed PWA opens and what it may
  // navigate to; a root scope on a subpath deploy makes the install silently
  // wrong rather than loudly broken.
  for (const key of ['start_url', 'scope']) {
    if (manifest[key] === undefined) problems.push(`missing "${key}"`)
    else if (manifest[key] !== base) {
      problems.push(`"${key}": "${manifest[key]}" !== SITE_BASE_PATH "${base}"`)
    }
  }
  for (const icon of manifest.icons ?? []) {
    const url = icon.src ?? ''
    urls.push(url)
    const p = checkUrl(url, base, 'icon src')
    if (p) problems.push(p)
  }
  const action = manifest.share_target?.action
  if (action !== undefined) {
    urls.push(action)
    const p = checkUrl(action, base, 'share_target action')
    if (p) problems.push(p)
  }
  return { urls, problems }
}

export function checkServiceWorker (source, base) {
  const problems = []
  const shell = extractShellUrls(source)
  if (shell === null) return { urls: [], problems: ['precache SHELL array not found'] }
  if (shell.length === 0) problems.push('precache SHELL is empty')
  // install fails atomically: one 404 in addAll() rejects the whole install,
  // so a single stale shell URL disables the service worker entirely.
  for (const url of shell) {
    const p = checkUrl(url, base, 'precached shell URL')
    if (p) problems.push(p)
  }
  const fallbacks = extractCachesMatchUrls(source)
  for (const url of fallbacks) {
    const p = checkUrl(url, base, 'offline fallback URL')
    if (p) problems.push(p)
  }
  return { urls: [...shell, ...fallbacks], problems }
}

export function checkRobots (source, base, origin) {
  const m = /^Sitemap:\s*(\S+)/m.exec(source)
  if (!m) return { urls: [], problems: ['no Sitemap: line'] }
  const expected = `${origin}${base}sitemap.xml`
  return {
    urls: [m[1]],
    problems: m[1] === expected ? [] : [`Sitemap: "${m[1]}" !== "${expected}"`],
  }
}

/**
 * The hashed asset URLs a built `index.html` references — the fingerprint of
 * one specific build.
 *
 * R-17 uses this to tell "the new deploy is live" from "GitHub Pages is still
 * serving the previous one". Without it a post-deploy check cannot distinguish
 * them: the stale build answers 200 and is usually internally consistent, so
 * every assertion passes against the wrong bytes (#620 review, Farah F1 /
 * Dario D1).
 *
 * Only content-hashed asset URLs count. Unhashed public files
 * (manifest.webmanifest, icons) are identical across builds and so carry no
 * identity; a build with none of them is not fingerprintable.
 */
export function buildFingerprint (indexHtml) {
  const hashed = new Set()
  for (const url of extractHtmlUrls(indexHtml)) {
    if (/\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.(?:js|css)(?:\?|$)/.test(url)) hashed.add(url)
  }
  return [...hashed]
}

/**
 * Does the served shell come from the build we expect?
 * `expected` is a fingerprint from buildFingerprint(); an empty one means
 * "no expectation given", which is not evidence either way.
 */
export function servesExpectedBuild (servedHtml, expected) {
  if (expected.length === 0) return null
  const served = new Set(extractHtmlUrls(servedHtml))
  return expected.some(url => served.has(url))
}
