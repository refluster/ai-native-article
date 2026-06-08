#!/usr/bin/env node
// R-12 — Governance registry integrity check.
//
// The memory→lint backlog and the risk-acceptance ledger are only useful if
// they stay machine-parseable: a malformed row silently drops a finding from
// the audit trail. The backlog IS the provenance, so a broken backlog is a
// broken provenance. This gate parses both registries and fails on structural
// drift — wrong columns, ragged rows, duplicate IDs, or an unknown status
// value.
//
// Each registry table is preceded by an anchor comment that declares its
// columns:
//   <!-- registry:<name> columns: Col A | Col B | ... -->
// The check is driven by that declaration, so adding a column is a one-line
// edit in both the doc and (if it needs validating) here.
//
// Exit codes:
//   0  both registries well-formed
//   1  a structural problem was found
//   2  a registry file is missing

import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const REGISTRIES = [
  {
    name: 'memory-lint',
    file: resolve(ROOT, 'docs', 'memory-lint-backlog.md'),
    idPrefix: 'ML-',
    enums: { Status: ['watching', 'accepted', 'promoted', 'declined'] },
    integerColumns: ['Count'],
  },
  {
    name: 'risk-acceptance',
    file: resolve(ROOT, 'docs', 'risk-acceptance-ledger.md'),
    idPrefix: 'RAL-',
    enums: {},
    integerColumns: [],
  },
]

let problems = 0
const fail = msg => { console.error(`  ✗ ${msg}`); problems++ }

function parseRow (line) {
  // Split a markdown table row into trimmed cells, dropping the leading/
  // trailing empty cells produced by the bounding pipes.
  const cells = line.split('|').map(c => c.trim())
  if (cells[0] === '') cells.shift()
  if (cells[cells.length - 1] === '') cells.pop()
  return cells
}

function checkRegistry (reg) {
  console.log(`\n${reg.name} (${reg.file.replace(ROOT + '/', '')})`)
  if (!existsSync(reg.file)) {
    fail(`registry file missing: ${reg.file}`)
    return 2
  }
  const text = readFileSync(reg.file, 'utf8')

  const anchor = new RegExp(`<!--\\s*registry:${reg.name}\\s+columns:\\s*(.+?)\\s*-->`)
  const m = text.match(anchor)
  if (!m) {
    fail(`no <!-- registry:${reg.name} columns: … --> anchor found`)
    return 1
  }
  const declaredCols = m[1].split('|').map(c => c.trim())

  // Grab the markdown table that follows the anchor.
  const after = text.slice(m.index + m[0].length)
  const tableLines = after.split('\n').filter(l => l.trim().startsWith('|'))
  if (tableLines.length < 2) {
    fail('no markdown table found after the anchor')
    return 1
  }

  const header = parseRow(tableLines[0])
  if (header.length !== declaredCols.length || header.some((h, i) => h !== declaredCols[i])) {
    fail(`header ${JSON.stringify(header)} does not match declared columns ${JSON.stringify(declaredCols)}`)
  }

  // tableLines[1] is the |---|---| separator; data rows follow.
  const dataRows = tableLines.slice(2)
  if (dataRows.length === 0) fail('registry has no data rows')

  const seenIds = new Set()
  const colIndex = name => declaredCols.indexOf(name)

  for (const line of dataRows) {
    const cells = parseRow(line)
    if (cells.length !== declaredCols.length) {
      fail(`ragged row (${cells.length} cells, expected ${declaredCols.length}): ${line.slice(0, 70)}…`)
      continue
    }
    const id = cells[colIndex('ID')]
    if (!id || !id.startsWith(reg.idPrefix)) fail(`bad ID "${id}" (expected ${reg.idPrefix}NNN)`)
    if (seenIds.has(id)) fail(`duplicate ID "${id}"`)
    seenIds.add(id)

    for (const [col, allowed] of Object.entries(reg.enums)) {
      const v = cells[colIndex(col)]
      if (!allowed.includes(v)) fail(`row ${id}: ${col}="${v}" not in {${allowed.join(', ')}}`)
    }
    for (const col of reg.integerColumns) {
      const v = cells[colIndex(col)]
      if (!/^\d+$/.test(v)) fail(`row ${id}: ${col}="${v}" is not an integer`)
    }
    // No required cell may be empty.
    cells.forEach((c, i) => { if (c === '') fail(`row ${id}: empty cell in column "${declaredCols[i]}"`) })
  }

  if (problems === 0) console.log(`  ✓ ${dataRows.length} rows, ${declaredCols.length} columns, all well-formed`)
  return 0
}

let missing = false
for (const reg of REGISTRIES) {
  if (checkRegistry(reg) === 2) missing = true
}

if (missing) { console.error('\n❌ a registry file is missing.'); process.exit(2) }
if (problems > 0) { console.error(`\n❌ ${problems} registry problem(s).`); process.exit(1) }
console.log('\n✅ Governance registries well-formed.')
process.exit(0)
