export const SITE_BASE_PATH = '/ai-native-article/'

export const SITE_BASENAME = SITE_BASE_PATH.replace(/\/$/, '')

// External origin where the workforce console lives, served by the
// CloudFront distribution that PR-B provisions. Article-side byline
// chips and the header nav cross-link to this origin in a new tab.
// Hardcoded rather than env-driven because the workforce origin is
// stable per the C-3 single-operator constraint (one domain, one site).
export const WORKFORCE_BASE_URL = 'https://workforce.kohuehara.xyz'

// Figure (mermaid) theme tokens — the DESIGN.md palette mirrored for code
// that must emit literal colors (mermaid writes SVG attributes, so Tailwind
// classes can't reach it). This file is a sanctioned token surface for
// lint-design-tokens.mjs; keep values in lockstep with tailwind.config.ts.
export const FIGURE_TOKENS = {
  ink: '#2d3338', // on-surface
  inkVariant: '#596065', // on-surface-variant
  line: '#5e5e5e', // primary
  grid: '#acb3b8', // outline-variant
  gridStrong: '#757c81', // outline
  surface: '#f9f9fb', // surface
  figureSurface: '#f2f4f6', // surface-container-low — the figure block
  raised: '#dde3e9', // surface-container-highest
  lowest: '#ffffff', // surface-container-lowest
  accent: '#c1000a', // tertiary
  onDark: '#f8f8f8', // on-primary
} as const

// Categorical series palette, fixed order (never cycled): ink first,
// tertiary red as the second "surgical" accent, then grays by descending
// lightness. Adjacent-pair CVD separation validated at ΔE ≥ 17; the two
// lightest slots are legal because pie always renders a legend and labels.
export const FIGURE_CATEGORICAL = [
  FIGURE_TOKENS.ink,
  FIGURE_TOKENS.accent,
  FIGURE_TOKENS.gridStrong,
  FIGURE_TOKENS.grid,
  FIGURE_TOKENS.raised,
] as const
