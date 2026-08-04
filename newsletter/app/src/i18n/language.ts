/**
 * language.ts — the reader's language, and how it is decided.
 *
 * Resolution order (first hit wins):
 *   1. `?lang=` on the URL — an explicit, shareable override. Also what the
 *      `hreflang` alternates point at, so a crawler or a shared link lands in
 *      the right edition without a redirect.
 *   2. `localStorage["kohuehara.lang"]` — the reader's last manual choice.
 *      Sticky across visits; that is the whole point of storing it.
 *   3. `navigator.languages` — the browser's own preference list, scanned in
 *      order for the first entry that is Japanese or English.
 *   4. `'en'` — a browser that asks for neither reads English. The site is
 *      written Japanese-first, but a reader whose browser never mentions
 *      Japanese is the one who needs the translation.
 *
 * Deliberately *not* a route. Article URLs are a promise to readers
 * (AGENTS.md §3) and adding `/en/...` would break every existing referrer and
 * every link already shared. One article, one canonical URL, two editions.
 */

export const LANGUAGES = ['ja', 'en'] as const

export type Language = (typeof LANGUAGES)[number]

export const DEFAULT_LANGUAGE: Language = 'ja'

/** localStorage key holding the reader's manual choice. */
export const LANGUAGE_STORAGE_KEY = 'kohuehara.lang'

/** Query parameter carrying an explicit per-URL override. */
export const LANGUAGE_QUERY_PARAM = 'lang'

export function isLanguage(value: unknown): value is Language {
  return value === 'ja' || value === 'en'
}

/** Primary subtag of a BCP-47 tag, lowercased: `en-GB` → `en`, `ja` → `ja`. */
function primarySubtag(tag: string): string {
  return tag.toLowerCase().split('-')[0]
}

/**
 * First Japanese-or-English entry in the browser's preference list.
 * Returns null when the browser asks for neither, so the caller can apply its
 * own fallback rather than guessing here.
 */
export function languageFromNavigator(tags: readonly string[]): Language | null {
  for (const tag of tags) {
    const primary = primarySubtag(tag)
    if (primary === 'ja' || primary === 'en') return primary
  }
  return null
}

/** Safe localStorage read — Safari private mode throws on access. */
export function readStoredLanguage(storage: Storage | undefined): Language | null {
  try {
    const stored = storage?.getItem(LANGUAGE_STORAGE_KEY)
    return isLanguage(stored) ? stored : null
  } catch {
    return null
  }
}

/** Safe localStorage write — never let a storage failure break the toggle. */
export function storeLanguage(storage: Storage | undefined, language: Language): void {
  try {
    storage?.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    /* private mode / quota — the in-memory choice still applies for this visit */
  }
}

export interface ResolveInput {
  /** `window.location.search` */
  search?: string
  storage?: Storage
  /** `navigator.languages` (or `[navigator.language]`) */
  navigatorLanguages?: readonly string[]
}

/**
 * Decide the reader's language. Pure: everything it reads is passed in, so the
 * order above is testable without a browser.
 */
export function resolveLanguage(input: ResolveInput = {}): Language {
  const { search = '', storage, navigatorLanguages = [] } = input

  const fromQuery = new URLSearchParams(search).get(LANGUAGE_QUERY_PARAM)
  if (isLanguage(fromQuery)) return fromQuery

  const stored = readStoredLanguage(storage)
  if (stored) return stored

  // No explicit choice on record — follow the browser, and treat "asks for
  // neither" as a reader who cannot read the Japanese edition.
  return languageFromNavigator(navigatorLanguages) ?? 'en'
}
