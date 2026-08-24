import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkUrl, checkHtml, checkManifest, checkServiceWorker, checkRobots,
  extractHtmlUrls, extractShellUrls, extractCachesMatchUrls, extractSpaBase,
} from './base-path-literals.mjs'

const SUB = '/ai-native-article/'
const ROOT = '/'

// --- checkUrl: the directional rule (Dario D1 / Owen O1) --------------------

test('accepts a URL under the subpath base', () => {
  assert.equal(checkUrl('/ai-native-article/icons/icon-192.png', SUB, 'x'), null)
})

test('rejects a root-absolute URL outside the subpath base', () => {
  assert.match(checkUrl('/icons/icon-192.png', SUB, 'x'), /is not under SITE_BASE_PATH/)
})

test('rejects a stale project-path literal once the base is the domain root', () => {
  // The regression the "flip one constant to /" migration would otherwise ship:
  // prefix containment alone is vacuous at base '/', so this must be caught by
  // the repeated-segment rule, not by the startsWith test.
  assert.match(
    checkUrl('/ai-native-article/index.html', ROOT, 'x'),
    /repeats the base segment/
  )
})

test('rejects a doubled base prefix', () => {
  assert.match(
    checkUrl('/ai-native-article/ai-native-article/index.html', SUB, 'x'),
    /repeats the base segment/
  )
})

test('accepts a clean root-absolute URL at the domain root base', () => {
  assert.equal(checkUrl('/index.html', ROOT, 'x'), null)
})

test('ignores cross-origin and protocol-relative URLs', () => {
  assert.equal(checkUrl('https://fonts.googleapis.com/css2', SUB, 'x'), null)
  assert.equal(checkUrl('//cdn.example.com/a.js', SUB, 'x'), null)
})

test('exempts the vite source entry', () => {
  assert.equal(checkUrl('/src/main.tsx', SUB, 'x'), null)
})

// --- extractors are quote-agnostic and report what they found (Owen O2) -----

test('extracts html urls written with either quote style', () => {
  const src = `<link href="/a/x.css" /><script src='/a/y.js'></script>`
  assert.deepEqual(extractHtmlUrls(src), ['/a/x.css', '/a/y.js'])
})

test('extracts the SPA base with either quote style', () => {
  assert.equal(extractSpaBase(`var base = "/a/";`), '/a/')
  assert.equal(extractSpaBase(`var base = '/a/';`), '/a/')
  assert.equal(extractSpaBase('var other = 1'), null)
})

test('extracts shell urls with either quote style', () => {
  const src = `const SHELL = [\n  '/a/',\n  "/a/index.html",\n]`
  assert.deepEqual(extractShellUrls(src), ['/a/', '/a/index.html'])
})

test('returns null when there is no SHELL array at all', () => {
  assert.equal(extractShellUrls('const OTHER = []'), null)
})

test('extracts caches.match urls with either quote style', () => {
  const src = `caches.match('/a/index.html'); caches.match("/a/offline.html")`
  assert.deepEqual(extractCachesMatchUrls(src), ['/a/index.html', '/a/offline.html'])
})

// --- per-file checks --------------------------------------------------------

test('checkHtml flags a mismatched SPA base and reports the urls it saw', () => {
  const src = `<link href="/ai-native-article/x.css" /><script>var base = '/';</script>`
  const { urls, problems } = checkHtml(src, SUB, { requireSpaBase: true })
  assert.deepEqual(urls, ['/ai-native-article/x.css'])
  assert.equal(problems.length, 1)
  assert.match(problems[0], /SPA redirect base "\/" !== SITE_BASE_PATH/)
})

test('checkHtml demands the SPA base when the file is supposed to carry one', () => {
  const { problems } = checkHtml('<p>no scripts</p>', SUB, { requireSpaBase: true })
  assert.match(problems[0], /SPA redirect .* not found/)
})

test('checkManifest flags start_url, scope, icons and share_target', () => {
  const { problems } = checkManifest({
    start_url: '/', scope: '/',
    icons: [{ src: '/icons/icon-192.png' }],
    share_target: { action: '/l1-register' },
  }, SUB)
  assert.equal(problems.length, 4)
})

test('checkManifest passes a correctly based manifest', () => {
  const { problems } = checkManifest({
    start_url: SUB, scope: SUB,
    icons: [{ src: '/ai-native-article/icons/icon-192.png' }],
    share_target: { action: '/ai-native-article/l1-register' },
  }, SUB)
  assert.deepEqual(problems, [])
})

test('checkServiceWorker flags a stale shell url and the offline fallback', () => {
  const src = `const SHELL = [\n  '/',\n  '/index.html',\n]\ncaches.match('/index.html')`
  const { problems } = checkServiceWorker(src, SUB)
  assert.equal(problems.length, 3)
})

test('checkServiceWorker reports a missing SHELL array rather than passing', () => {
  const { problems } = checkServiceWorker('const OTHER = []', SUB)
  assert.deepEqual(problems, ['precache SHELL array not found'])
})

test('checkServiceWorker reports an empty SHELL array', () => {
  const { problems } = checkServiceWorker('const SHELL = [\n]', SUB)
  assert.deepEqual(problems, ['precache SHELL is empty'])
})

test('checkRobots compares the absolute sitemap url', () => {
  const ok = checkRobots(
    'Sitemap: https://x.test/ai-native-article/sitemap.xml\n', SUB, 'https://x.test')
  assert.deepEqual(ok.problems, [])
  const bad = checkRobots('Sitemap: https://x.test/sitemap.xml\n', SUB, 'https://x.test')
  assert.equal(bad.problems.length, 1)
  const none = checkRobots('User-agent: *\n', SUB, 'https://x.test')
  assert.deepEqual(none.problems, ['no Sitemap: line'])
})
