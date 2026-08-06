import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_QUERY_PARAM,
  resolveLanguage,
  storeLanguage,
  type Language,
} from './language'
import { translate, type MessageKey } from './messages'

interface LanguageContextValue {
  language: Language
  /** Manual switch. Persists to localStorage and updates `?lang=` in place. */
  setLanguage: (next: Language) => void
  /** Message lookup for the active language. */
  t: (key: MessageKey) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

/**
 * Provides the reader's language to the tree.
 *
 * Initialised synchronously from `resolveLanguage` so the first paint is
 * already in the right language — a post-mount correction would flash Japanese
 * at an English reader on every navigation.
 *
 * Sits *outside* the router (see App.tsx): the language is a property of the
 * reader, not of the route, and every route needs it.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window === 'undefined') return DEFAULT_LANGUAGE
    return resolveLanguage({
      search: window.location.search,
      storage: window.localStorage,
      navigatorLanguages: window.navigator.languages ?? [window.navigator.language],
    })
  })

  // Keep the document in sync so assistive tech, the browser's own translation
  // prompt, and `:lang()` styling all agree with what is on screen.
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next)
    storeLanguage(typeof window === 'undefined' ? undefined : window.localStorage, next)

    // Keep `?lang=` truthful when it is present, so copying the URL after
    // switching shares the edition the reader is actually looking at. We do
    // not *add* the param — an untouched URL stays clean.
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (url.searchParams.has(LANGUAGE_QUERY_PARAM)) {
      url.searchParams.set(LANGUAGE_QUERY_PARAM, next)
      window.history.replaceState(null, '', url.toString())
    }
  }, [])

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      t: (key: MessageKey) => translate(language, key),
    }),
    [language, setLanguage],
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used inside <LanguageProvider>')
  return ctx
}
