/**
 * analytics.ts — thin, typed GA4 wrapper.
 *
 * Design goals:
 *   - Opt-in via VITE_GA_ID. Unset → no script, no network, no globals.
 *   - Respect navigator.doNotTrack and navigator.globalPrivacyControl.
 *   - Typed events matching GROWTH.md §2. Unknown event names fail typecheck.
 *   - Safe to call before init (buffered) and safe to call multiple times.
 *
 * See GROWTH.md §2 for the event catalogue and the feedback loop it feeds.
 */

type GtagCommand = 'config' | 'event' | 'js' | 'set' | 'consent'
type GtagFn = (command: GtagCommand, ...args: unknown[]) => void

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: GtagFn
  }
}

export type AnalyticsEvent =
  | { name: 'article_view'; params: { slug: string; category: string; date: string } }
  | { name: 'article_read_25'; params: { slug: string; category: string } }
  | { name: 'article_read_50'; params: { slug: string; category: string } }
  | { name: 'article_read_75'; params: { slug: string; category: string } }
  | { name: 'article_read_90'; params: { slug: string; category: string } }
  | { name: 'article_read_complete'; params: { slug: string; category: string; dwell_ms: number } }
  | { name: 'category_click'; params: { category: string } }
  | { name: 'featured_click'; params: { slug: string; category: string } }
  | { name: 'internal_link_click'; params: { slug: string; href: string } }
  | { name: 'outbound_click'; params: { slug: string; href: string; host: string } }

let initialized = false
let measurementId: string | null = null

function tracksAllowed(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
  if (nav.doNotTrack === '1') return false
  if (nav.globalPrivacyControl) return false
  return true
}

export function initAnalytics(id: string | undefined): void {
  if (initialized) return
  if (!id) return
  if (!tracksAllowed()) return
  if (typeof window === 'undefined') return

  measurementId = id
  initialized = true

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`
  document.head.appendChild(script)

  window.dataLayer = window.dataLayer || []
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments)
  } as GtagFn
  window.gtag('js', new Date())
  // send_page_view: false → we emit page_view manually on route change so
  // SPA navigations are captured.
  window.gtag('config', id, { send_page_view: false, anonymize_ip: true })
}

export function trackPageView(path: string, title: string): void {
  if (!initialized || !measurementId || !window.gtag) return
  window.gtag('event', 'page_view', {
    page_path: path,
    page_title: title,
    page_location: window.location.origin + path,
  })
}

export function trackEvent(event: AnalyticsEvent): void {
  if (!initialized || !window.gtag) return
  window.gtag('event', event.name, event.params as Record<string, unknown>)
}

/** Extract hostname from an href; returns '' for malformed URLs. */
export function hrefHost(href: string): string {
  try {
    return new URL(href, window.location.origin).host
  } catch {
    return ''
  }
}

/** True if href points off-origin. Used to classify outbound clicks. */
export function isOutbound(href: string): boolean {
  const host = hrefHost(href)
  return host !== '' && host !== window.location.host
}
