// Single-source reader for the article site's base path.
//
// `newsletter/app/src/config/site.ts` is the authority: it is what
// vite.config.ts feeds to `base`, and what lib/paths.ts feeds to
// BrowserRouter's `basename`. Node-side tooling (the sitemap generator, the
// R-16 gate) cannot import a .ts module, and PR #606 showed what happens when
// it copies the value instead: the two drifted, and the deployed HTML pointed
// every asset at a path GitHub Pages does not serve there. So we read the
// literal out of site.ts rather than restating it.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export const SITE_CONFIG_PATH = resolve(
  ROOT, 'newsletter', 'app', 'src', 'config', 'site.ts'
)

const DECL = /^\s*export\s+const\s+SITE_BASE_PATH\s*=\s*['"]([^'"]*)['"]/m

/**
 * Extract SITE_BASE_PATH from site.ts source.
 * Always returns a value with a leading and trailing slash ('/' for root).
 * @param {string} source contents of site.ts
 */
export function parseSiteBasePath (source) {
  const m = DECL.exec(source)
  if (!m) {
    throw new Error('SITE_BASE_PATH declaration not found in site.ts')
  }
  const value = m[1]
  if (!value.startsWith('/') || !value.endsWith('/')) {
    throw new Error(
      `SITE_BASE_PATH must start and end with "/" (got ${JSON.stringify(value)})`
    )
  }
  return value
}

/** Read SITE_BASE_PATH from the repo's site.ts. e.g. '/ai-native-article/' */
export function readSiteBasePath (file = SITE_CONFIG_PATH) {
  return parseSiteBasePath(readFileSync(file, 'utf8'))
}

/** The base path without its trailing slash — '' when the site is at root. */
export function readSiteBaseName (file = SITE_CONFIG_PATH) {
  return readSiteBasePath(file).replace(/\/$/, '')
}
