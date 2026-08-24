// Where GitHub Pages actually serves this build.
//
// `kohuehara.xyz` is the custom domain of the *user* site repo
// (refluster.github.io — the personal "Koh Uehara" page). A custom domain can
// only be claimed by one repo, so this repo keeps its GitHub Pages *project*
// URL and is served, under that same domain, at the repo-name subpath:
//
//   https://refluster.github.io/ai-native-article/  -> 301
//   https://kohuehara.xyz/ai-native-article/        -> this app  (assets 200)
//   https://kohuehara.xyz/                          -> the user site (CRA)
//
// PR #606 set this to '/' on the premise that the `cname: kohuehara.xyz` in
// deploy-article-site.yml makes Pages serve this build from the domain root.
// It does not — GitHub rejects the duplicate custom-domain claim — so every
// asset reference in the deployed HTML pointed at the user site's origin path
// and 404'd (index-*.js, index-*.css, manifest.webmanifest, and the sw.js
// `addAll` of the app shell). That is the C-1 outage this constant now fixes.
//
// Moving the site to the domain root is a repo-Settings + DNS decision that
// takes the apex away from the personal page (issue #600, still open on the
// operator's side). When it happens, flip this one constant to '/': every
// other base-path literal in the app is either derived from it or asserted
// against it by `scripts/check-base-path.mjs` (R-16).
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
