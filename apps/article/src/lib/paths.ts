import { SITE_BASE_PATH, SITE_BASENAME } from '../config/site'

export function withBasePath(path: string) {
  return `${SITE_BASE_PATH}${path.replace(/^\/+/, '')}`
}

export function routerBaseName() {
  return SITE_BASENAME
}
