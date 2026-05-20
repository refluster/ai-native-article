/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google Analytics 4 measurement ID. Unset → analytics is a no-op. */
  readonly VITE_GA_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
