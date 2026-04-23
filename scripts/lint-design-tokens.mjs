#!/usr/bin/env node
/**
 * lint-design-tokens.mjs
 *
 * Enforces the design-system rules from DESIGN.md that cost the most when
 * violated silently:
 *   1. No raw hex colors in src/ — tokens live in tailwind.config.ts.
 *   2. No rounded-[px] or rounded-(sm|md|lg|xl|2xl|3xl) classes — the system
 *      is 0px radius. `rounded-full` is allowed for pills/avatars.
 *
 * Exits 1 on violation so CI blocks the merge. See AGENTS.md §2.3.
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')

// Files that legitimately reference hex — the token surface itself.
// Relative to repo root.
const ALLOWLIST = new Set([
  'src/config/site.ts',
  'src/index.css',
])

// Colour tokens on the DesignSystem/DesignGuide pages are demonstrating the
// palette itself; inline hex is expected there.
const PALETTE_DEMO_FILES = new Set([
  'src/pages/DesignSystem.tsx',
  'src/pages/DesignGuide.tsx',
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

    const rel = relative(ROOT, p)
    if (ALLOWLIST.has(rel)) continue

    const text = readFileSync(p, 'utf8')

    // Rule 1 — no raw hex (skip palette demo files).
    if (!PALETTE_DEMO_FILES.has(rel)) {
      const hex = text.match(HEX_RE)
      if (hex) {
        violations += hex.length
        console.error(`  ✗ ${rel}: raw hex → ${[...new Set(hex)].join(', ')}`)
      }
    }

    // Rule 2 — no non-zero rounded (always enforced).
    const rounded = text.match(ROUNDED_RE)
    if (rounded) {
      violations += rounded.length
      console.error(`  ✗ ${rel}: non-zero border-radius → ${[...new Set(rounded)].join(', ')}`)
    }
  }
}

console.log('Linting design tokens in src/ …')
walk(SRC)

if (violations > 0) {
  console.error(`\n❌ ${violations} design-token violation(s). See DESIGN.md and AGENTS.md §2.3.`)
  process.exit(1)
}
console.log('✅ No violations.')
