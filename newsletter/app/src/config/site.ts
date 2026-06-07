export const SITE_BASE_PATH = '/ai-native-article/'

export const SITE_BASENAME = SITE_BASE_PATH.replace(/\/$/, '')

// External origin where the workforce console lives, served by the
// CloudFront distribution that PR-B provisions. Article-side byline
// chips and the header nav cross-link to this origin in a new tab.
// Hardcoded rather than env-driven because the workforce origin is
// stable per the C-3 single-operator constraint (one domain, one site).
export const WORKFORCE_BASE_URL = 'https://workforce.kohuehara.xyz'
