// Workforce app paths helper. Mirrors apps/article/src/lib/paths.ts in
// shape but uses the workforce SITE_BASE_PATH, which defaults to '/' so
// CloudFront serves the SPA at the apex of workforce.kohuehara.xyz.

import { SITE_BASE_PATH, SITE_BASENAME } from '../config/site';

export function withBasePath(path: string): string {
  return `${SITE_BASE_PATH}${path.replace(/^\/+/, '')}`;
}

export function routerBaseName(): string {
  return SITE_BASENAME;
}
