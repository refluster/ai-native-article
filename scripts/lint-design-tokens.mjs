#!/usr/bin/env node
/**
 * lint-design-tokens.mjs
 *
 * Enforces the design-system rules from DESIGN.md that cost the most when
 * violated silently:
 *   1. No raw hex colors in apps/*\/src — tokens live in tailwind.config.ts.
 *   2. No rounded-[px] or rounded-(sm|md|lg|xl|2xl|3xl) classes — the
 *      article system is 0px radius. `rounded-full` is allowed for pills.
 *      Workforce uses prefixed `rounded-wf-*` classes which fall through
 *      the regex below.
 *
 * Exits 1 on violation so CI blocks the merge. See AGENTS.md §2.3.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Roots to scan. the domain apps + packages/shared. Each app's index.css
// and config/site.ts are token surfaces (allowlisted hex). Workforce stores
// raw hex inside .css custom properties so SVG fill/stroke can reference
// var(--wf-svg-*) — see PR #57.
const ROOTS = [
  join(ROOT, 'newsletter', 'app', 'src'),
  join(ROOT, 'workforce', 'app', 'src'),
  join(ROOT, 'packages', 'shared', 'src'),
]

const ALLOWLIST = new Set([
  'newsletter/app/src/config/site.ts',
  'newsletter/app/src/index.css',
  'workforce/app/src/config/site.ts',
  'workforce/app/src/index.css',
])

const PALETTE_DEMO_FILES = new Set([
  'newsletter/app/src/pages/design/DesignSystem.tsx',
  'newsletter/app/src/pages/design/DesignGuide.tsx',
])

const HEX_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g
const ROUNDED_RE = /\brounded-(?:sm|md|lg|xl|2xl|3xl|\[[^\]]+\])\b/g

let violations = 0

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const s = statSync(p)
    if (s.isDirectory()) {
      walk(p)
      continue
    }
    if (!/\.(ts|tsx|css)$/.test(entry)) continue

    // Normalise path separators for cross-platform allowlist matching.
    const rel = relative(ROOT, p).split(/\\+/).join('/')
    if (ALLOWLIST.has(rel)) continue

    const text = readFileSync(p, 'utf8')

    if (!PALETTE_DEMO_FILES.has(rel)) {
      const hex = text.match(HEX_RE)
      if (hex) {
        violations += hex.length
        console.error(`  ✗ ${rel}: raw hex → ${[...new Set(hex)].join(', ')}`)
      }
    }

    const rounded = text.match(ROUNDED_RE)
    if (rounded) {
      violations += rounded.length
      console.error(`  ✗ ${rel}: non-zero border-radius → ${[...new Set(rounded)].join(', ')}`)
    }
  }
}

console.log('Linting design tokens in newsletter/app, workforce/app, and packages/*/src …')
for (const root of ROOTS) {
  if (existsSync(root)) walk(root)
}

if (violations > 0) {
  console.error(`\n❌ ${violations} design-token violation(s). See DESIGN.md and AGENTS.md §2.3.`)
  process.exit(1)
}
console.log('✅ No violations.')
