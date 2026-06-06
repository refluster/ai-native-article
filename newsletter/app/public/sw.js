// Minimal service worker to meet PWA install criteria and enable offline shell.
// Cache is bumped via CACHE_VERSION; bump it whenever the shell changes.
const CACHE_VERSION = 'v3'
const CACHE_NAME = `ai-native-l1-${CACHE_VERSION}`
const SHELL = [
  '/ai-native-article/',
  '/ai-native-article/index.html',
  '/ai-native-article/manifest.webmanifest',
  '/ai-native-article/icons/icon-192.png',
  '/ai-native-article/icons/icon-512.png',
  '/ai-native-article/icons/apple-touch-icon.png',
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

// Network-first for navigation (so new deploys land immediately when online),
// cache fallback when offline. Cache-first for static asset GETs.
self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy))
          return response
        })
        .catch(() => caches.match(request).then(r => r || caches.match('/ai-native-article/index.html')))
    )
    return
  }

  const url = new URL(request.url)
  if (url.origin === self.location.origin) {
    // Network-first for data that can change between deploys without a new
    // hashed filename: post data (manifest + .md + images) so new L4 publishes
    // land immediately, and the byline manifest (/workforce-agents.json) so a
    // newly added or renamed agent resolves to its name + role instead of
    // falling back to the bare slug.
    //
    // workforce-agents.json MUST NOT be cache-first: its URL is constant across
    // deploys, so a once-cached copy is served until CACHE_VERSION bumps. If a
    // visitor's first request for it predated the file existing, the SPA host
    // answered with the index.html shell (HTTP 200) and cache-first stored that
    // HTML under the JSON URL — every later findAuthor() then JSON-parses HTML,
    // throws, and AuthorChip renders the raw slug (e.g. "elena" instead of
    // "Elena Singh — VP Customer Experience"). Network-first revalidates on
    // every load and only falls back to cache when offline.
    const isFreshData =
      url.pathname.includes('/posts/') ||
      url.pathname.endsWith('/workforce-agents.json')
    if (isFreshData) {
      event.respondWith(
        fetch(request)
          .then(response => {
            if (response.ok) {
              const copy = response.clone()
              caches.open(CACHE_NAME).then(cache => cache.put(request, copy))
            }
            return response
          })
          .catch(() => caches.match(request))
      )
      return
    }

    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy))
        }
        return response
      }))
    )
  }
})
