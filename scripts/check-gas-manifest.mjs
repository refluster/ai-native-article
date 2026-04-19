#!/usr/bin/env node
// Fails if the repo contains more than one appsscript.json, or if the
// canonical gas/appsscript.json is missing.
//
// Background: .clasp.json sets rootDir="gas", so `clasp push` uploads
// gas/appsscript.json. A stray appsscript.json elsewhere (especially at
// the repo root) is a trap: edits to it look authoritative but never
// reach Google, and the script silently keeps running with the old
// manifest. This guard runs before `npm run push-gas`.
import { readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CANONICAL = 'gas/appsscript.json'
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.claude', 'skills'])

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const rel = relative(repoRoot, full)
    if (SKIP_DIRS.has(entry)) continue
    const st = statSync(full)
    if (st.isDirectory()) yield* walk(full)
    else if (entry === 'appsscript.json') yield rel
  }
}

const found = [...walk(repoRoot)]

if (!existsSync(join(repoRoot, CANONICAL))) {
  console.error(`[check-gas-manifest] missing canonical manifest: ${CANONICAL}`)
  process.exit(1)
}

const strays = found.filter(p => p !== CANONICAL)
if (strays.length > 0) {
  console.error(`[check-gas-manifest] extra appsscript.json found — only ${CANONICAL} is authoritative:`)
  for (const p of strays) console.error(`  - ${p}`)
  console.error('\nclasp pushes from gas/ (rootDir in .clasp.json). A second manifest elsewhere')
  console.error('silently does nothing and can hide scope/timezone changes from reaching GAS.')
  process.exit(1)
}

console.log(`[check-gas-manifest] ok — ${CANONICAL} is the only manifest`)
