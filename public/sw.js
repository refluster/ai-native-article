// Minimal service worker to meet PWA install criteria and enable offline shell.
// Cache is bumped via CACHE_VERSION; bump it whenever the shell changes.
const CACHE_VERSION = 'v1'
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
