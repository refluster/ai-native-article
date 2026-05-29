/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GA_ID?: string;
  readonly VITE_COGNITO_USER_POOL_ID?: string;
  readonly VITE_COGNITO_CLIENT_ID?: string;
  readonly VITE_COGNITO_DOMAIN?: string;
  readonly VITE_WORKFORCE_AGENTS_API_BASE?: string;
  readonly VITE_WORKFORCE_CREDENTIALS_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
